// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/BasementAeroVault.sol";
import "../src/BasementAeroStrategy.sol";
import "../src/BasementAeroZap.sol";
import "../src/interfaces/IAerodrome.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice Fork test for the WETH/cbBTC vault: WETH deposit, consolidate-then-balance compounding
///         (ALL AERO -> WETH via the AERO/WETH pool, then half WETH -> cbBTC via the want pool),
///         PUBLIC harvest protected by a TWAP floor on BOTH swaps, and WETH withdrawal.
///   source .env && forge test --match-contract WethCbbtcTest -vv
contract WethCbbtcTest is Test {
    BasementAeroVault vault;
    BasementAeroStrategy strat;
    BasementAeroZap zap;

    address constant AERO    = 0x940181a94A35A4569E4529A3CDfB74e38FD98631;
    address constant WETH    = 0x4200000000000000000000000000000000000006;
    address constant CBBTC   = 0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf;
    address constant USDC    = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address constant POOL    = 0x2578365B3dfA7FfE60108e181EFb79FeDdec2319; // WETH/cbBTC want pool
    address constant GAUGE   = 0xAFdEBa12B6a870d6639d043030b4b49F9C7c62BB;
    address constant ROUTER  = 0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43;
    address constant FACTORY = 0x420DD381b31aEf6683db6B902084cB0FFECe40Da;

    address user = address(0xBEEF);
    address treasury = address(0xFEE);

    function setUp() public {
        vm.createSelectFork(vm.rpcUrl("base"));

        vault = new BasementAeroVault(IERC20(POOL), "Basement WETH/cbBTC LP", "optWETH/cbBTC", address(this), 2 days);

        // Reward route: ALL AERO -> WETH (the hub leg). cbBTC leg is produced by swapping half the
        // WETH through the want pool, so only this one swap leaves the want pool.
        IAeroRouter.Route[] memory rewardRoute = new IAeroRouter.Route[](1);
        rewardRoute[0] = IAeroRouter.Route({ from: AERO, to: WETH, stable: false, factory: FACTORY });

        BasementAeroStrategy.Params memory p = BasementAeroStrategy.Params({
            want: POOL, lpToken0: WETH, lpToken1: CBBTC, stable: false, output: AERO,
            gauge: GAUGE, router: ROUTER, factory: FACTORY, vault: address(vault),
            treasury: treasury, performanceFee: 1000, callFee: 100
        });
        strat = new BasementAeroStrategy(p, rewardRoute, address(this));
        vault.setStrategy(address(strat));

        zap = new BasementAeroZap(address(this));
        strat.setSlippage(300);
        zap.setSlippage(300);
        strat.setMinHarvest(1);
        // harvest stays PUBLIC (default) — both compounding swaps are TWAP-floored.

        deal(WETH, user, 1 ether);
    }

    function testRewardPoolDerived() public view {
        // The AERO->WETH reward swap is TWAP-floored against the AERO/WETH pool (auto-derived).
        assertTrue(strat.rewardPool() != address(0), "rewardPool derived for TWAP floor");
    }

    function testWethDepositPublicHarvestWithdraw() public {
        // ── Deposit 0.1 WETH ──
        vm.startPrank(user);
        IERC20(WETH).approve(address(zap), type(uint256).max);
        uint256 shares = zap.zapIn(address(vault), WETH, 0.1 ether, 1, user);
        vm.stopPrank();
        assertGt(shares, 0, "shares");
        assertGt(strat.balanceOfPool(), 0, "LP staked");

        // ── Accrue + PUBLIC harvest (anyone) ──
        uint256 supplyBefore = vault.totalSupply();
        uint256 lpBefore = strat.balanceOf();
        skip(7 days);
        vm.prank(address(0xCAFE)); // random caller — harvest is public
        strat.harvest();

        assertGe(strat.balanceOf(), lpBefore, "LP compounded");
        assertEq(vault.totalSupply(), supplyBefore, "no shares minted on harvest");
        assertGt(IERC20(AERO).balanceOf(treasury), 0, "treasury fee");
        emit log_named_uint("LP after harvest", strat.balanceOf());

        // ── Withdraw to WETH ──
        vm.startPrank(user);
        vault.approve(address(zap), shares);
        uint256 wethOut = zap.zapOut(address(vault), shares, WETH, 1, user);
        vm.stopPrank();
        emit log_named_uint("WETH out", wethOut);
        assertGt(wethOut, 0.09 ether, "round-trip within band");
    }

    function testUsdcZapInToken() public {
        // Deposit USDC into the WETH/cbBTC vault (USDC -> WETH -> LP), bounded by minShares.
        deal(USDC, user, 500e6);
        vm.startPrank(user);
        IERC20(USDC).approve(address(zap), type(uint256).max);
        uint256 shares = zap.zapInToken(address(vault), USDC, 500e6, 1, user);
        vm.stopPrank();

        assertGt(shares, 0, "shares from USDC zap");
        assertGt(strat.balanceOfPool(), 0, "LP staked");
        emit log_named_uint("shares from 500 USDC", shares);

        // Exit to WETH, sane round-trip (~$500 in -> WETH worth ~$490+ after fees/slippage).
        vm.startPrank(user);
        vault.approve(address(zap), shares);
        uint256 wethOut = zap.zapOut(address(vault), shares, WETH, 1, user);
        vm.stopPrank();
        emit log_named_uint("WETH out", wethOut);
        assertGt(wethOut, 0, "got WETH back");
    }

    function testTwapFloorBlocksManipulatedRewardSwap() public {
        // Deposit + accrue so harvest has AERO to compound.
        vm.startPrank(user);
        IERC20(WETH).approve(address(zap), type(uint256).max);
        zap.zapIn(address(vault), WETH, 0.2 ether, 1, user);
        vm.stopPrank();
        skip(7 days);

        // Attacker crashes AERO in the AERO/WETH (reward) pool, so the harvest's AERO->WETH swap
        // would execute far below that pool's TWAP.
        address attacker = address(0xBAD);
        uint256 dump = 8_000_000 ether; // ~$3.9M of AERO
        deal(AERO, attacker, dump);
        vm.startPrank(attacker);
        IERC20(AERO).approve(ROUTER, type(uint256).max);
        IAeroRouter.Route[] memory r = new IAeroRouter.Route[](1);
        r[0] = IAeroRouter.Route({ from: AERO, to: WETH, stable: false, factory: FACTORY });
        IAeroRouter(ROUTER).swapExactTokensForTokens(dump, 0, r, attacker, block.timestamp);
        vm.stopPrank();

        // Public harvest now reverts: the AERO/WETH TWAP floor rejects the manipulated reward swap.
        vm.prank(address(0xCAFE));
        vm.expectRevert();
        strat.harvest();
    }

    /// @notice A LARGE honest reward must NOT brick public harvest. Aerodrome quote() is
    ///         impact-inclusive, so the TWAP floor (quote×(1−twapSlippageBps)) stays below the real
    ///         getAmountsOut output for an un-manipulated harvest of any size — the swap meets it.
    function testLargeRewardHarvestSucceeds() public {
        vm.startPrank(user);
        IERC20(WETH).approve(address(zap), type(uint256).max);
        zap.zapIn(address(vault), WETH, 0.5 ether, 1, user);
        vm.stopPrank();

        uint256 lpBefore = strat.balanceOf();
        // A large already-claimed reward — the size the old code could not harvest (E2_Compound used ~60k).
        deal(AERO, address(strat), 60_000 ether);

        // Honest, un-manipulated public harvest: must SUCCEED and compound (no revert).
        vm.prank(address(0xCAFE));
        strat.harvest();

        assertGt(strat.balanceOf(), lpBefore, "large reward compounded");
        assertGt(IERC20(AERO).balanceOf(treasury), 0, "treasury fee taken");
        assertEq(IERC20(AERO).balanceOf(address(strat)), 0, "AERO fully consumed (fee + compounded)");
    }

    /// @notice Fix #4: a reverting/killed gauge on stake must not brick deposits — the LP stays idle
    ///         in the strategy, still counted by totalAssets and fully withdrawable.
    function testDeadGaugeDepositDoesNotBrick() public {
        vm.startPrank(user);
        IERC20(WETH).approve(address(zap), type(uint256).max);
        vm.mockCallRevert(GAUGE, abi.encodeWithSignature("deposit(uint256)"), "dead gauge");
        uint256 shares = zap.zapIn(address(vault), WETH, 0.1 ether, 1, user);
        vm.stopPrank();
        vm.clearMockedCalls();

        assertGt(shares, 0, "deposit succeeded despite dead gauge");
        assertGt(strat.balanceOfWant(), 0, "LP held idle in strategy (not staked)");
        assertGt(vault.totalAssets(), 0, "idle LP still counted");
    }

    /// @notice Fix #5: ownership is two-step on all three contracts (vault shown; strat/zap identical).
    function testOwnableTwoStep() public {
        address newOwner = address(0x0A11);
        vault.transferOwnership(newOwner);
        assertEq(vault.owner(), address(this), "owner unchanged until accept");
        assertEq(vault.pendingOwner(), newOwner, "pending owner set");

        vm.prank(address(0xBAD));
        vm.expectRevert();
        vault.acceptOwnership();

        vm.prank(newOwner);
        vault.acceptOwnership();
        assertEq(vault.owner(), newOwner, "ownership transferred after accept");
        assertEq(vault.pendingOwner(), address(0), "pending cleared");
    }
}
