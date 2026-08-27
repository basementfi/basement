// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/MorphoZap.sol";

/// @notice Deploys the generic MorphoZap (USDC/WETH/cbBTC -> any Earn vault asset).
///   source .env && forge script script/DeployMorphoZap.s.sol:DeployMorphoZap --rpc-url base --broadcast --verify
contract DeployMorphoZap is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(deployerKey);
        MorphoZap zap = new MorphoZap();
        vm.stopBroadcast();
        console.log("MorphoZap deployed at:", address(zap));
    }
}
