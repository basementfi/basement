// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Minimal strategy surface the BasementAeroVault relies on.
interface IStrategy {
    /// @notice The token the strategy farms with — equals the vault's ERC-4626 asset (the LP token).
    function want() external view returns (address);
    /// @notice Total `want` controlled by the strategy (idle + staked in the gauge).
    function balanceOf() external view returns (uint256);
    /// @notice Stake any `want` currently sitting in the strategy.
    function deposit() external;
    /// @notice Send `amount` of `want` back to the vault (unstaking from the gauge if needed).
    function withdraw(uint256 amount) external;
    /// @notice Hook the vault calls before pricing a deposit (used for harvest-on-deposit).
    function beforeDeposit() external;
    /// @notice Migration: pull everything back to the vault.
    function retireStrat() external;
}

/// @notice Minimal vault surface the zap/strategy rely on.
interface IBasementVault {
    function asset() external view returns (address);
    function strategy() external view returns (address);
    function deposit(uint256 assets, address receiver) external returns (uint256 shares);
    function redeem(uint256 shares, address receiver, address owner) external returns (uint256 assets);
    function balanceOf(address account) external view returns (uint256);
    function convertToAssets(uint256 shares) external view returns (uint256);
    function totalSupply() external view returns (uint256);
}

/// @notice Aerodrome-pool config a zap reads off a strategy to build LPs.
interface IAeroStrategyConfig {
    function want() external view returns (address);       // the LP / pool token
    function lpToken0() external view returns (address);
    function lpToken1() external view returns (address);
    function stable() external view returns (bool);
    function router() external view returns (address);
    function factory() external view returns (address);
}
