// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/BasementAeroVault.sol";
import "../src/BasementAeroStrategy.sol";
import "../src/BasementAeroZap.sol";
import "../src/interfaces/IAerodrome.sol";

/// @notice Deploys the audited, Safe-owned Basement Aerodrome LP stack: two (vault, strategy) pairs
///         (USDC/AERO + WETH/cbBTC) and one shared zap. OWNER and TREASURY are the Basement Safe from
///         construction (Ownable2Step), so the vaults are multisig-owned immediately.
///
///         Because owner == Safe, `setStrategy` (onlyOwner) is NOT called here — it is a one-time
///         Safe transaction per vault (calldata printed below; or use the admin Deployment page).
///         Uncapped at launch; set caps later via the Safe. Broadcast from a fresh EOA/hardware wallet.
///
///   source .env && forge script script/DeployBasementAero.s.sol:DeployBasementAero \
///     --rpc-url base --broadcast --verify --trezor --sender <deployer>
contract DeployBasementAero is Script {
    // Common
    address constant AERO    = 0x940181a94A35A4569E4529A3CDfB74e38FD98631;
    address constant USDC    = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address constant WETH    = 0x4200000000000000000000000000000000000006;
    address constant CBBTC   = 0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf;
    address constant ROUTER  = 0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43;
    address constant FACTORY = 0x420DD381b31aEf6683db6B902084cB0FFECe40Da;
    uint256 constant APPROVAL_DELAY = 2 days; // strategy-migration timelock (immutable)
    uint256 constant FEE     = 1000; // 10% performance fee
    uint256 constant CALLFEE = 100;  // 1% of the reward to the harvest caller

    // USDC/AERO pool (token0 = USDC, token1 = AERO)
    address constant POOL_UA  = 0x6cDcb1C4A4D1C3C6d054b27AC5B77e89eAFb971d;
    address constant GAUGE_UA = 0x4F09bAb2f0E15e2A078A227FE1537665F55b8360;

    // WETH/cbBTC pool (token0 = WETH, token1 = cbBTC)
    address constant POOL_WB  = 0x2578365B3dfA7FfE60108e181EFb79FeDdec2319;
    address constant GAUGE_WB = 0xAFdEBa12B6a870d6639d043030b4b49F9C7c62BB;

    function run() external {
        address safe = vm.envAddress("OWNER");       // the Basement Safe (owner)
        address treasury = vm.envAddress("TREASURY"); // also the Safe
        require(safe != address(0) && treasury != address(0), "set OWNER/TREASURY");

        vm.startBroadcast();

        BasementAeroZap zap = new BasementAeroZap(safe);

        (address vUA, address sUA) = _deployPair(
            "Basement USDC/AERO LP", "bUSDC/AERO", POOL_UA, USDC, AERO, GAUGE_UA, USDC, safe, treasury
        );
        (address vWB, address sWB) = _deployPair(
            "Basement WETH/cbBTC LP", "bWETH/cbBTC", POOL_WB, WETH, CBBTC, GAUGE_WB, WETH, safe, treasury
        );

        vm.stopBroadcast();

        console.log("BasementAeroZap:            ", address(zap));
        console.log("USDC/AERO  vault:           ", vUA);
        console.log("USDC/AERO  strategy:        ", sUA);
        console.log("WETH/cbBTC vault:           ", vWB);
        console.log("WETH/cbBTC strategy:        ", sWB);
        console.log("--- Safe must call setStrategy on each vault (onlyOwner) ---");
        console.logBytes(abi.encodeWithSignature("setStrategy(address)", sUA));
        console.logBytes(abi.encodeWithSignature("setStrategy(address)", sWB));
    }

    /// @param rewardTo lpToken0 (the hub the reward AERO is consolidated into).
    function _deployPair(
        string memory name_, string memory symbol_, address pool,
        address lp0, address lp1, address gauge, address rewardTo,
        address owner_, address treasury_
    ) internal returns (address vault, address strategy) {
        BasementAeroVault v = new BasementAeroVault(IERC20(pool), name_, symbol_, owner_, APPROVAL_DELAY);

        IAeroRouter.Route[] memory rewardRoute = new IAeroRouter.Route[](1);
        rewardRoute[0] = IAeroRouter.Route({ from: AERO, to: rewardTo, stable: false, factory: FACTORY });

        BasementAeroStrategy.Params memory p = BasementAeroStrategy.Params({
            want: pool, lpToken0: lp0, lpToken1: lp1, stable: false, output: AERO,
            gauge: gauge, router: ROUTER, factory: FACTORY, vault: address(v),
            treasury: treasury_, performanceFee: FEE, callFee: CALLFEE
        });
        BasementAeroStrategy s = new BasementAeroStrategy(p, rewardRoute, owner_);
        return (address(v), address(s));
    }
}
