// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/EarnUSDC.sol";

contract Deploy is Script {
    // Base mainnet addresses
    address constant USDC       = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address constant MORPHO_VAULT = 0xeE8F4eC5672F09119b96Ab6fB59C27E1b7e44b61;

    function run() external {
        address treasury = vm.envAddress("TREASURY");
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");

        vm.startBroadcast(deployerKey);

        EarnUSDC vault = new EarnUSDC(
            IERC20(USDC),
            IERC4626(MORPHO_VAULT),
            treasury,
            1000,  // 10% performance fee
            true   // instant withdrawals
        );

        console.log("EarnUSDC deployed at:", address(vault));

        vm.stopBroadcast();
    }
}
