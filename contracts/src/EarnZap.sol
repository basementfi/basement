// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./interfaces/IAerodrome.sol";

interface IEarnVault {
    function deposit(uint256 assets, address receiver) external returns (uint256 shares);
    function asset() external view returns (address);
}

/// @title EarnZap
/// @notice One-tx deposit of USDC / WETH / cbBTC into a cbBTC-denominated Earn vault (EarnBTC).
///         Non-cbBTC tokens are swapped to cbBTC on Aerodrome first (USDC→WETH→cbBTC, WETH→cbBTC),
///         then deposited. (ETH is handled by the frontend: wrap to WETH, then zap WETH.)
///         User deposits are protected end-to-end by the caller-supplied `minShares` — a sandwich on
///         the swap can only make the deposit revert, never drain past the user's slippage tolerance.
contract EarnZap is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ── Base mainnet addresses ──
    address public constant CBBTC   = 0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf;
    address public constant WETH    = 0x4200000000000000000000000000000000000006;
    address public constant USDC    = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address public constant ROUTER  = 0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43;
    address public constant FACTORY = 0x420DD381b31aEf6683db6B902084cB0FFECe40Da;

    error UnsupportedToken();
    error Slippage();

    /// @notice Swap `tokenIn` → cbBTC (if needed) and deposit into `vault`, minting shares to `to`.
    /// @param vault     the cbBTC-denominated Earn vault (asset() must be cbBTC)
    /// @param tokenIn   USDC, WETH, or cbBTC
    /// @param amountIn  amount of tokenIn to pull from the caller
    /// @param minShares revert unless at least this many vault shares are minted (sandwich guard)
    /// @param to        share recipient
    function zapIn(address vault, address tokenIn, uint256 amountIn, uint256 minShares, address to)
        external
        nonReentrant
        returns (uint256 shares)
    {
        require(amountIn > 0, "amountIn=0");
        require(to != address(0), "to=0");
        require(IEarnVault(vault).asset() == CBBTC, "vault!=cbBTC");

        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);

        uint256 cbbtcAmount = tokenIn == CBBTC ? amountIn : _swapToCbbtc(tokenIn, amountIn);

        IERC20(CBBTC).forceApprove(vault, cbbtcAmount);
        shares = IEarnVault(vault).deposit(cbbtcAmount, to);
        if (shares < minShares) revert Slippage();

        // Zap is transient — return any residue to the caller.
        _refundDust(tokenIn, msg.sender);
        if (tokenIn != CBBTC) _refundDust(CBBTC, msg.sender);
    }

    /// @dev Build the Aerodrome route for tokenIn→cbBTC and swap the full amount. Per-hop minOut is 0;
    ///      the end-to-end `minShares` check in zapIn is the real slippage guard for the user.
    function _swapToCbbtc(address tokenIn, uint256 amountIn) internal returns (uint256) {
        IAeroRouter.Route[] memory route;
        if (tokenIn == WETH) {
            route = new IAeroRouter.Route[](1);
            route[0] = IAeroRouter.Route({ from: WETH, to: CBBTC, stable: false, factory: FACTORY });
        } else if (tokenIn == USDC) {
            route = new IAeroRouter.Route[](2);
            route[0] = IAeroRouter.Route({ from: USDC, to: WETH, stable: false, factory: FACTORY });
            route[1] = IAeroRouter.Route({ from: WETH, to: CBBTC, stable: false, factory: FACTORY });
        } else {
            revert UnsupportedToken();
        }

        IERC20(tokenIn).forceApprove(ROUTER, amountIn);
        uint256[] memory amounts = IAeroRouter(ROUTER).swapExactTokensForTokens(
            amountIn, 0, route, address(this), block.timestamp
        );
        return amounts[amounts.length - 1];
    }

    /// @dev Sweep any residual `token` back to `to`. The zap holds nothing between calls, so this only
    ///      ever returns the caller's own dust (or opportunistically forwards mis-sent tokens).
    function _refundDust(address token, address to) internal {
        uint256 bal = IERC20(token).balanceOf(address(this));
        if (bal > 0) IERC20(token).safeTransfer(to, bal);
    }

    /// @notice Off-chain helper: cbBTC out for `amountIn` of `tokenIn` (for sizing minShares in the UI).
    function previewCbbtcOut(address tokenIn, uint256 amountIn) external view returns (uint256) {
        if (tokenIn == CBBTC) return amountIn;
        IAeroRouter.Route[] memory route;
        if (tokenIn == WETH) {
            route = new IAeroRouter.Route[](1);
            route[0] = IAeroRouter.Route({ from: WETH, to: CBBTC, stable: false, factory: FACTORY });
        } else if (tokenIn == USDC) {
            route = new IAeroRouter.Route[](2);
            route[0] = IAeroRouter.Route({ from: USDC, to: WETH, stable: false, factory: FACTORY });
            route[1] = IAeroRouter.Route({ from: WETH, to: CBBTC, stable: false, factory: FACTORY });
        } else {
            revert UnsupportedToken();
        }
        uint256[] memory amounts = IAeroRouter(ROUTER).getAmountsOut(amountIn, route);
        return amounts[amounts.length - 1];
    }
}
