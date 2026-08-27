// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/AeroLpVault.sol";

contract DeployAeroLpVault is Script {
    function run() external {
        address treasury = vm.envAddress("TREASURY");
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address owner = vm.addr(deployerKey); // the deployer EOA (NOT the script's msg.sender)

        vm.startBroadcast(deployerKey);

        AeroLpVault vault = new AeroLpVault(
            owner,
            treasury,
            1000          // 10% performance fee (on harvested AERO)
        );

        console.log("AeroLpVault deployed at:", address(vault));
        console.log("Treasury:               ", treasury);

        vm.stopBroadcast();
    }
}
