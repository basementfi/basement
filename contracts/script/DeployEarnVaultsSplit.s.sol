// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/EarnVaultV1.sol";
import "../src/EarnVaultV2.sol";

/// @notice Deploys the audited split Earn vaults:
///           • bUSDC, bBTC → EarnVaultV1 (Morpho v1.1 venues; limits bound to the underlying).
///           • bETH        → EarnVaultV2 (Morpho Vault V2 venue; cap-only limits).
///         Uncapped at launch (depositCap = 0). OWNER and TREASURY are the Basement Safe, so the
///         vaults are multisig-owned from construction. The broadcast signer (hardware wallet)
///         holds no ongoing power.
///
///   source .env && forge script script/DeployEarnVaultsSplit.s.sol:DeployEarnVaultsSplit \
///     --rpc-url base --broadcast --verify --trezor --sender <deployer address>
contract DeployEarnVaultsSplit is Script {
    // Base mainnet assets
    address constant USDC  = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address constant WETH  = 0x4200000000000000000000000000000000000006;
    address constant CBBTC = 0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf;

    // Underlying Morpho vaults (unchanged venues)
    address constant MORPHO_USDC  = 0xeE8F4eC5672F09119b96Ab6fB59C27E1b7e44b61; // Gauntlet USDC Prime (v1.1)
    address constant MORPHO_WETH  = 0xFeFeC33668E22677c4762d0853d56245a800ff08; // Gauntlet WETH (Vault V2)
    address constant MORPHO_CBBTC = 0x6770216aC60F634483Ec073cBABC4011c94307Cb; // Gauntlet cbBTC Core (v1.1)

    uint256 constant PERFORMANCE_FEE = 1000; // 10%

    function run() external {
        address owner = vm.envAddress("OWNER");       // the Basement Safe
        address treasury = vm.envAddress("TREASURY"); // also the Safe
        require(owner != address(0) && treasury != address(0), "set OWNER/TREASURY");

        vm.startBroadcast();

        EarnVaultV1 usdc = new EarnVaultV1(
            IERC20(USDC), IERC4626(MORPHO_USDC),
            "Basement Earn USDC", "bUSDC",
            owner, treasury, PERFORMANCE_FEE
        );
        EarnVaultV2 eth = new EarnVaultV2(
            IERC20(WETH), IERC4626(MORPHO_WETH),
            "Basement Earn ETH", "bETH",
            owner, treasury, PERFORMANCE_FEE
        );
        EarnVaultV1 btc = new EarnVaultV1(
            IERC20(CBBTC), IERC4626(MORPHO_CBBTC),
            "Basement Earn BTC", "bBTC",
            owner, treasury, PERFORMANCE_FEE
        );

        vm.stopBroadcast();

        console.log("bUSDC EarnVaultV1:", address(usdc));
        console.log("bETH  EarnVaultV2:", address(eth));
        console.log("bBTC  EarnVaultV1:", address(btc));
    }
}
