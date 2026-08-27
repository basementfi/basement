// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/EarnBTC.sol";
import "../src/EarnZap.sol";

/// @notice Deploys EarnBTC (Gauntlet cbBTC Core wrapper) + EarnZap (USDC/WETH→cbBTC deposit router).
///   source .env && forge script script/DeployEarnBTC.s.sol:DeployEarnBTC --rpc-url base --broadcast --verify
contract DeployEarnBTC is Script {
    // Base mainnet addresses
    address constant CBBTC        = 0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf;
    address constant MORPHO_CBBTC = 0x6770216aC60F634483Ec073cBABC4011c94307Cb; // Gauntlet cbBTC Core

    function run() external {
        address treasury = vm.envAddress("TREASURY");
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");

        vm.startBroadcast(deployerKey);

        EarnBTC vault = new EarnBTC(
            IERC20(CBBTC),
            IERC4626(MORPHO_CBBTC),
            treasury,
            1000 // 10% performance fee — same as EarnUSDC / EarnETH
        );
        EarnZap zap = new EarnZap();

        vm.stopBroadcast();

        console.log("EarnBTC deployed at:", address(vault));
        console.log("EarnZap deployed at:", address(zap));
    }
}
