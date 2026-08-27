// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Aerodrome (Velodrome/Solidly fork) router.
interface IAeroRouter {
    struct Route {
        address from;
        address to;
        bool stable;
        address factory;
    }

    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        Route[] calldata routes,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts);

    function getAmountsOut(uint256 amountIn, Route[] memory routes)
        external
        view
        returns (uint256[] memory amounts);

    function addLiquidity(
        address tokenA,
        address tokenB,
        bool stable,
        uint256 amountADesired,
        uint256 amountBDesired,
        uint256 amountAMin,
        uint256 amountBMin,
        address to,
        uint256 deadline
    ) external returns (uint256 amountA, uint256 amountB, uint256 liquidity);

    function removeLiquidity(
        address tokenA,
        address tokenB,
        bool stable,
        uint256 liquidity,
        uint256 amountAMin,
        uint256 amountBMin,
        address to,
        uint256 deadline
    ) external returns (uint256 amountA, uint256 amountB);
}

/// @notice Aerodrome pool (LP token).
interface IAeroPool {
    function getReserves() external view returns (uint256, uint256, uint256);
    function totalSupply() external view returns (uint256);
    function token0() external view returns (address);
    function token1() external view returns (address);
    function stable() external view returns (bool);
    /// @dev TWAP-style price quote: amount of tokenOut for `amountIn` of tokenIn, averaged over `granularity` points.
    function quote(address tokenIn, uint256 amountIn, uint256 granularity) external view returns (uint256);
}

/// @notice Aerodrome pool factory — exposes the per-pool swap fee.
interface IAeroPoolFactory {
    /// @return fee in basis points out of 10_000 (e.g. 30 = 0.30%).
    function getFee(address pool, bool stable) external view returns (uint256);
    /// @return the pool for a token pair + type (address(0) if none).
    function getPool(address tokenA, address tokenB, bool stable) external view returns (address);
}

/// @notice Aerodrome gauge (stakes the LP token, emits AERO).
interface IAeroGauge {
    function deposit(uint256 amount) external;
    function withdraw(uint256 amount) external;
    function getReward(address account) external;
    function earned(address account) external view returns (uint256);
    function balanceOf(address account) external view returns (uint256);
}
