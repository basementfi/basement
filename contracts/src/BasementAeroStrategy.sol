// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "./interfaces/IAerodrome.sol";

/// @title BasementAeroStrategy
/// @notice Generic, parameterized Aerodrome gauge-LP strategy for {BasementAeroVault}.
///
///         Stakes the vault's LP (`want`) in the Aerodrome gauge, and on harvest claims the
///         emitted reward (`output`, e.g. AERO), takes a performance fee (split between the
///         harvest caller and the treasury), then compounds the rest back into more LP and
///         re-stakes it. Auto-compounding raises the vault's price-per-share; no shares are
///         minted on harvest.
///
///         All pool/gauge addresses and swap routes are constructor parameters (not constants),
///         so the same bytecode farms any Aerodrome gauge LP by deploying a configured instance.
contract BasementAeroStrategy is Ownable2Step, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    // ── Config (immutable) ──────────────────────────────────────────
    address public immutable want;       // the Aerodrome LP / pool token (== vault.asset())
    address public immutable lpToken0;   // pool token0
    address public immutable lpToken1;   // pool token1
    bool    public immutable stable;     // pool type (volatile vs stable)
    address public immutable output;     // reward token emitted by the gauge (e.g. AERO)
    address public immutable gauge;      // Aerodrome gauge staking `want`
    address public immutable router;     // Aerodrome router
    address public immutable factory;    // Aerodrome pool factory (used in swap routes)
    address public immutable vault;       // the BasementAeroVault that owns this strategy

    // ── Reward routing ──────────────────────────────────────────────
    /// @dev Compounding consolidates ALL harvested `output` into lpToken0 (the "hub" leg) via this
    ///      SINGLE-HOP route, then swaps half of lpToken0 into lpToken1 through the WANT pool. So only
    ///      ONE swap leaves the want pool (output → hub). Empty when output == lpToken0.
    IAeroRouter.Route[] public rewardRoute;
    /// @dev Pool used to TWAP-floor the output→hub swap (the single-hop rewardRoute's pool). Both
    ///      compounding swaps (output→hub via `rewardPool`, hub→lp1 via `want`) are always floored.
    address public rewardPool;

    // ── Fees ────────────────────────────────────────────────────────
    uint256 public constant FEE_DENOMINATOR = 10_000;
    uint256 public constant MAX_FEE = 2_000; // 20% hard cap on the total performance fee
    address public treasury;
    uint256 public performanceFee; // bps of harvested `output` taken as fee (e.g. 1000 = 10%)
    uint256 public callFee;        // bps of harvested `output` paid to the harvest caller (≤ performanceFee)

    // ── Safety params ───────────────────────────────────────────────
    uint256 public slippageBps = 200;  // 2% guard on compounding swaps (spot-quote based)
    uint256 public minHarvest = 1e16;  // skip harvest below this much pending `output` (0.01 token)
    bool    public harvestOnDeposit;   // if true, harvest before each vault deposit

    // ── MEV / sandwich protection ───────────────────────────────────
    /// @dev Primary defense is the TWAP floor in {_swap}: it anchors swap minOut to a price an
    ///      attacker cannot move in-block, so even a permissionless, attacker-triggered harvest
    ///      reverts if it would execute against a manipulated spot. So harvest can safely be public.
    ///
    /// @dev When true, anyone may call harvest() (and earn the callFee). When false, only the
    ///      owner / allowlisted keepers may — flip to keeper-only (run via a private RPC) without
    ///      redeploying if MEV is ever observed in practice.
    bool public harvestPublic = true;
    /// @dev Addresses allowed to call harvest() when harvestPublic is false. Owner always allowed.
    mapping(address => bool) public keepers;
    /// @dev TWAP points for the compounding-swap price floor (~granularity*30min on Aerodrome).
    uint256 public twapGranularity = 4;
    /// @dev Band on the TWAP floor (500 = 5%). The knob trading residual MEV (≤ band on half a
    ///      harvest) against spurious reverts on genuine volatility (harmless: anyone retries).
    ///      See _swap/_twapFloor. Tighten toward an external oracle's precision if one is wired.
    uint256 public twapSlippageBps = 500;

    // ── Events ──────────────────────────────────────────────────────
    event Deposited(uint256 amount);
    event Withdrawn(uint256 amount);
    event StratHarvest(address indexed caller, uint256 outputHarvested, uint256 lpCompounded, uint256 tvl);
    event ChargedFees(uint256 callerFee, uint256 treasuryFee);
    event TreasuryUpdated(address indexed oldT, address indexed newT);
    event PerformanceFeeUpdated(uint256 oldFee, uint256 newFee);
    event CallFeeUpdated(uint256 oldFee, uint256 newFee);
    event KeeperSet(address indexed keeper, bool allowed);
    event HarvestPublicSet(bool isPublic);
    event TwapParamsSet(uint256 granularity, uint256 slippageBps);

    struct Params {
        address want;
        address lpToken0;
        address lpToken1;
        bool    stable;
        address output;
        address gauge;
        address router;
        address factory;
        address vault;
        address treasury;
        uint256 performanceFee;
        uint256 callFee;
    }

    constructor(
        Params memory p,
        IAeroRouter.Route[] memory rewardRoute_,
        address owner_
    ) Ownable(owner_) {
        require(p.want != address(0) && p.gauge != address(0) && p.router != address(0), "zero addr");
        require(p.vault != address(0) && p.treasury != address(0), "zero addr");
        require(p.performanceFee <= MAX_FEE, "fee too high");
        require(p.callFee <= p.performanceFee, "call > perf");

        want = p.want;
        lpToken0 = p.lpToken0;
        lpToken1 = p.lpToken1;
        stable = p.stable;
        output = p.output;
        gauge = p.gauge;
        router = p.router;
        factory = p.factory;
        vault = p.vault;
        treasury = p.treasury;
        performanceFee = p.performanceFee;
        callFee = p.callFee;

        _setRoutes(rewardRoute_);
    }

    modifier onlyVault() {
        require(msg.sender == vault, "!vault");
        _;
    }

    modifier canHarvest() {
        require(harvestPublic || keepers[msg.sender] || msg.sender == owner(), "!keeper");
        _;
    }

    // ────────────────────────────────────────────────────────────
    // Views
    // ────────────────────────────────────────────────────────────

    /// @notice Total `want` (LP) controlled by this strategy: idle + staked.
    function balanceOf() public view returns (uint256) {
        return balanceOfWant() + balanceOfPool();
    }

    /// @notice LP sitting idle in the strategy (e.g. while paused/panicked, or dust).
    function balanceOfWant() public view returns (uint256) {
        return IERC20(want).balanceOf(address(this));
    }

    /// @notice LP staked in the gauge.
    function balanceOfPool() public view returns (uint256) {
        return IAeroGauge(gauge).balanceOf(address(this));
    }

    /// @notice Pending `output` rewards claimable from the gauge.
    function rewardsAvailable() external view returns (uint256) {
        return IAeroGauge(gauge).earned(address(this));
    }

    // ────────────────────────────────────────────────────────────
    // Vault hooks
    // ────────────────────────────────────────────────────────────

    /// @notice Stake any idle `want` into the gauge. Public & harmless (only acts on this strat's funds).
    /// @dev The gauge stake is best-effort: a reverting/killed Aerodrome gauge must not brick vault
    ///      deposits. If staking fails the LP simply stays idle in the strategy — still fully counted
    ///      by {balanceOf} and withdrawable — earning no rewards until the owner acts (unpause/migrate).
    function deposit() public whenNotPaused {
        uint256 bal = balanceOfWant();
        if (bal > 0) {
            IERC20(want).forceApprove(gauge, bal);
            try IAeroGauge(gauge).deposit(bal) { emit Deposited(bal); } catch { /* leave idle */ }
        }
    }

    /// @notice Send `amount` of `want` back to the vault, unstaking from the gauge if needed.
    /// @dev Unstake is best-effort ({_unstakeSafe}) so a misbehaving gauge cannot hard-revert here;
    ///      the vault still receives whatever `want` is recoverable (idle first). If a killed gauge
    ///      holds the staked LP, the owner recovers it via {panic}/{emergencyWithdraw} to idle.
    function withdraw(uint256 amount) external onlyVault {
        uint256 idle = balanceOfWant();
        if (idle < amount) {
            _unstakeSafe(amount - idle);
            idle = balanceOfWant();
        }
        uint256 toSend = amount < idle ? amount : idle;
        IERC20(want).safeTransfer(vault, toSend);
        emit Withdrawn(toSend);
    }

    /// @notice Called by the vault before pricing a deposit; harvests first if enabled.
    function beforeDeposit() external onlyVault {
        if (harvestOnDeposit) {
            _harvest(tx.origin);
        }
    }

    // ────────────────────────────────────────────────────────────
    // Harvest / compound
    // ────────────────────────────────────────────────────────────

    /// @notice Claim rewards, take the fee, and compound the rest into more staked LP.
    /// @dev Public by default (caller earns the callFee). Safe to be public because the
    ///      compounding swap's minOut is anchored to the TWAP floor in {_swap}, so a
    ///      manipulated spot price makes the swap (and thus the harvest) revert. Can be
    ///      restricted to keepers via {setHarvestPublic} if MEV is ever observed.
    function harvest() external canHarvest nonReentrant whenNotPaused {
        _harvest(msg.sender);
    }

    function _harvest(address callFeeRecipient) internal {
        // Best-effort: a killed/reverting gauge must not brick harvest — compound whatever `output`
        // is already held (a no-op if none, thanks to the minHarvest guard below).
        try IAeroGauge(gauge).getReward(address(this)) {} catch {}
        uint256 outputBal = IERC20(output).balanceOf(address(this));
        if (outputBal < minHarvest) return; // not worth the gas / no-op for harvest-on-deposit

        _chargeFees(callFeeRecipient, outputBal);
        _addLiquidity();
        uint256 lpHarvested = balanceOfWant();
        deposit(); // re-stake the freshly minted LP

        emit StratHarvest(msg.sender, outputBal, lpHarvested, balanceOf());
    }

    /// @dev Fee is taken in `output`. callerCut = callFee bps of gross; treasury gets the
    ///      remainder of the performance fee (performanceFee − callFee bps of gross).
    function _chargeFees(address callFeeRecipient, uint256 outputBal) internal {
        uint256 totalFee = outputBal * performanceFee / FEE_DENOMINATOR;
        if (totalFee == 0) return;

        uint256 callerCut = outputBal * callFee / FEE_DENOMINATOR;
        if (callerCut > totalFee) callerCut = totalFee;
        address recipient = callFeeRecipient == address(0) ? treasury : callFeeRecipient;
        if (callerCut > 0) IERC20(output).safeTransfer(recipient, callerCut);

        uint256 treasuryCut = totalFee - callerCut;
        if (treasuryCut > 0) IERC20(output).safeTransfer(treasury, treasuryCut);

        emit ChargedFees(callerCut, treasuryCut);
    }

    /// @dev Compound the harvested `output` into more LP in TWO single-hop swaps, both of which are
    ///      TWAP-floored so a sandwiched harvest reverts (letting harvest stay public):
    ///        1. ALL output → lpToken0 (the hub leg) via {rewardRoute}, floored against {rewardPool}.
    ///        2. HALF of lpToken0 → lpToken1 through the WANT pool, floored against `want`.
    ///      Then addLiquidity from balances (mins 0: the router refunds the excess leg; residual =
    ///      tiny dust, compounded next harvest).
    function _addLiquidity() internal {
        // 1. consolidate output into the hub leg
        if (output != lpToken0) {
            uint256 outBal = IERC20(output).balanceOf(address(this));
            _swap(rewardRoute, outBal, rewardPool);
        }
        // 2. balance: swap half the hub into the other leg through the want pool (single hop)
        uint256 half = IERC20(lpToken0).balanceOf(address(this)) / 2;
        if (half > 0) {
            IAeroRouter.Route[] memory r = new IAeroRouter.Route[](1);
            r[0] = IAeroRouter.Route({ from: lpToken0, to: lpToken1, stable: stable, factory: factory });
            _swap(r, half, want);
        }
        // 3. add liquidity
        uint256 bal0 = IERC20(lpToken0).balanceOf(address(this));
        uint256 bal1 = IERC20(lpToken1).balanceOf(address(this));
        if (bal0 == 0 || bal1 == 0) return;

        IERC20(lpToken0).forceApprove(router, bal0);
        IERC20(lpToken1).forceApprove(router, bal1);
        IAeroRouter(router).addLiquidity(
            lpToken0, lpToken1, stable, bal0, bal1, 0, 0, address(this), block.timestamp
        );
    }

    /// @dev Sandwich-resistant compounding swap. minOut is the MAX of two lower bounds:
    ///        • spot: getAmountsOut × (1 − slippageBps)          — tight, governs normal conditions
    ///        • TWAP: quote(TWAP) × (1 − twapSlippageBps)        — manipulation-resistant floor
    ///      Aerodrome's quote() runs the TIME-AVERAGED reserves through the pool curve, so it is
    ///      impact-inclusive AND curve-correct (works for volatile and stable pools alike). Under
    ///      honest conditions quote() exceeds the real spot output only by the pool fee — well inside
    ///      the band — so an honest harvest of ANY size passes. A sandwich that pushes spot DOWN
    ///      lowers getAmountsOut below the (un-movable-in-block) TWAP floor, so the swap reverts.
    ///      Applies to single-hop swaps only; multi-hop reward routes are rejected at configuration
    ///      (see {_setRoutes}) so every compounding swap is floored. Residual risk: the TWAP can be
    ///      dragged across MANY blocks (~twapGranularity × 30min) — uneconomic on deep pools; for
    ///      thin pools use the harvestPublic=false keeper kill-switch.
    function _swap(IAeroRouter.Route[] memory route, uint256 amountIn, address twapPool) internal {
        if (amountIn == 0 || route.length == 0) return;

        IERC20(route[0].from).forceApprove(router, amountIn);
        uint256[] memory expected = IAeroRouter(router).getAmountsOut(amountIn, route);
        uint256 minOut = expected[expected.length - 1] * (FEE_DENOMINATOR - slippageBps) / FEE_DENOMINATOR;

        if (route.length == 1 && twapPool != address(0)) {
            uint256 twapMin = _twapFloor(twapPool, route[0].from, amountIn);
            if (twapMin > minOut) minOut = twapMin;
        }
        IAeroRouter(router).swapExactTokensForTokens(amountIn, minOut, route, address(this), block.timestamp);
    }

    /// @dev TWAP output floor for a single hop of `amountIn` of `from` through `twapPool`. Fails
    ///      closed if the oracle is unavailable (quote==0) rather than silently dropping the floor.
    function _twapFloor(address twapPool, address from, uint256 amountIn) internal view returns (uint256) {
        uint256 twapOut = IAeroPool(twapPool).quote(from, amountIn, twapGranularity);
        require(twapOut > 0, "twap unavailable");
        return twapOut * (FEE_DENOMINATOR - twapSlippageBps) / FEE_DENOMINATOR;
    }

    // ────────────────────────────────────────────────────────────
    // Emergency / migration
    // ────────────────────────────────────────────────────────────

    /// @dev Best-effort unstake from the gauge. Tolerates a reverting/paused/killed gauge so the
    ///      emergency and migration paths can NEVER be bricked by Aerodrome misbehaving (M-2 fix).
    ///      Returns whether the gauge withdrawal succeeded.
    function _unstakeSafe(uint256 amount) internal returns (bool ok) {
        if (amount == 0) return true;
        try IAeroGauge(gauge).withdraw(amount) { ok = true; }
        catch { ok = false; }
    }

    /// @notice Unstake everything (best-effort) and pause. Never reverts on a misbehaving gauge;
    ///         withdrawals from the vault still work against whatever want is recovered.
    function panic() external onlyOwner {
        _unstakeSafe(balanceOfPool());
        _pause();
    }

    /// @notice Owner emergency exit, gauge-independent: best-effort unstake, push ALL recoverable
    ///         want back to the vault (so it can satisfy withdrawals from idle), and pause. A gauge
    ///         that reverts on withdraw can no longer strand funds in this strategy.
    function emergencyWithdraw() external onlyOwner {
        _unstakeSafe(balanceOfPool());
        uint256 bal = balanceOfWant();
        if (bal > 0) IERC20(want).safeTransfer(vault, bal);
        _pause();
    }

    /// @notice Resume and re-stake idle want.
    function unpause() external onlyOwner {
        _unpause();
        deposit();
    }

    /// @notice Pause without unstaking (stops harvest/deposit).
    function pause() external onlyOwner {
        _pause();
    }

    /// @notice Migration hook: best-effort pull all LP out of the gauge and return it to the vault.
    /// @dev Tolerates a reverting gauge so a migration can still proceed with whatever is recoverable.
    ///      Pending rewards should be harvested (call {harvest}) before migrating.
    function retireStrat() external onlyVault {
        // Best-effort: claim & compound pending rewards before exit so yield isn't left behind
        // (reverts here — e.g. a manipulated spot tripping the TWAP floor — must not block migration).
        try this.harvest() {} catch {}
        _unstakeSafe(balanceOfPool());
        uint256 bal = balanceOfWant();
        if (bal > 0) IERC20(want).safeTransfer(vault, bal);
    }

    /// @notice Rescue tokens accidentally sent here. Cannot touch `want` (user funds).
    function inCaseTokensGetStuck(address token) external onlyOwner {
        require(token != want, "!want");
        uint256 bal = IERC20(token).balanceOf(address(this));
        IERC20(token).safeTransfer(owner(), bal);
    }

    // ────────────────────────────────────────────────────────────
    // Admin setters
    // ────────────────────────────────────────────────────────────

    function setKeeper(address keeper, bool allowed) external onlyOwner {
        keepers[keeper] = allowed;
        emit KeeperSet(keeper, allowed);
    }

    /// @notice Toggle whether harvest() is permissionless (true) or keeper-only (false).
    function setHarvestPublic(bool isPublic) external onlyOwner {
        harvestPublic = isPublic;
        emit HarvestPublicSet(isPublic);
    }

    /// @notice Tune the TWAP circuit-breaker floor used by {_swap}.
    /// @param granularity TWAP observation points (1–24).
    /// @param bps         Floor band in bps (≤ 2000 = 20%). Larger = more tolerant of volatility,
    ///                    less tight against manipulation.
    function setTwapParams(uint256 granularity, uint256 bps) external onlyOwner {
        require(granularity >= 1 && granularity <= 24, "1-24");
        require(bps <= 2_000, "max 20%");
        twapGranularity = granularity;
        twapSlippageBps = bps;
        emit TwapParamsSet(granularity, bps);
    }

    /// @dev Enabling harvestOnDeposit makes any deposit trigger _harvest (a public trigger that
    ///      bypasses the keeper gate). That path is still protected by the TWAP floor in {_swap},
    ///      but for maximum safety leave this off and let the keeper drive compounding.
    function setHarvestOnDeposit(bool v) external onlyOwner {
        harvestOnDeposit = v;
    }

    function setPerformanceFee(uint256 fee) external onlyOwner {
        require(fee <= MAX_FEE, "fee too high");
        require(callFee <= fee, "call > perf");
        emit PerformanceFeeUpdated(performanceFee, fee);
        performanceFee = fee;
    }

    function setCallFee(uint256 fee) external onlyOwner {
        require(fee <= performanceFee, "call > perf");
        emit CallFeeUpdated(callFee, fee);
        callFee = fee;
    }

    function setSlippage(uint256 bps) external onlyOwner {
        require(bps <= 500, "max 5%");
        slippageBps = bps;
    }

    function setMinHarvest(uint256 v) external onlyOwner {
        minHarvest = v;
    }

    function setTreasury(address t) external onlyOwner {
        require(t != address(0), "zero treasury");
        emit TreasuryUpdated(treasury, t);
        treasury = t;
    }

    /// @notice Set the reward route (output → lpToken0). Empty when output == lpToken0.
    function setRoutes(IAeroRouter.Route[] memory rewardRoute_) external onlyOwner {
        _setRoutes(rewardRoute_);
    }

    function _setRoutes(IAeroRouter.Route[] memory rewardRoute_) internal {
        delete rewardRoute;
        rewardPool = address(0);

        if (output == lpToken0) {
            require(rewardRoute_.length == 0, "no route needed");
            return;
        }
        // SINGLE-HOP ONLY: guarantees the output→hub compounding swap is always TWAP-floored. A
        // multi-hop reward leg would have no single TWAP pool and would compound with the spot
        // bound only — so it is rejected here rather than silently unprotected.
        require(
            rewardRoute_.length == 1 &&
            rewardRoute_[0].from == output &&
            rewardRoute_[0].to == lpToken0,
            "reward route must be single-hop output->lpToken0"
        );
        rewardRoute.push(rewardRoute_[0]);
        rewardPool = IAeroPoolFactory(factory).getPool(
            rewardRoute_[0].from, rewardRoute_[0].to, rewardRoute_[0].stable
        );
        require(rewardPool != address(0), "no reward pool for TWAP floor");
    }
}
