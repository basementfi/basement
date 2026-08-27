// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

/// @title EarnVaultBase
/// @notice Shared mechanism for the Basement Earn vaults — a generic ERC-4626 vault wrapping a
///         Morpho ERC-4626 vault. Asset, Morpho vault, share name/symbol, owner, treasury and
///         fee are constructor parameters. Two concrete vaults extend this base and differ ONLY
///         in how they report deposit/withdraw limits:
///           • EarnVaultV1 — for Morpho v1.1 (MetaMorpho) venues, which implement the ERC-4626
///             max views; it binds maxDeposit/maxWithdraw/maxRedeem to the underlying vault's own
///             limits so the views never over-report (illiquidity/cap aware).
///           • EarnVaultV2 — for Morpho Vault V2 venues, which do NOT implement those views
///             (maxDeposit returns 0 while deposits work); it keeps the plain cap-based limits.
///         The base carries everything else:
///           1. Ownable2Step — two-step ownership handover (renounceOwnership left as OZ default).
///           2. Fee-aware conversions — previews/pricing reflect the fee that would accrue, via an
///              override of the internal converters (real entry points accrue first → no double-count).
///           3. Reentrancy guard on the public entry points (covers fee accrual), not the hooks.
///           4. rescueERC20 for stray tokens; can never move the Morpho shares backing deposits.
///         Performance fee is taken Morpho-style, by minting shares to the treasury on accrued
///         yield — withdrawals are never deducted. The wrapped Morpho vault is immutable.
///
///         Assumptions & operational notes:
///           • Asset is a standard ERC-20: NOT fee-on-transfer and NOT rebasing. Deposits forward
///             the requested `assets` straight into Morpho and `totalAssets()` reads the Morpho
///             position, so a fee-on-transfer or rebasing asset would revert or desync. (USDC,
///             WETH, cbBTC all qualify.)
///           • Withdrawal liveness is delegated to the underlying Morpho vault. Withdraw/redeem
///             are never gated by this vault (no pause, no owner lever), but if the Morpho vault
///             is illiquid or (Vault V2) has a gate enabled, the exit reverts at the Morpho call.
///             That risk is handled operationally (monitor + pause new deposits), not in code.
///           • No high-water mark: the performance fee is charged on yield since the last
///             snapshot, so a drawdown that later recovers is taxed again on the recovery. This
///             matches MetaMorpho's fee behaviour and is a deliberate choice.
///           • Seed a small first deposit at deploy (standard OZ guidance) to fully close the
///             empty-vault inflation edge beyond the 10^6 virtual-share offset.
abstract contract EarnVaultBase is ERC4626, Ownable2Step, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;
    using Math for uint256;

    // ────────────────────────────────────────────────────────────
    // Constants
    // ────────────────────────────────────────────────────────────

    uint256 public constant FEE_DENOMINATOR = 10_000;
    uint256 public constant MAX_FEE = 2_000; // 20% hard cap

    // ────────────────────────────────────────────────────────────
    // Immutables
    // ────────────────────────────────────────────────────────────

    /// @notice The underlying Morpho ERC-4626 vault
    IERC4626 public immutable morphoVault;

    // ────────────────────────────────────────────────────────────
    // State
    // ────────────────────────────────────────────────────────────

    /// @notice Fee recipient — receives minted shares on yield accrual
    address public treasury;

    /// @notice Performance fee in basis points (1000 = 10%)
    uint256 public performanceFee;

    /// @notice Snapshot of totalAssets at last fee accrual
    uint256 public lastTotalAssets;

    /// @notice Deposit cap in share units; 0 = uncapped. Set on totalSupply, not totalAssets,
    ///         so donations cannot fill it.
    uint256 public depositCap;

    // ────────────────────────────────────────────────────────────
    // Events
    // ────────────────────────────────────────────────────────────

    event FeeSharesMinted(address indexed treasury, uint256 shares, uint256 feeAssets);
    event TreasuryUpdated(address indexed oldTreasury, address indexed newTreasury);
    event PerformanceFeeUpdated(uint256 oldFee, uint256 newFee);
    event DepositCapSet(uint256 cap);
    event TokensRescued(address indexed token, address indexed to, uint256 amount);

    // ────────────────────────────────────────────────────────────
    // Constructor
    // ────────────────────────────────────────────────────────────

    constructor(
        IERC20 asset_,
        IERC4626 morphoVault_,
        string memory name_,
        string memory symbol_,
        address owner_,
        address treasury_,
        uint256 performanceFee_
    )
        ERC4626(asset_)
        ERC20(name_, symbol_)
        Ownable(owner_) // Ownable2Step has no constructor; it initialises through Ownable
    {
        require(treasury_ != address(0), "Invalid treasury");
        require(performanceFee_ <= MAX_FEE, "Fee too high");
        require(morphoVault_.asset() == address(asset_), "asset mismatch");
        morphoVault = morphoVault_;
        treasury = treasury_;
        performanceFee = performanceFee_;
    }

    // ────────────────────────────────────────────────────────────
    // ERC-4626 public entry points
    // ────────────────────────────────────────────────────────────

    /// @dev Fees accrue at the start of every entry point, before shares are priced, so nobody
    ///      trades against a stale pre-fee share value. Pause blocks deposits/mints only. The
    ///      reentrancy guard sits here (not on the internal hooks) so fee accrual is covered too.

    function deposit(uint256 assets, address receiver)
        public
        override
        whenNotPaused
        nonReentrant
        returns (uint256)
    {
        _accrueFee();
        return super.deposit(assets, receiver);
    }

    function mint(uint256 shares, address receiver)
        public
        override
        whenNotPaused
        nonReentrant
        returns (uint256)
    {
        _accrueFee();
        return super.mint(shares, receiver);
    }

    function withdraw(uint256 assets, address receiver, address owner)
        public
        override
        nonReentrant
        returns (uint256)
    {
        _accrueFee();
        return super.withdraw(assets, receiver, owner);
    }

    function redeem(uint256 shares, address receiver, address owner)
        public
        override
        nonReentrant
        returns (uint256)
    {
        _accrueFee();
        return super.redeem(shares, receiver, owner);
    }

    // ────────────────────────────────────────────────────────────
    // ERC-4626 inflation-attack mitigation
    // ────────────────────────────────────────────────────────────

    /// @dev 10^6 virtual shares — makes the first-depositor inflation attack 10^6× more expensive.
    function _decimalsOffset() internal pure override returns (uint8) {
        return 6;
    }

    // ────────────────────────────────────────────────────────────
    // Deposit cap (donation-immune, share-denominated)
    // ────────────────────────────────────────────────────────────

    /// @notice Remaining mintable shares under the cap; 0 while paused.
    function maxMint(address) public view virtual override returns (uint256) {
        if (paused()) return 0;
        if (depositCap == 0) return type(uint256).max;
        uint256 supply = totalSupply();
        return supply >= depositCap ? 0 : depositCap - supply;
    }

    /// @notice Remaining depositable assets, derived from maxMint.
    function maxDeposit(address receiver) public view virtual override returns (uint256) {
        uint256 maxShares = maxMint(receiver);
        return maxShares == type(uint256).max ? type(uint256).max : convertToAssets(maxShares);
    }

    // ────────────────────────────────────────────────────────────
    // totalAssets
    // ────────────────────────────────────────────────────────────

    /// @notice Value of this vault's Morpho position, in the asset.
    function totalAssets() public view override returns (uint256) {
        uint256 morphoShares = morphoVault.balanceOf(address(this));
        if (morphoShares == 0) return 0;
        return morphoVault.convertToAssets(morphoShares);
    }

    // ────────────────────────────────────────────────────────────
    // Fee accrual (Morpho-style share dilution) + fee-aware pricing
    // ────────────────────────────────────────────────────────────

    /// @dev The fee that would be minted if accrual ran now: shares worth `performanceFee` of the
    ///      yield since the last snapshot. Pure of state changes so previews can use it too.
    function _accruedFee() internal view returns (uint256 feeShares, uint256 feeAssets) {
        uint256 newTotalAssets = totalAssets();
        uint256 supply = totalSupply();

        if (supply == 0 || newTotalAssets <= lastTotalAssets || performanceFee == 0) {
            return (0, 0);
        }

        uint256 yield = newTotalAssets - lastTotalAssets;
        feeAssets = yield.mulDiv(performanceFee, FEE_DENOMINATOR, Math.Rounding.Floor);
        if (feeAssets == 0 || newTotalAssets <= feeAssets) return (0, 0);

        // feeShares so the treasury's stake equals feeAssets / newTotalAssets.
        feeShares = supply.mulDiv(feeAssets, newTotalAssets - feeAssets, Math.Rounding.Floor);
    }

    /// @dev Mint the accrued fee shares to the treasury and snapshot totalAssets.
    function _accrueFee() internal {
        (uint256 feeShares, uint256 feeAssets) = _accruedFee();
        if (feeShares > 0) {
            _mint(treasury, feeShares);
            emit FeeSharesMinted(treasury, feeShares, feeAssets);
        }
        lastTotalAssets = totalAssets();
    }

    /// @dev Conversions fold in the pending fee shares, so previews (and any pricing before a real
    ///      accrual) reflect the fee. In a real deposit/withdraw, _accrueFee has already run and
    ///      _accruedFee returns 0, so there is no double-count.
    function _convertToShares(uint256 assets, Math.Rounding rounding)
        internal
        view
        override
        returns (uint256)
    {
        (uint256 feeShares,) = _accruedFee();
        uint256 supply = totalSupply() + feeShares + 10 ** _decimalsOffset();
        return assets.mulDiv(supply, totalAssets() + 1, rounding);
    }

    function _convertToAssets(uint256 shares, Math.Rounding rounding)
        internal
        view
        override
        returns (uint256)
    {
        (uint256 feeShares,) = _accruedFee();
        uint256 supply = totalSupply() + feeShares + 10 ** _decimalsOffset();
        return shares.mulDiv(totalAssets() + 1, supply, rounding);
    }

    // ────────────────────────────────────────────────────────────
    // ERC-4626 hooks
    // ────────────────────────────────────────────────────────────

    /// @dev Forward the deposit into Morpho.
    function _deposit(
        address caller,
        address receiver,
        uint256 assets,
        uint256 shares
    ) internal override {
        super._deposit(caller, receiver, assets, shares);

        IERC20(asset()).forceApprove(address(morphoVault), assets);
        morphoVault.deposit(assets, address(this));

        lastTotalAssets = totalAssets();
    }

    /// @dev Burn shares first (CEI), then pull exactly `assets` from Morpho for the receiver.
    function _withdraw(
        address caller,
        address receiver,
        address owner,
        uint256 assets,
        uint256 shares
    ) internal override {
        if (caller != owner) _spendAllowance(owner, caller, shares);
        _burn(owner, shares);

        morphoVault.withdraw(assets, receiver, address(this));

        lastTotalAssets = totalAssets();

        emit Withdraw(caller, receiver, owner, assets, shares);
    }

    // ────────────────────────────────────────────────────────────
    // Admin
    // ────────────────────────────────────────────────────────────

    /// @notice Halt deposits/mints. Withdrawals always stay open.
    function pause() external onlyOwner {
        _pause();
    }

    /// @notice Resume deposits/mints.
    function unpause() external onlyOwner {
        _unpause();
    }

    function setTreasury(address _treasury) external onlyOwner {
        require(_treasury != address(0), "Invalid treasury");
        _accrueFee(); // settle pending fees to the current treasury first
        emit TreasuryUpdated(treasury, _treasury);
        treasury = _treasury;
    }

    function setPerformanceFee(uint256 _fee) external onlyOwner {
        require(_fee <= MAX_FEE, "Fee too high");
        _accrueFee(); // settle pending fees at the old rate first
        emit PerformanceFeeUpdated(performanceFee, _fee);
        performanceFee = _fee;
    }

    /// @notice Set the deposit cap in share units; 0 = uncapped.
    function setDepositCap(uint256 cap) external onlyOwner {
        depositCap = cap;
        emit DepositCapSet(cap);
    }

    /// @notice Recover an unrelated ERC-20 mistakenly sent to this vault. Can never move the
    ///         Morpho shares that back user deposits, so it is not a lever on user funds.
    function rescueERC20(IERC20 token, address to, uint256 amount) external onlyOwner nonReentrant {
        require(to != address(0), "bad recipient");
        require(address(token) != address(morphoVault), "cannot touch backing shares");
        token.safeTransfer(to, amount);
        emit TokensRescued(address(token), to, amount);
    }
}
