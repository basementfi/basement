// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "./interfaces/IAerodrome.sol";
import "./interfaces/IBasementVault.sol";

/// @title BasementAeroZap
/// @notice One-token in/out router for {BasementAeroVault}s backed by an Aerodrome LP.
///
///         The vault's asset is the LP token; most users hold a single token (e.g. USDC).
///         {zapIn} swaps half of the input into the paired token, adds liquidity, and deposits
///         the resulting LP into the vault — minting shares straight to the user. {zapOut} does
///         the reverse: redeem shares → remove liquidity → swap one leg back → return one token.
///         Leftover dust from the imbalanced add/remove is refunded to the caller.
///
///         Generic across Aerodrome LP vaults: pool config (tokens / stable / router / factory)
///         is read from the vault's strategy, so one zap serves many vaults.
contract BasementAeroZap is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant FEE_DENOMINATOR = 10_000;
    uint256 public slippageBps = 200; // 2% guard on the internal swap leg (spot-quote based)

    event ZapIn(address indexed user, address indexed vault, address tokenIn, uint256 amountIn, uint256 shares);
    event ZapOut(address indexed user, address indexed vault, address tokenOut, uint256 shares, uint256 amountOut);

    constructor(address owner_) Ownable(owner_) {}

    struct Pool {
        address want;     // LP token (vault asset)
        address token0;
        address token1;
        bool    stable;
        address router;
        address factory;
    }

    function _pool(address vault) internal view returns (Pool memory p) {
        address strat = IBasementVault(vault).strategy();
        p.want = IAeroStrategyConfig(strat).want();
        p.token0 = IAeroStrategyConfig(strat).lpToken0();
        p.token1 = IAeroStrategyConfig(strat).lpToken1();
        p.stable = IAeroStrategyConfig(strat).stable();
        p.router = IAeroStrategyConfig(strat).router();
        p.factory = IAeroStrategyConfig(strat).factory();
        require(p.want == IBasementVault(vault).asset(), "want mismatch");
    }

    // ────────────────────────────────────────────────────────────
    // Zap in: tokenIn -> LP -> vault shares
    // ────────────────────────────────────────────────────────────

    /// @param vault     The BasementAeroVault to deposit into.
    /// @param tokenIn   Must be one of the pool's two tokens (e.g. USDC).
    /// @param amountIn  Amount of tokenIn to deposit.
    /// @param minShares Minimum vault shares to receive (end-to-end slippage protection).
    /// @param to        Recipient of the minted vault shares.
    function zapIn(address vault, address tokenIn, uint256 amountIn, uint256 minShares, address to)
        external
        nonReentrant
        returns (uint256 shares)
    {
        require(amountIn > 0, "zero in");
        require(minShares > 0, "minShares=0"); // end-to-end slippage bound is mandatory
        require(to != address(0), "zero to");
        Pool memory p = _pool(vault);
        require(tokenIn == p.token0 || tokenIn == p.token1, "bad tokenIn");
        address other = tokenIn == p.token0 ? p.token1 : p.token0;

        // snapshot pre-existing balances so refunds only ever return what THIS call produced
        uint256 keep0 = IERC20(p.token0).balanceOf(address(this));
        uint256 keep1 = IERC20(p.token1).balanceOf(address(this));

        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);

        // swap the fee-aware optimal portion of tokenIn into the paired token (minimises dust),
        // then add liquidity from both balances
        _swap(p, tokenIn, other, _optimalSwapIn(p, tokenIn, amountIn));
        uint256 lp = _addLiquidity(p, keep0, keep1);
        require(lp > 0, "no liquidity");

        IERC20(p.want).forceApprove(vault, lp);
        shares = IBasementVault(vault).deposit(lp, to);
        require(shares >= minShares, "slippage");

        _refundDust(p.token0, msg.sender, keep0);
        _refundDust(p.token1, msg.sender, keep1);
        emit ZapIn(msg.sender, vault, tokenIn, amountIn, shares);
    }

    /// @notice Zap in a token that is NOT one of the pool's tokens (e.g. USDC into a WETH/cbBTC
    ///         vault). It is first swapped into token0 (the hub) via the direct volatile pool, then
    ///         the normal optimal split into token1 + addLiquidity + deposit runs. End-to-end
    ///         slippage is bounded by the caller-supplied `minShares` (the user's own protection),
    ///         so a sandwiched intermediate swap can only make the whole deposit revert.
    /// @param tokenIn  A non-pool token with a direct volatile pool against token0.
    function zapInToken(address vault, address tokenIn, uint256 amountIn, uint256 minShares, address to)
        external
        nonReentrant
        returns (uint256 shares)
    {
        require(amountIn > 0, "zero in");
        require(minShares > 0, "minShares=0"); // end-to-end slippage bound is mandatory
        require(to != address(0), "zero to");
        Pool memory p = _pool(vault);
        require(tokenIn != p.token0 && tokenIn != p.token1, "use zapIn"); // pool tokens use zapIn
        require(IAeroPoolFactory(p.factory).getPool(tokenIn, p.token0, false) != address(0), "no route");

        // snapshot pre-existing balances so refunds only ever return what THIS call produced
        uint256 keepIn = IERC20(tokenIn).balanceOf(address(this));
        uint256 keep0 = IERC20(p.token0).balanceOf(address(this));
        uint256 keep1 = IERC20(p.token1).balanceOf(address(this));

        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);

        // 1. tokenIn -> token0 (hub), through the volatile hub pool validated above
        _swapVia(p, tokenIn, p.token0, amountIn, false);
        // 2. fee-aware optimal split: part of token0 -> token1 through the want pool, then add liquidity.
        //    Split only the hub produced by THIS call (exclude any pre-existing token0).
        uint256 hubBal = IERC20(p.token0).balanceOf(address(this)) - keep0;
        _swap(p, p.token0, p.token1, _optimalSwapIn(p, p.token0, hubBal));
        uint256 lp = _addLiquidity(p, keep0, keep1);
        require(lp > 0, "no liquidity");

        IERC20(p.want).forceApprove(vault, lp);
        shares = IBasementVault(vault).deposit(lp, to);
        require(shares >= minShares, "slippage");

        _refundDust(tokenIn, msg.sender, keepIn);
        _refundDust(p.token0, msg.sender, keep0);
        _refundDust(p.token1, msg.sender, keep1);
        emit ZapIn(msg.sender, vault, tokenIn, amountIn, shares);
    }

    // ────────────────────────────────────────────────────────────
    // Zap out: vault shares -> LP -> tokenOut
    // ────────────────────────────────────────────────────────────

    /// @dev Caller must have approved this zap to spend `shares` of the vault token.
    /// @param tokenOut Must be one of the pool's two tokens (e.g. USDC).
    /// @param minOut   Minimum amount of tokenOut to receive (end-to-end slippage protection).
    /// @param to       Recipient of tokenOut.
    function zapOut(address vault, uint256 shares, address tokenOut, uint256 minOut, address to)
        external
        nonReentrant
        returns (uint256 amountOut)
    {
        require(shares > 0, "zero shares");
        require(minOut > 0, "minOut=0"); // end-to-end slippage bound is mandatory
        require(to != address(0), "zero to");
        Pool memory p = _pool(vault);
        require(tokenOut == p.token0 || tokenOut == p.token1, "bad tokenOut");
        address other = tokenOut == p.token0 ? p.token1 : p.token0;

        // snapshot pre-existing balances so this call only pays out what IT produced
        uint256 keepOut = IERC20(tokenOut).balanceOf(address(this));
        uint256 keepOther = IERC20(other).balanceOf(address(this));

        // redeem shares (owner = caller) into LP held by this zap
        uint256 lp = IBasementVault(vault).redeem(shares, address(this), msg.sender);

        // remove liquidity → both legs, then swap the non-output leg (this call's only) into tokenOut
        IERC20(p.want).forceApprove(p.router, lp);
        IAeroRouter(p.router).removeLiquidity(
            p.token0, p.token1, p.stable, lp, 0, 0, address(this), block.timestamp
        );
        uint256 otherProduced = IERC20(other).balanceOf(address(this)) - keepOther;
        if (otherProduced > 0) _swap(p, other, tokenOut, otherProduced);

        amountOut = IERC20(tokenOut).balanceOf(address(this)) - keepOut;
        require(amountOut >= minOut, "slippage");
        IERC20(tokenOut).safeTransfer(to, amountOut);

        emit ZapOut(msg.sender, vault, tokenOut, shares, amountOut);
    }

    // ────────────────────────────────────────────────────────────
    // Display helper (estimate, spot-priced — not for on-chain pricing)
    // ────────────────────────────────────────────────────────────

    /// @notice Estimate the value of `shares` expressed in `quoteToken` (one of the pool tokens),
    ///         as if zapping out now at spot. For UI display only.
    function valueOfSharesInToken(address vault, uint256 shares, address quoteToken)
        external
        view
        returns (uint256)
    {
        Pool memory p = _pool(vault);
        require(quoteToken == p.token0 || quoteToken == p.token1, "bad quote");
        uint256 lp = IBasementVault(vault).convertToAssets(shares);
        if (lp == 0) return 0;

        (uint256 r0, uint256 r1, ) = IAeroPool(p.want).getReserves();
        uint256 supply = IAeroPool(p.want).totalSupply();
        if (supply == 0) return 0;

        uint256 amt0 = r0 * lp / supply;
        uint256 amt1 = r1 * lp / supply;

        address other = quoteToken == p.token0 ? p.token1 : p.token0;
        uint256 quoteSide = quoteToken == p.token0 ? amt0 : amt1;
        uint256 otherSide = quoteToken == p.token0 ? amt1 : amt0;
        return quoteSide + _amountOut(p, other, quoteToken, otherSide);
    }

    // ────────────────────────────────────────────────────────────
    // Internals
    // ────────────────────────────────────────────────────────────

    /// @dev Fee-aware optimal amount of `tokenIn` to swap into the paired token before adding
    ///      liquidity, so both legs pair with ~zero leftover dust. Derived for a constant-product
    ///      (volatile) pool with Aerodrome's fee model (fee subtracted from the input):
    ///
    ///        (10000−F)·s² + rA·(20000−F)·s − 10000·rA·a = 0
    ///        s = ( sqrt( rA²(20000−F)² + 40000(10000−F)·rA·a ) − rA(20000−F) ) / ( 2(10000−F) )
    ///
    ///      where rA = reserve of tokenIn, a = amountIn, F = pool fee in bps. Falls back to a
    ///      half-split for stable pools (no closed form) or if reserves/fee are unavailable.
    function _optimalSwapIn(Pool memory p, address tokenIn, uint256 amountIn)
        internal
        view
        returns (uint256 s)
    {
        if (p.stable) return amountIn / 2; // stable curve has no closed form; half-split + refund

        (uint256 r0, uint256 r1, ) = IAeroPool(p.want).getReserves();
        uint256 rA = tokenIn == p.token0 ? r0 : r1;
        if (rA == 0) return amountIn / 2;

        uint256 F = IAeroPoolFactory(p.factory).getFee(p.want, p.stable); // bps out of 10_000
        if (F >= 10_000) return amountIn / 2;

        uint256 k1 = 10_000 - F;                // (10000 − F)
        uint256 k2 = 20_000 - F;                // (20000 − F)
        uint256 k2rA = rA * k2;                 // B term = rA·(20000 − F)
        // discriminant = rA²(20000−F)² + 40000(10000−F)·rA·amountIn
        uint256 disc = rA * rA * k2 * k2 + 40_000 * k1 * rA * amountIn;
        uint256 root = Math.sqrt(disc);
        s = root > k2rA ? (root - k2rA) / (2 * k1) : amountIn / 2;
        if (s == 0 || s >= amountIn) s = amountIn / 2; // safety clamp
    }

    function _route(Pool memory p, address from, address to)
        internal
        pure
        returns (IAeroRouter.Route[] memory route)
    {
        route = new IAeroRouter.Route[](1);
        route[0] = IAeroRouter.Route({ from: from, to: to, stable: p.stable, factory: p.factory });
    }

    function _amountOut(Pool memory p, address from, address to, uint256 amountIn)
        internal
        view
        returns (uint256)
    {
        if (amountIn == 0) return 0;
        uint256[] memory amounts = IAeroRouter(p.router).getAmountsOut(amountIn, _route(p, from, to));
        return amounts[amounts.length - 1];
    }

    /// @dev Swap through the WANT pool (its `stable` type). Used for the token0↔token1 legs.
    function _swap(Pool memory p, address from, address to, uint256 amountIn) internal {
        _swapVia(p, from, to, amountIn, p.stable);
    }

    /// @dev Spot-slippage-bounded swap `from`->`to` through the pool of the given `stable` type.
    ///      zapInToken's tokenIn→hub hop uses `stable=false` (the hub pool is validated as volatile),
    ///      independent of the want pool's type.
    function _swapVia(Pool memory p, address from, address to, uint256 amountIn, bool stable) internal {
        if (amountIn == 0) return;
        IAeroRouter.Route[] memory route = new IAeroRouter.Route[](1);
        route[0] = IAeroRouter.Route({ from: from, to: to, stable: stable, factory: p.factory });
        IERC20(from).forceApprove(p.router, amountIn);
        uint256[] memory amounts = IAeroRouter(p.router).getAmountsOut(amountIn, route);
        uint256 minOut = amounts[amounts.length - 1] * (FEE_DENOMINATOR - slippageBps) / FEE_DENOMINATOR;
        IAeroRouter(p.router).swapExactTokensForTokens(amountIn, minOut, route, address(this), block.timestamp);
    }

    /// @dev Add liquidity from only the balances THIS call produced (above the pre-existing
    ///      `keep0/keep1`), so a two-sided in-ratio donation can never be folded into the caller's LP.
    function _addLiquidity(Pool memory p, uint256 keep0, uint256 keep1) internal returns (uint256 lp) {
        uint256 b0 = IERC20(p.token0).balanceOf(address(this)) - keep0;
        uint256 b1 = IERC20(p.token1).balanceOf(address(this)) - keep1;
        if (b0 == 0 || b1 == 0) return 0;
        IERC20(p.token0).forceApprove(p.router, b0);
        IERC20(p.token1).forceApprove(p.router, b1);
        ( , , lp) = IAeroRouter(p.router).addLiquidity(
            p.token0, p.token1, p.stable, b0, b1, 0, 0, address(this), block.timestamp
        );
    }

    /// @dev Refund only what THIS call produced above the pre-existing `keep` balance, so a call
    ///      never sweeps donated/residual dust left in the zap to its caller.
    function _refundDust(address token, address to, uint256 keep) internal {
        uint256 bal = IERC20(token).balanceOf(address(this));
        if (bal > keep) IERC20(token).safeTransfer(to, bal - keep);
    }

    // ────────────────────────────────────────────────────────────
    // Admin
    // ────────────────────────────────────────────────────────────

    function setSlippage(uint256 bps) external onlyOwner {
        require(bps <= 500, "max 5%");
        slippageBps = bps;
    }

    /// @notice Rescue stuck tokens (zap holds no funds between calls).
    function inCaseTokensGetStuck(address token, address to) external onlyOwner {
        IERC20(token).safeTransfer(to, IERC20(token).balanceOf(address(this)));
    }
}
