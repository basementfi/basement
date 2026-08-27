// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

/// @title EarnVault
/// @notice Generic ERC-4626 vault wrapping a Morpho ERC-4626 vault. Asset, Morpho vault,
///         share name/symbol, owner, treasury and fee are constructor parameters.
///         Performance fee is taken Morpho-style, by minting shares to the treasury on
///         accrued yield — withdrawals are never deducted. The wrapped Morpho vault is
///         immutable: the owner cannot re-point deposits anywhere.
contract EarnVault is ERC4626, Ownable, ReentrancyGuard, Pausable {
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
        Ownable(owner_)
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
    ///      trades against a stale pre-fee share value. Pause blocks deposits/mints only.

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

    /// @dev 10^6 virtual shares — makes the first-depositor inflation attack 10^6× more expensive.
    function _decimalsOffset() internal pure override returns (uint8) {
        return 6;
    }

    // ────────────────────────────────────────────────────────────
    // ERC-4626 deposit cap (donation-immune, share-denominated)
    // ────────────────────────────────────────────────────────────

    /// @notice Remaining mintable shares under the cap; 0 while paused.
    function maxMint(address) public view override returns (uint256) {
        if (paused()) return 0;
        if (depositCap == 0) return type(uint256).max;
        uint256 supply = totalSupply();
        return supply >= depositCap ? 0 : depositCap - supply;
    }

    /// @notice Remaining depositable assets, derived from maxMint.
    function maxDeposit(address receiver) public view override returns (uint256) {
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
    // Fee accrual (Morpho-style share dilution)
    // ────────────────────────────────────────────────────────────

    /// @dev Mint treasury shares worth performanceFee of the yield since the last snapshot.
    function _accrueFee() internal {
        uint256 newTotalAssets = totalAssets();
        uint256 supply = totalSupply();

        if (supply > 0 && newTotalAssets > lastTotalAssets && performanceFee > 0) {
            uint256 yield = newTotalAssets - lastTotalAssets;
            uint256 feeAssets = yield.mulDiv(performanceFee, FEE_DENOMINATOR, Math.Rounding.Floor);

            if (feeAssets > 0 && newTotalAssets > feeAssets) {
                // feeShares such that treasury's share of the vault equals feeAssets / newTotalAssets
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

    /// @dev Forward the deposit into Morpho.
    function _deposit(
        address caller,
        address receiver,
        uint256 assets,
        uint256 shares
    ) internal override nonReentrant {
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
    ) internal override nonReentrant {
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
}
