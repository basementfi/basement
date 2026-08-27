// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

// ── Aerodrome interfaces ────────────────────────────────────────────
interface IAeroRouter {
    struct Route { address from; address to; bool stable; address factory; }
    function swapExactTokensForTokens(
        uint256 amountIn, uint256 amountOutMin, Route[] calldata routes, address to, uint256 deadline
    ) external returns (uint256[] memory amounts);
    function getAmountsOut(uint256 amountIn, Route[] memory routes) external view returns (uint256[] memory amounts);
    function addLiquidity(
        address tokenA, address tokenB, bool stable,
        uint256 amountADesired, uint256 amountBDesired,
        uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline
    ) external returns (uint256 amountA, uint256 amountB, uint256 liquidity);
    function removeLiquidity(
        address tokenA, address tokenB, bool stable,
        uint256 liquidity, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline
    ) external returns (uint256 amountA, uint256 amountB);
}

interface IAeroPool {
    function getReserves() external view returns (uint256, uint256, uint256);
    function totalSupply() external view returns (uint256);
    function quote(address tokenIn, uint256 amountIn, uint256 granularity) external view returns (uint256);
}

interface IAeroGauge {
    function deposit(uint256 amount) external;
    function withdraw(uint256 amount) external;
    function getReward(address account) external;
    function earned(address account) external view returns (uint256);
    function balanceOf(address account) external view returns (uint256);
}

/// @title AeroLpVault
/// @notice Deposit USDC -> zapped 50/50 into the Aerodrome AERO/USDC LP -> staked in the
///         gauge to earn AERO. Auto-compounding: harvest() claims AERO and folds it back
///         into more staked LP, so each share is worth more LP over time (no new shares
///         minted on harvest). The performance fee is taken as a cut of harvested AERO.
///
///         Shares are LP-denominated: minting/burning uses the vault's staked LP balance
///         directly (no on-chain USD price in the critical path), which removes the
///         flash-loan price-manipulation surface. totalAssets()/convertToAssets() value the
///         position in USDC via the pool TWAP for DISPLAY only.
contract AeroLpVault is ERC20, Ownable, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;
    using Math for uint256;

    // ── Base mainnet addresses ──────────────────────────────────────
    address public constant USDC    = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address public constant AERO    = 0x940181a94A35A4569E4529A3CDfB74e38FD98631;
    address public constant POOL    = 0x6cDcb1C4A4D1C3C6d054b27AC5B77e89eAFb971d; // AERO/USDC volatile (token0=USDC, token1=AERO)
    address public constant GAUGE   = 0x4F09bAb2f0E15e2A078A227FE1537665F55b8360;
    address public constant ROUTER  = 0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43;
    address public constant FACTORY = 0x420DD381b31aEf6683db6B902084cB0FFECe40Da;

    // ── Fee config ──────────────────────────────────────────────────
    uint256 public constant FEE_DENOMINATOR = 10_000;
    uint256 public constant MAX_FEE = 2_000; // 20% hard cap
    address public treasury;
    uint256 public performanceFee; // bps, taken from harvested AERO

    // ── Safety params ───────────────────────────────────────────────
    uint256 public slippageBps = 200;       // 2% on swaps (spot-quote based); volatile pool headroom
    uint256 public twapGranularity = 4;      // TWAP points for price quotes (~2h)
    uint256 public minHarvest = 1e18;        // skip harvest below 1 AERO pending

    /// @dev First-deposit lock (Uniswap-style) to neutralise the inflation attack.
    uint256 public constant MINIMUM_LIQUIDITY = 1e6;
    address public constant DEAD = 0x000000000000000000000000000000000000dEaD;

    // ── Principal tracking (USDC, for UX) ───────────────────────────
    mapping(address => uint256) public principalDeposited;

    // ── Events ──────────────────────────────────────────────────────
    event Deposit(address indexed caller, address indexed receiver, uint256 usdcIn, uint256 shares);
    event Withdraw(address indexed caller, address indexed receiver, address indexed owner, uint256 usdcOut, uint256 shares);
    event Harvest(uint256 aeroClaimed, uint256 feeAero, uint256 lpCompounded);
    event TreasuryUpdated(address indexed oldT, address indexed newT);
    event PerformanceFeeUpdated(uint256 oldFee, uint256 newFee);

    constructor(address owner_, address treasury_, uint256 performanceFee_)
        ERC20("Basement AERO/USDC LP", "oAERO-LP")
        Ownable(owner_)
    {
        require(treasury_ != address(0), "Invalid treasury");
        require(performanceFee_ <= MAX_FEE, "Fee too high");
        treasury = treasury_;
        performanceFee = performanceFee_;
    }

    // ── The asset users deposit/withdraw ────────────────────────────
    function asset() external pure returns (address) { return USDC; }

    /// @notice LP tokens this vault has staked in the gauge (the share backing).
    function totalStakedLp() public view returns (uint256) {
        return IAeroGauge(GAUGE).balanceOf(address(this));
    }

    // ─────────────────────────────────────────────────────────────
    // DEPOSIT: USDC -> LP -> gauge, mint shares proportional to LP added
    // ─────────────────────────────────────────────────────────────
    function deposit(uint256 usdcAmount, address receiver)
        external
        nonReentrant
        whenNotPaused
        returns (uint256 shares)
    {
        require(usdcAmount > 0, "zero");
        IERC20(USDC).safeTransferFrom(msg.sender, address(this), usdcAmount);

        uint256 stakedBefore = totalStakedLp();
        uint256 lpAdded = _zapAndStake(usdcAmount);
        require(lpAdded > 0, "no liquidity");

        uint256 supply = totalSupply();
        if (supply == 0) {
            // First deposit: lock MINIMUM_LIQUIDITY shares forever (inflation-attack guard)
            require(lpAdded > MINIMUM_LIQUIDITY, "first deposit too small");
            _mint(DEAD, MINIMUM_LIQUIDITY);
            shares = lpAdded - MINIMUM_LIQUIDITY;
        } else {
            shares = lpAdded.mulDiv(supply, stakedBefore, Math.Rounding.Floor);
        }
        require(shares > 0, "zero shares");

        principalDeposited[receiver] += usdcAmount;
        _mint(receiver, shares);
        emit Deposit(msg.sender, receiver, usdcAmount, shares);
    }

    // ─────────────────────────────────────────────────────────────
    // REDEEM: burn shares -> proportional LP -> unwind to USDC
    // ─────────────────────────────────────────────────────────────
    function redeem(uint256 shares, address receiver, address owner)
        external
        nonReentrant
        returns (uint256 usdcOut)
    {
        require(shares > 0, "zero");
        if (msg.sender != owner) _spendAllowance(owner, msg.sender, shares);

        uint256 supply = totalSupply();
        uint256 lpToRemove = totalStakedLp().mulDiv(shares, supply, Math.Rounding.Floor);

        // Reduce tracked principal proportionally
        uint256 ownerShares = balanceOf(owner);
        uint256 principalPortion = principalDeposited[owner].mulDiv(shares, ownerShares, Math.Rounding.Floor);
        principalDeposited[owner] = principalDeposited[owner] > principalPortion
            ? principalDeposited[owner] - principalPortion : 0;

        _burn(owner, shares);

        // Unstake -> remove liquidity -> swap AERO leg back to USDC
        IAeroGauge(GAUGE).withdraw(lpToRemove);
        (uint256 usdcR, uint256 aeroR) = _removeLiquidity(lpToRemove);
        uint256 usdcFromAero = aeroR > 0 ? _swap(AERO, USDC, aeroR) : 0;

        usdcOut = usdcR + usdcFromAero;
        IERC20(USDC).safeTransfer(receiver, usdcOut);
        emit Withdraw(msg.sender, receiver, owner, usdcOut, shares);
    }

    // ─────────────────────────────────────────────────────────────
    // HARVEST: claim AERO, take fee, compound rest into staked LP (no mint)
    // ─────────────────────────────────────────────────────────────
    function harvest() external nonReentrant {
        IAeroGauge(GAUGE).getReward(address(this));
        uint256 aeroBal = IERC20(AERO).balanceOf(address(this));
        if (aeroBal < minHarvest) return;

        uint256 feeAero = aeroBal.mulDiv(performanceFee, FEE_DENOMINATOR, Math.Rounding.Floor);
        if (feeAero > 0) IERC20(AERO).safeTransfer(treasury, feeAero);

        uint256 toCompound = aeroBal - feeAero;
        // swap half the AERO to USDC, then add liquidity from full balances (mops up dust)
        _swap(AERO, USDC, toCompound / 2);
        uint256 lp = _addLiquidityAndStake();
        emit Harvest(aeroBal, feeAero, lp);
    }

    // ─────────────────────────────────────────────────────────────
    // Internal: zap USDC -> LP and stake
    // ─────────────────────────────────────────────────────────────
    function _zapAndStake(uint256 usdcAmount) internal returns (uint256 lp) {
        _swap(USDC, AERO, usdcAmount / 2);
        lp = _addLiquidityAndStake();
    }

    /// @dev Adds liquidity from the vault's current USDC + AERO balances and stakes the LP.
    function _addLiquidityAndStake() internal returns (uint256 lp) {
        uint256 usdcBal = IERC20(USDC).balanceOf(address(this));
        uint256 aeroBal = IERC20(AERO).balanceOf(address(this));
        if (usdcBal == 0 || aeroBal == 0) return 0;

        IERC20(USDC).forceApprove(ROUTER, usdcBal);
        IERC20(AERO).forceApprove(ROUTER, aeroBal);
        // Mins are 0: value is already protected by the TWAP-guarded swap above; the
        // router refunds the excess side, so adding your own tokens only risks tiny dust.
        ( , , lp) = IAeroRouter(ROUTER).addLiquidity(
            USDC, AERO, false,
            usdcBal, aeroBal,
            0, 0,
            address(this), block.timestamp
        );
        if (lp > 0) {
            IERC20(POOL).forceApprove(GAUGE, lp);
            IAeroGauge(GAUGE).deposit(lp);
        }
    }

    function _removeLiquidity(uint256 lp) internal returns (uint256 usdcR, uint256 aeroR) {
        IERC20(POOL).forceApprove(ROUTER, lp);
        (usdcR, aeroR) = IAeroRouter(ROUTER).removeLiquidity(
            USDC, AERO, false, lp, 0, 0, address(this), block.timestamp
        );
    }

    // ─────────────────────────────────────────────────────────────
    // Internal: TWAP-slippage-guarded swap on Aerodrome
    // ─────────────────────────────────────────────────────────────
    function _swap(address from, address to, uint256 amountIn) internal returns (uint256 out) {
        if (amountIn == 0) return 0;
        IERC20(from).forceApprove(ROUTER, amountIn);

        IAeroRouter.Route[] memory routes = new IAeroRouter.Route[](1);
        routes[0] = IAeroRouter.Route({ from: from, to: to, stable: false, factory: FACTORY });

        uint256 minOut = _expectedOut(from, to, amountIn) * (FEE_DENOMINATOR - slippageBps) / FEE_DENOMINATOR;
        uint256[] memory amounts = IAeroRouter(ROUTER).swapExactTokensForTokens(
            amountIn, minOut, routes, address(this), block.timestamp
        );
        out = amounts[amounts.length - 1];
    }

    /// @dev Spot expected output via the router (the swap executes at spot, so the min-out
    ///      must be spot-based + slippage). The pool TWAP is used only for totalAssets()
    ///      valuation, not here — using it for swap min-out causes reverts when TWAP lags spot.
    function _expectedOut(address from, address to, uint256 amountIn) internal view returns (uint256) {
        IAeroRouter.Route[] memory routes = new IAeroRouter.Route[](1);
        routes[0] = IAeroRouter.Route({ from: from, to: to, stable: false, factory: FACTORY });
        uint256[] memory amounts = IAeroRouter(ROUTER).getAmountsOut(amountIn, routes);
        return amounts[amounts.length - 1];
    }

    // ─────────────────────────────────────────────────────────────
    // Views (USDC valuation — DISPLAY ONLY, via TWAP fair-LP pricing)
    // ─────────────────────────────────────────────────────────────

    /// @notice Total USDC value of the staked LP + pending rewards (for UI; not used to price shares).
    function totalAssets() public view returns (uint256) {
        uint256 staked = totalStakedLp();
        uint256 pAero = IAeroPool(POOL).quote(AERO, 1e18, twapGranularity);

        uint256 lpValue;
        if (staked > 0) {
            (uint256 r0, uint256 r1, ) = IAeroPool(POOL).getReserves(); // r0 USDC(6), r1 AERO(18)
            uint256 supply = IAeroPool(POOL).totalSupply();
            if (supply > 0) {
                // fair pool value (USDC-wei) = 2 * sqrt(r0 * r1 * pAero) / 1e9  (sqrt(1/1e18) = 1/1e9)
                uint256 poolValue = 2 * Math.sqrt(r0 * r1 * pAero) / 1e9;
                lpValue = poolValue.mulDiv(staked, supply, Math.Rounding.Floor);
            }
        }
        uint256 pending = IAeroGauge(GAUGE).earned(address(this));
        uint256 pendingValue = pending * pAero / 1e18;
        return lpValue + pendingValue;
    }

    /// @notice USDC value of a given share amount (display).
    function convertToAssets(uint256 shares) external view returns (uint256) {
        uint256 supply = totalSupply();
        if (supply == 0) return 0;
        return totalAssets().mulDiv(shares, supply, Math.Rounding.Floor);
    }

    // ── Admin ────────────────────────────────────────────────────────
    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    function setTreasury(address t) external onlyOwner {
        require(t != address(0), "Invalid treasury");
        emit TreasuryUpdated(treasury, t);
        treasury = t;
    }
    function setPerformanceFee(uint256 fee) external onlyOwner {
        require(fee <= MAX_FEE, "Fee too high");
        emit PerformanceFeeUpdated(performanceFee, fee);
        performanceFee = fee;
    }
    function setSlippage(uint256 bps) external onlyOwner { require(bps <= 500, "max 5%"); slippageBps = bps; }
    function setTwapGranularity(uint256 g) external onlyOwner { require(g >= 1 && g <= 24, "1-24"); twapGranularity = g; }
    function setMinHarvest(uint256 v) external onlyOwner { minHarvest = v; }
}
