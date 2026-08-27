// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/EarnETH.sol";

contract DeployEarnETH is Script {
    // Base mainnet addresses
    address constant WETH         = 0x4200000000000000000000000000000000000006;
    address constant MORPHO_VAULT = 0xFeFeC33668E22677c4762d0853d56245a800ff08; // Gauntlet WETH Balanced

    function run() external {
        address treasury = vm.envAddress("TREASURY");
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");

        vm.startBroadcast(deployerKey);

        EarnETH vault = new EarnETH(
            IERC20(WETH),
            IERC4626(MORPHO_VAULT),
            treasury,
            1000,  // 10% performance fee — same as EarnUSDC
            true   // instant withdrawals
        );

        console.log("EarnETH deployed at:", address(vault));

        vm.stopBroadcast();
    }
}
