// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

/// @title EarnETH
/// @notice ERC-4626 vault that wraps a Morpho ERC-4626 WETH vault.
///         Uses Morpho-style share-dilution fee: on every interaction,
///         yield is computed and new shares are minted to the treasury
///         (10% of yield). This keeps withdrawals clean — no WETH deducted.
contract EarnETH is ERC4626, Ownable, ReentrancyGuard, Pausable {
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

    /// @notice Tracks each user's deposited principal (in WETH, for UX)
    mapping(address => uint256) public principalDeposited;

    /// @notice Optional deposit cap in SHARE units; 0 = uncapped. Enforced via maxMint/maxDeposit.
    /// @dev Capped on totalSupply (shares), NOT totalAssets — donation-immune: nobody can transfer
    ///      Morpho shares to this vault to inflate totalAssets and brick deposits. Covers direct + zap.
    uint256 public depositCap;

    // ────────────────────────────────────────────────────────────
    // Events
    // ────────────────────────────────────────────────────────────

    event FeeSharesMinted(address indexed treasury, uint256 shares, uint256 feeAssets);
    event TreasuryUpdated(address indexed oldTreasury, address indexed newTreasury);
    event PerformanceFeeUpdated(uint256 oldFee, uint256 newFee);
    event DepositCapSet(uint256 cap);

    // ────────────────────────────────────────────────────────────
    // Constructor
    // ────────────────────────────────────────────────────────────

    constructor(
        IERC20 _weth,
        IERC4626 _morphoVault,
        address _treasury,
        uint256 _performanceFee,
        bool /* _instantWithdraw — kept for deploy script compat */
    )
        ERC4626(_weth)
        ERC20("EarnETH", "EarnETH")
        Ownable(msg.sender)
    {
        require(_treasury != address(0), "Invalid treasury");
        require(_performanceFee <= MAX_FEE, "Fee too high");
        morphoVault = _morphoVault;
        treasury = _treasury;
        performanceFee = _performanceFee;
    }

    // ────────────────────────────────────────────────────────────
    // ERC-4626 public entry points
    // ────────────────────────────────────────────────────────────

    /// @dev Fees are accrued at the START of every public entry point, BEFORE
    ///      OpenZeppelin prices the trade via preview*(). This mirrors MetaMorpho
    ///      and ensures the fee shares minted to the treasury are already part of
    ///      totalSupply when the depositor's/redeemer's share amount is computed —
    ///      so nobody is priced against a stale, pre-fee share value.
    ///      Deposits/mints are blocked while paused; withdrawals/redeems stay open
    ///      so users can always exit.

    function deposit(uint256 assets, address receiver)
        public
        override
        whenNotPaused
        returns (uint256)
    {
        _accrueFee();
        return super.deposit(assets, receiver);
    }

    function mint(uint256 shares, address receiver)
        public
        override
        whenNotPaused
        returns (uint256)
    {
        _accrueFee();
        return super.mint(shares, receiver);
    }

    function withdraw(uint256 assets, address receiver, address owner)
        public
        override
        returns (uint256)
    {
        _accrueFee();
        return super.withdraw(assets, receiver, owner);
    }

    function redeem(uint256 shares, address receiver, address owner)
        public
        override
        returns (uint256)
    {
        _accrueFee();
        return super.redeem(shares, receiver, owner);
    }

    // ────────────────────────────────────────────────────────────
    // ERC-4626 inflation-attack mitigation
    // ────────────────────────────────────────────────────────────

    /// @dev Adds 10^6 virtual shares, making the first-depositor inflation
    ///      attack 1 000 000× more expensive. Same offset as EarnUSDC.
    function _decimalsOffset() internal pure override returns (uint8) {
        return 6;
    }

    // ────────────────────────────────────────────────────────────
    // ERC-4626 deposit cap (donation-immune, share-denominated)
    // ────────────────────────────────────────────────────────────

    /// @notice Remaining mintable shares given the cap and pause state (ERC-4626 limit).
    /// @dev Cap is on totalSupply (shares), so donations to the vault can't fill it.
    function maxMint(address) public view override returns (uint256) {
        if (paused()) return 0;
        if (depositCap == 0) return type(uint256).max;
        uint256 supply = totalSupply();
        return supply >= depositCap ? 0 : depositCap - supply;
    }

    /// @notice Remaining depositable assets, derived from the share-cap room.
    function maxDeposit(address receiver) public view override returns (uint256) {
        uint256 maxShares = maxMint(receiver);
        return maxShares == type(uint256).max ? type(uint256).max : convertToAssets(maxShares);
    }

    // ────────────────────────────────────────────────────────────
    // totalAssets
    // ────────────────────────────────────────────────────────────

    /// @notice Total WETH value held in Morpho on behalf of this vault
    function totalAssets() public view override returns (uint256) {
        uint256 morphoShares = morphoVault.balanceOf(address(this));
        if (morphoShares == 0) return 0;
        return morphoVault.convertToAssets(morphoShares);
    }

    // ────────────────────────────────────────────────────────────
    // Fee accrual (Morpho-style share dilution)
    // ────────────────────────────────────────────────────────────

    /// @notice Compute new yield since last snapshot, mint fee shares to treasury.
    ///         Called before every deposit and withdrawal.
    function _accrueFee() internal {
        uint256 newTotalAssets = totalAssets();
        uint256 supply = totalSupply();

        if (supply > 0 && newTotalAssets > lastTotalAssets && performanceFee > 0) {
            uint256 yield = newTotalAssets - lastTotalAssets;
            uint256 feeAssets = yield.mulDiv(performanceFee, FEE_DENOMINATOR, Math.Rounding.Floor);

            if (feeAssets > 0 && newTotalAssets > feeAssets) {
                // feeShares = totalSupply × feeAssets / (totalAssets − feeAssets)
                // Ensures treasury's portion of vault = feeAssets / newTotalAssets
                uint256 feeShares = supply.mulDiv(
                    feeAssets,
                    newTotalAssets - feeAssets,
                    Math.Rounding.Floor
                );
                if (feeShares > 0) {
                    _mint(treasury, feeShares);
                    emit FeeSharesMinted(treasury, feeShares, feeAssets);
                }
            }
        }

        lastTotalAssets = newTotalAssets;
    }

    // ────────────────────────────────────────────────────────────
    // ERC-4626 hooks
    // ────────────────────────────────────────────────────────────

    /// @dev Forward WETH into Morpho. Fees are already accrued by the public
    ///      entry point (deposit/mint) before shares were priced.
    function _deposit(
        address caller,
        address receiver,
        uint256 assets,
        uint256 shares
    ) internal override nonReentrant {
        super._deposit(caller, receiver, assets, shares);
        principalDeposited[receiver] += assets;

        IERC20(asset()).forceApprove(address(morphoVault), assets);
        morphoVault.deposit(assets, address(this));

        lastTotalAssets = totalAssets();
    }

    /// @dev Redeem from Morpho, send assets to receiver — no WETH fee deducted.
    ///      Fees are already accrued by the public entry point (withdraw/redeem)
    ///      before shares were priced.
    ///      `assets` is honoured: when called via withdraw() the vault redeems exactly
    ///      that many WETH from Morpho; when called via redeem() assets is the preview
    ///      value computed by OZ and the redemption is share-proportional (both paths
    ///      produce the same result because shares == previewWithdraw(assets)).
    function _withdraw(
        address caller,
        address receiver,
        address owner,
        uint256 assets,
        uint256 shares
    ) internal override nonReentrant {
        // Proportionally reduce tracked principal
        uint256 totalOwnerShares = balanceOf(owner);
        if (totalOwnerShares > 0 && principalDeposited[owner] > 0) {
            uint256 principalPortion = principalDeposited[owner].mulDiv(
                shares, totalOwnerShares, Math.Rounding.Floor
            );
            principalDeposited[owner] = principalDeposited[owner] > principalPortion
                ? principalDeposited[owner] - principalPortion
                : 0;
        }

        // Effects before interaction (CEI): burn shares first, then pull from Morpho
        if (caller != owner) _spendAllowance(owner, caller, shares);
        _burn(owner, shares);

        // Withdraw exactly `assets` WETH from Morpho (covers both withdraw & redeem paths)
        morphoVault.withdraw(assets, receiver, address(this));

        lastTotalAssets = totalAssets();

        emit Withdraw(caller, receiver, owner, assets, shares);
    }

    // ────────────────────────────────────────────────────────────
    // ERC-20 transfer hook — keep principalDeposited consistent
    // ────────────────────────────────────────────────────────────

    /// @dev Moves a proportional slice of the sender's tracked principal to the
    ///      recipient whenever shares are transferred between accounts.
    ///      Mints (from == 0) and burns (to == 0) are handled by _deposit/_withdraw
    ///      directly, so we skip them here to avoid double-counting.
    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && to != address(0)) {
            uint256 fromShares = balanceOf(from);
            if (fromShares > 0 && principalDeposited[from] > 0) {
                uint256 principalPortion = principalDeposited[from].mulDiv(
                    value, fromShares, Math.Rounding.Floor
                );
                principalDeposited[from] -= principalPortion;
                principalDeposited[to]   += principalPortion;
            }
        }
        super._update(from, to, value);
    }

    // ────────────────────────────────────────────────────────────
    // Admin
    // ────────────────────────────────────────────────────────────

    /// @notice Halt new deposits/mints in an emergency. Withdrawals stay open.
    function pause() external onlyOwner {
        _pause();
    }

    /// @notice Resume deposits/mints.
    function unpause() external onlyOwner {
        _unpause();
    }

    function setTreasury(address _treasury) external onlyOwner {
        require(_treasury != address(0), "Invalid treasury");
        _accrueFee(); // settle pending fees to current treasury before switching
        emit TreasuryUpdated(treasury, _treasury);
        treasury = _treasury;
    }

    function setPerformanceFee(uint256 _fee) external onlyOwner {
        require(_fee <= MAX_FEE, "Fee too high");
        _accrueFee(); // settle outstanding fees before rate change
        emit PerformanceFeeUpdated(performanceFee, _fee);
        performanceFee = _fee;
    }

    /// @notice Set the deposit cap in SHARE units. 0 = uncapped. Donation-immune (see {depositCap}).
    function setDepositCap(uint256 cap) external onlyOwner {
        depositCap = cap;
        emit DepositCapSet(cap);
    }
}
