// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/EarnVault.sol";

/// @notice Deploys the three generic EarnVault instances (bUSDC / bETH / bBTC),
///         replacing the retired copy-paste EarnUSDC / EarnETH / EarnBTC.
///         Uncapped at launch (depositCap = 0); MorphoZap is reused as-is.
///
///         The broadcast signer comes from the CLI (hardware wallet / keystore),
///         not from an env key, and holds no ongoing power. OWNER and TREASURY
///         are the Basement Safe: the vaults are multisig-owned from construction
///         and fee shares accrue to it.
///   source .env && forge script script/DeployEarnVaults.s.sol:DeployEarnVaults \
///     --rpc-url base --broadcast --verify --trezor --sender <deployer address>
contract DeployEarnVaults is Script {
    // Base mainnet assets
    address constant USDC  = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address constant WETH  = 0x4200000000000000000000000000000000000006;
    address constant CBBTC = 0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf;

    // Underlying Morpho vaults (unchanged from the original deployments)
    address constant MORPHO_USDC  = 0xeE8F4eC5672F09119b96Ab6fB59C27E1b7e44b61;
    address constant MORPHO_WETH  = 0xFeFeC33668E22677c4762d0853d56245a800ff08; // Gauntlet WETH
    address constant MORPHO_CBBTC = 0x6770216aC60F634483Ec073cBABC4011c94307Cb; // Gauntlet cbBTC Core

    uint256 constant PERFORMANCE_FEE = 1000; // 10%, same as before

    function run() external {
        address owner = vm.envAddress("OWNER");       // the Basement Safe
        address treasury = vm.envAddress("TREASURY"); // also the Safe
        require(owner != address(0) && treasury != address(0), "set OWNER/TREASURY");

        vm.startBroadcast();

        EarnVault usdc = new EarnVault(
            IERC20(USDC), IERC4626(MORPHO_USDC),
            "Basement Earn USDC", "bUSDC",
            owner, treasury, PERFORMANCE_FEE
        );
        EarnVault eth = new EarnVault(
            IERC20(WETH), IERC4626(MORPHO_WETH),
            "Basement Earn ETH", "bETH",
            owner, treasury, PERFORMANCE_FEE
        );
        EarnVault btc = new EarnVault(
            IERC20(CBBTC), IERC4626(MORPHO_CBBTC),
            "Basement Earn BTC", "bBTC",
            owner, treasury, PERFORMANCE_FEE
        );

        vm.stopBroadcast();

        console.log("bUSDC EarnVault:", address(usdc));
        console.log("bETH  EarnVault:", address(eth));
        console.log("bBTC  EarnVault:", address(btc));
    }
}
