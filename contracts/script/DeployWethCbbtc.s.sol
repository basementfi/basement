// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/BasementAeroVault.sol";
import "../src/BasementAeroStrategy.sol";
import "../src/interfaces/IAerodrome.sol";

/// @notice Deploys the WETH/cbBTC volatile LP vault (reusing the generic stack + the shared BasementAeroZap).
///         Deposit token is WETH (or native ETH via wrap on the frontend). Compounding consolidates
///         ALL AERO -> WETH (via the AERO/WETH pool, TWAP-floored against that pool), then swaps half
///         the WETH -> cbBTC through the WANT pool (TWAP-floored against want). BOTH swaps are
///         manipulation-resistant, so harvest stays PUBLIC and sandwich-safe (no keeper needed).
///   source .env && forge script script/DeployWethCbbtc.s.sol:DeployWethCbbtc --rpc-url base --broadcast --verify
contract DeployWethCbbtc is Script {
    address constant AERO    = 0x940181a94A35A4569E4529A3CDfB74e38FD98631;
    address constant WETH    = 0x4200000000000000000000000000000000000006;
    address constant CBBTC   = 0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf;
    address constant POOL    = 0x2578365B3dfA7FfE60108e181EFb79FeDdec2319; // WETH/cbBTC volatile (token0=WETH, token1=cbBTC)
    address constant GAUGE   = 0xAFdEBa12B6a870d6639d043030b4b49F9C7c62BB;
    address constant ROUTER  = 0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43;
    address constant FACTORY = 0x420DD381b31aEf6683db6B902084cB0FFECe40Da;

    uint256 constant APPROVAL_DELAY = 2 days;
    uint256 constant CAP_WETH = 0.5 ether; // ~$1.4k test cap; set 0 in setDepositCap to uncap

    function run() external {
        address treasury    = vm.envAddress("TREASURY");
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address owner       = vm.addr(deployerKey);

        // Cap in WETH terms: pool is ~50/50 by value, so pool value (WETH) ≈ 2 × WETH reserve.
        (uint256 r0Weth, , ) = IAeroPool(POOL).getReserves();
        uint256 lpSupply = IAeroPool(POOL).totalSupply();
        uint256 capLp = lpSupply * CAP_WETH / (2 * r0Weth);

        vm.startBroadcast(deployerKey);

        BasementAeroVault vault = new BasementAeroVault(
            IERC20(POOL), "Basement WETH/cbBTC LP", "optWETH/cbBTC", owner, APPROVAL_DELAY
        );

        // Reward route: ALL AERO -> WETH (the hub leg). The cbBTC leg comes from swapping half the
        // WETH through the want pool — so only this one swap leaves the want pool, and it is
        // TWAP-floored against the auto-derived AERO/WETH pool.
        IAeroRouter.Route[] memory rewardRoute = new IAeroRouter.Route[](1);
        rewardRoute[0] = IAeroRouter.Route({ from: AERO, to: WETH, stable: false, factory: FACTORY });

        BasementAeroStrategy.Params memory p = BasementAeroStrategy.Params({
            want: POOL, lpToken0: WETH, lpToken1: CBBTC, stable: false, output: AERO,
            gauge: GAUGE, router: ROUTER, factory: FACTORY, vault: address(vault),
            treasury: treasury, performanceFee: 1000, callFee: 100
        });
        BasementAeroStrategy strategy = new BasementAeroStrategy(p, rewardRoute, owner);

        vault.setStrategy(address(strategy));
        vault.setDepositCap(vault.convertToShares(capLp));   // ~0.5 WETH cap (in shares; donation-immune)
        strategy.setMinHarvest(1e12);                         // test setting — raise for prod
        // harvest stays PUBLIC (default) — both compounding swaps are TWAP-floored.

        vm.stopBroadcast();

        console.log("BasementAeroVault (WETH/cbBTC):", address(vault));
        console.log("BasementAeroStrategy:        ", address(strategy));
        console.log("rewardPool (TWAP):        ", strategy.rewardPool());
        console.log("cap (LP):                 ", capLp);
    }
}
