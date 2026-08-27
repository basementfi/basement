// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "./interfaces/IBasementVault.sol";

/// @title BasementAeroVault
/// @notice Generic ERC-4626 vault for Aerodrome LP positions, Beefy-style.
///
///         The vault's `asset()` is the **LP token** (the Aerodrome pool), so shares are
///         LP-denominated: minting/burning is priced off the LP the strategy controls, with
///         no on-chain USD price in the critical path (removes the flash-loan manipulation
///         surface). Deposited LP is forwarded to a pluggable {BasementAeroStrategy}, which stakes
///         it in the gauge and auto-compounds AERO emissions back into more LP — so each share
///         is worth more LP over time, with no new shares minted on harvest.
///
///         Users normally enter/exit in USDC via the {BasementAeroZap} router; holders of the raw LP
///         token can also use the standard ERC-4626 deposit/withdraw directly.
///
///         The contract is generic: name/symbol/asset are set at deploy time, so the same
///         bytecode serves any Aerodrome LP by pairing it with a configured strategy.
contract BasementAeroVault is ERC4626, Ownable2Step, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    /// @notice The active strategy. Holds and farms the vault's LP.
    address public strategy;

    /// @notice Optional deposit cap in SHARE units; 0 = uncapped. Enforced via maxMint/maxDeposit.
    /// @dev Capped on totalSupply (shares), NOT totalAssets — this makes the cap DONATION-IMMUNE:
    ///      shares only mint on real deposits, so transferring LP into the vault/strategy cannot
    ///      inflate the cap to brick deposits (the M-1 griefing vector). Covers zap + direct deposits.
    uint256 public depositCap;

    // ── Strategy migration timelock ─────────────────────────────────
    /// @notice Mandatory delay between proposing and committing a strategy migration. IMMUTABLE so a
    ///         (compromised) owner cannot shorten it; gives depositors a window to exit a migration
    ///         they distrust, neutralising the instant-rug via setStrategy.
    uint256 public immutable approvalDelay;
    address public proposedStrategy;
    uint256 public proposedTime;

    event StrategySet(address indexed oldStrategy, address indexed newStrategy);
    event StrategyProposed(address indexed newStrategy, uint256 executableAt);
    event Earn(address indexed strategy, uint256 amount);
    event DepositCapSet(uint256 cap);

    /// @param asset_         The Aerodrome LP token this vault accepts (the pool address).
    /// @param name_          ERC-20 name of the share token (e.g. "Basement AERO/USDC LP").
    /// @param symbol_        ERC-20 symbol of the share token (e.g. "optAERO/USDC").
    /// @param owner_         Vault owner (can propose strategy migrations, set the cap, pause).
    /// @param approvalDelay_ Strategy-migration timelock in seconds (immutable).
    constructor(IERC20 asset_, string memory name_, string memory symbol_, address owner_, uint256 approvalDelay_)
        ERC4626(asset_)
        ERC20(name_, symbol_)
        Ownable(owner_)
    {
        approvalDelay = approvalDelay_;
    }

    // ────────────────────────────────────────────────────────────
    // Inflation-attack mitigation
    // ────────────────────────────────────────────────────────────

    /// @dev Virtual shares/assets offset. LP tokens are 18-decimal; a 6-dp offset makes the
    ///      first-depositor inflation attack 1e6× more expensive while leaving huge headroom
    ///      (share decimals = 18 + 6 = 24, far below any overflow risk).
    function _decimalsOffset() internal pure override returns (uint8) {
        return 6;
    }

    // ────────────────────────────────────────────────────────────
    // Accounting
    // ────────────────────────────────────────────────────────────

    /// @notice Total LP controlled by the vault: idle LP held here + LP managed by the strategy.
    function totalAssets() public view override returns (uint256) {
        uint256 idle = IERC20(asset()).balanceOf(address(this));
        if (strategy == address(0)) return idle;
        return idle + IStrategy(strategy).balanceOf();
    }

    /// @notice Remaining mintable shares given the cap and pause state (ERC-4626 limit).
    /// @dev The cap is on totalSupply (shares), so donations to the vault/strategy can't fill it.
    function maxMint(address) public view override returns (uint256) {
        if (paused() || strategy == address(0)) return 0;
        if (depositCap == 0) return type(uint256).max;
        uint256 supply = totalSupply();
        return supply >= depositCap ? 0 : depositCap - supply;
    }

    /// @notice Remaining depositable LP, derived from the share-cap room.
    function maxDeposit(address receiver) public view override returns (uint256) {
        uint256 maxShares = maxMint(receiver);
        return maxShares == type(uint256).max ? type(uint256).max : convertToAssets(maxShares);
    }

    // ────────────────────────────────────────────────────────────
    // ERC-4626 entry points
    // ────────────────────────────────────────────────────────────

    function deposit(uint256 assets, address receiver)
        public
        override
        whenNotPaused
        nonReentrant
        returns (uint256)
    {
        require(strategy != address(0), "no strategy");
        IStrategy(strategy).beforeDeposit(); // harvest-on-deposit (no-op if disabled / below minHarvest)
        return super.deposit(assets, receiver);
    }

    function mint(uint256 shares, address receiver)
        public
        override
        whenNotPaused
        nonReentrant
        returns (uint256)
    {
        require(strategy != address(0), "no strategy");
        IStrategy(strategy).beforeDeposit();
        return super.mint(shares, receiver);
    }

    function withdraw(uint256 assets, address receiver, address owner)
        public
        override
        nonReentrant
        returns (uint256)
    {
        return super.withdraw(assets, receiver, owner);
    }

    function redeem(uint256 shares, address receiver, address owner)
        public
        override
        nonReentrant
        returns (uint256)
    {
        return super.redeem(shares, receiver, owner);
    }

    // ────────────────────────────────────────────────────────────
    // ERC-4626 hooks → strategy
    // ────────────────────────────────────────────────────────────

    /// @dev Pulls LP from the depositor (OZ base) then pushes it all to the strategy to stake.
    ///      Shares were already priced by the public entry point against pre-deposit totalAssets.
    function _deposit(address caller, address receiver, uint256 assets, uint256 shares)
        internal
        override
    {
        super._deposit(caller, receiver, assets, shares);
        _earn();
    }

    /// @dev Pull `assets` LP back from the strategy (unstaking as needed), then let OZ burn the
    ///      shares and transfer the LP to the receiver. Gauge LP is 1:1 so `assets` is exact.
    function _withdraw(address caller, address receiver, address owner, uint256 assets, uint256 shares)
        internal
        override
    {
        uint256 idle = IERC20(asset()).balanceOf(address(this));
        if (idle < assets) {
            IStrategy(strategy).withdraw(assets - idle);
        }
        super._withdraw(caller, receiver, owner, assets, shares);
    }

    /// @dev Move all idle LP to the strategy and stake it.
    function _earn() internal {
        uint256 bal = IERC20(asset()).balanceOf(address(this));
        if (bal > 0) {
            IERC20(asset()).safeTransfer(strategy, bal);
            IStrategy(strategy).deposit();
            emit Earn(strategy, bal);
        }
    }

    // ────────────────────────────────────────────────────────────
    // Admin
    // ────────────────────────────────────────────────────────────

    /// @notice Wire in the INITIAL strategy — only callable while none is set (deploy-time wiring).
    ///         All later migrations must go through {proposeStrategy} + {upgradeStrategy} (timelocked),
    ///         so the owner cannot instantly swap in a draining strategy.
    function setStrategy(address newStrategy) external onlyOwner {
        require(strategy == address(0), "use proposeStrategy");
        require(newStrategy != address(0), "zero strategy");
        require(IStrategy(newStrategy).want() == asset(), "want mismatch");
        strategy = newStrategy;
        emit StrategySet(address(0), newStrategy);
        _earn();
    }

    /// @notice Propose a strategy migration. Executable only after {approvalDelay} elapses, giving
    ///         depositors time to exit if they distrust the new strategy.
    function proposeStrategy(address newStrategy) external onlyOwner {
        require(newStrategy != address(0), "zero strategy");
        require(IStrategy(newStrategy).want() == asset(), "want mismatch");
        proposedStrategy = newStrategy;
        proposedTime = block.timestamp;
        emit StrategyProposed(newStrategy, block.timestamp + approvalDelay);
    }

    /// @notice Commit a proposed migration once the timelock has elapsed: retire the old strategy
    ///         (pull all LP back here), switch, and re-stake into the new one.
    function upgradeStrategy() external onlyOwner {
        address candidate = proposedStrategy;
        require(candidate != address(0), "none proposed");
        require(block.timestamp >= proposedTime + approvalDelay, "timelocked");
        require(IStrategy(candidate).want() == asset(), "want mismatch");

        address old = strategy;
        IStrategy(old).retireStrat();
        strategy = candidate;
        proposedStrategy = address(0);
        proposedTime = 0;
        emit StrategySet(old, candidate);
        _earn();
    }

    /// @notice Set the deposit cap in SHARE units. 0 = uncapped. Donation-immune (see {depositCap}).
    ///         Only limits new deposits; existing positions and withdrawals are unaffected, and it
    ///         can be raised/removed at any time.
    function setDepositCap(uint256 cap) external onlyOwner {
        depositCap = cap;
        emit DepositCapSet(cap);
    }

    /// @notice Halt new deposits/mints. Withdrawals always stay open so users can exit.
    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }
}
