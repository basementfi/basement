// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./interfaces/IAerodrome.sol";

interface IEarnVault {
    function deposit(uint256 assets, address receiver) external returns (uint256 shares);
    function asset() external view returns (address);
}

/// @title MorphoZap
/// @notice One-tx deposit of USDC / WETH / cbBTC into ANY single-asset Earn vault (EarnUSDC, EarnETH,
///         EarnBTC). `tokenIn` is swapped to the vault's `asset()` on Aerodrome — routed through WETH
///         as the hub — then deposited. (ETH is handled frontend-side: wrap to WETH, then zap WETH.)
///         Generic sibling of EarnZap/BasementAeroZap. User deposits are protected end-to-end by the
///         caller-supplied `minShares`: a sandwich on the swap can only make the deposit revert.
contract MorphoZap is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ── Base mainnet addresses ──
    address public constant WETH    = 0x4200000000000000000000000000000000000006;
    address public constant USDC    = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address public constant CBBTC   = 0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf;
    address public constant ROUTER  = 0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43;
    address public constant FACTORY = 0x420DD381b31aEf6683db6B902084cB0FFECe40Da;

    error UnsupportedToken();
    error Slippage();

    /// @notice Swap `tokenIn` → the vault's asset (if needed) and deposit, minting shares to `to`.
    /// @param vault     a single-asset Earn vault whose asset() ∈ {USDC, WETH, cbBTC}
    /// @param tokenIn   USDC, WETH, or cbBTC
    /// @param amountIn  amount of tokenIn pulled from the caller
    /// @param minShares revert unless at least this many vault shares are minted (sandwich guard)
    /// @param to        share recipient
    function zapIn(address vault, address tokenIn, uint256 amountIn, uint256 minShares, address to)
        external
        nonReentrant
        returns (uint256 shares)
    {
        require(amountIn > 0, "amountIn=0");
        require(to != address(0), "to=0");
        address asset = IEarnVault(vault).asset();
        if (!_supported(tokenIn) || !_supported(asset)) revert UnsupportedToken();

        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);

        uint256 assetAmount = tokenIn == asset ? amountIn : _swap(tokenIn, asset, amountIn);

        IERC20(asset).forceApprove(vault, assetAmount);
        shares = IEarnVault(vault).deposit(assetAmount, to);
        if (shares < minShares) revert Slippage();

        // Zap is transient — return any residue to the caller.
        _refundDust(tokenIn, msg.sender);
        if (tokenIn != asset) _refundDust(asset, msg.sender);
    }

    /// @notice Off-chain helper: asset out for `amountIn` of `tokenIn` into `vault` (for sizing minShares).
    function previewAssetOut(address vault, address tokenIn, uint256 amountIn) external view returns (uint256) {
        address asset = IEarnVault(vault).asset();
        if (tokenIn == asset) return amountIn;
        IAeroRouter.Route[] memory route = _route(tokenIn, asset);
        uint256[] memory amounts = IAeroRouter(ROUTER).getAmountsOut(amountIn, route);
        return amounts[amounts.length - 1];
    }

    /// @dev Swap the full `amountIn` of tokenIn → asset. Per-hop minOut is 0; the end-to-end
    ///      `minShares` check in zapIn is the real slippage guard for the user.
    function _swap(address tokenIn, address asset, uint256 amountIn) internal returns (uint256) {
        IAeroRouter.Route[] memory route = _route(tokenIn, asset);
        IERC20(tokenIn).forceApprove(ROUTER, amountIn);
        uint256[] memory amounts = IAeroRouter(ROUTER).swapExactTokensForTokens(
            amountIn, 0, route, address(this), block.timestamp
        );
        return amounts[amounts.length - 1];
    }

    /// @dev Route tokenIn → asset through WETH as the hub. Caller guarantees tokenIn != asset and both
    ///      are supported, so exactly one of these shapes applies.
    function _route(address tokenIn, address asset) internal pure returns (IAeroRouter.Route[] memory route) {
        if (tokenIn == WETH || asset == WETH) {
            route = new IAeroRouter.Route[](1);
            route[0] = IAeroRouter.Route({ from: tokenIn, to: asset, stable: false, factory: FACTORY });
        } else {
            route = new IAeroRouter.Route[](2);
            route[0] = IAeroRouter.Route({ from: tokenIn, to: WETH, stable: false, factory: FACTORY });
            route[1] = IAeroRouter.Route({ from: WETH, to: asset, stable: false, factory: FACTORY });
        }
    }

    function _supported(address t) internal pure returns (bool) {
        return t == USDC || t == WETH || t == CBBTC;
    }

    /// @dev Sweep any residual `token` back to `to`; the zap holds nothing between calls.
    function _refundDust(address token, address to) internal {
        uint256 bal = IERC20(token).balanceOf(address(this));
        if (bal > 0) IERC20(token).safeTransfer(to, bal);
    }
}
