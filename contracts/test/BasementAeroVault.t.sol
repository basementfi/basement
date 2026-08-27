// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/BasementAeroVault.sol";
import "../src/BasementAeroStrategy.sol";
import "../src/BasementAeroZap.sol";
import "../src/interfaces/IAerodrome.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice Fork test against live Base. Run with the Alchemy key available:
///   source .env && forge test --match-contract BasementAeroVaultTest -vv
contract BasementAeroVaultTest is Test {
    BasementAeroVault vault;
    BasementAeroStrategy strat;
    BasementAeroZap zap;

    address constant USDC    = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address constant AERO    = 0x940181a94A35A4569E4529A3CDfB74e38FD98631;
    address constant POOL    = 0x6cDcb1C4A4D1C3C6d054b27AC5B77e89eAFb971d;
    address constant GAUGE   = 0x4F09bAb2f0E15e2A078A227FE1537665F55b8360;
    address constant ROUTER  = 0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43;
    address constant FACTORY = 0x420DD381b31aEf6683db6B902084cB0FFECe40Da;

    address user     = address(0xBEEF);
    address treasury = address(0xFEE);
    address keeper   = address(0xCA11); // harvest caller

    function setUp() public {
        vm.createSelectFork(vm.rpcUrl("base"));

        vault = new BasementAeroVault(IERC20(POOL), "Basement AERO/USDC LP", "optAERO/USDC", address(this), 2 days);

        IAeroRouter.Route[] memory rewardRoute = new IAeroRouter.Route[](1);
        rewardRoute[0] = IAeroRouter.Route({ from: AERO, to: USDC, stable: false, factory: FACTORY }); // output -> lp0

        BasementAeroStrategy.Params memory p = BasementAeroStrategy.Params({
            want: POOL, lpToken0: USDC, lpToken1: AERO, stable: false, output: AERO,
            gauge: GAUGE, router: ROUTER, factory: FACTORY, vault: address(vault),
            treasury: treasury, performanceFee: 1000, callFee: 100
        });
        strat = new BasementAeroStrategy(p, rewardRoute, address(this));
        vault.setStrategy(address(strat));

        zap = new BasementAeroZap(address(this));

        strat.setSlippage(300);   // 3% for fork-price wiggle
        zap.setSlippage(300);
        strat.setMinHarvest(1);   // harvest any non-zero pending in the test
        strat.setKeeper(keeper, true); // allow the keeper to call harvest()

        deal(USDC, user, 1_000e6);
    }

    function testZapInHarvestZapOut() public {
        // ── Zap in 1,000 USDC ──
        vm.startPrank(user);
        IERC20(USDC).approve(address(zap), type(uint256).max);
        uint256 shares = zap.zapIn(address(vault), USDC, 1_000e6, 1, user);
        vm.stopPrank();

        assertGt(shares, 0, "shares minted");
        assertEq(vault.balanceOf(user), shares, "user holds shares");
        assertGt(strat.balanceOfPool(), 0, "LP staked in gauge");
        emit log_named_uint("shares", shares);
        emit log_named_uint("LP staked", strat.balanceOfPool());
        emit log_named_uint("USDC value (display)", zap.valueOfSharesInToken(address(vault), shares, USDC));

        // ── Accrue + harvest (compounds into LP, mints no shares, pays fees) ──
        uint256 supplyBefore = vault.totalSupply();
        uint256 lpBefore = strat.balanceOf();
        skip(7 days);
        vm.prank(keeper);
        strat.harvest();

        assertGe(strat.balanceOf(), lpBefore, "LP did not decrease on harvest");
        assertEq(vault.totalSupply(), supplyBefore, "harvest must NOT mint shares");
        assertGt(IERC20(AERO).balanceOf(treasury), 0, "treasury got fee");
        assertGt(IERC20(AERO).balanceOf(keeper), 0, "caller got fee");
        emit log_named_uint("LP after harvest", strat.balanceOf());
        emit log_named_uint("treasury AERO fee", IERC20(AERO).balanceOf(treasury));
        emit log_named_uint("keeper AERO fee", IERC20(AERO).balanceOf(keeper));

        // ── Zap out everything to USDC ──
        vm.startPrank(user);
        vault.approve(address(zap), shares);
        uint256 usdcOut = zap.zapOut(address(vault), shares, USDC, 1, user);
        vm.stopPrank();

        emit log_named_uint("USDC out (zapOut)", usdcOut);
        uint256 finalUsdc = IERC20(USDC).balanceOf(user); // zapOut proceeds + any zapIn dust refund
        emit log_named_uint("final USDC balance", finalUsdc);
        assertGt(finalUsdc, 900e6, "round-trip lost too much");
        assertEq(vault.balanceOf(user), 0, "all shares burned");
    }

    function testDirectErc4626DepositWithdraw() public {
        // Build real LP via the router so we can test the raw ERC-4626 path.
        deal(USDC, user, 1_000e6);
        deal(AERO, user, 1_000e18);
        vm.startPrank(user);
        IERC20(USDC).approve(ROUTER, type(uint256).max);
        IERC20(AERO).approve(ROUTER, type(uint256).max);
        ( , , uint256 lp) = IAeroRouter(ROUTER).addLiquidity(
            USDC, AERO, false, 200e6, 200e18, 0, 0, user, block.timestamp
        );
        assertGt(lp, 0, "got LP");

        // Deposit LP directly into the vault (standard ERC-4626).
        IERC20(POOL).approve(address(vault), lp);
        uint256 shares = vault.deposit(lp, user);
        assertGt(shares, 0, "shares from direct deposit");
        assertEq(strat.balanceOfPool(), lp, "LP staked in gauge");
        vm.stopPrank();

        // Redeem all back to LP.
        vm.startPrank(user);
        uint256 lpOut = vault.redeem(shares, user, user);
        vm.stopPrank();
        emit log_named_uint("LP deposited", lp);
        emit log_named_uint("LP redeemed", lpOut);
        assertApproxEqRel(lpOut, lp, 0.001e18, "LP round-trips ~1:1");
    }

    function testHarvestGateToggle() public {
        // Default: public — anyone may call (no-op here, nothing staked/harvestable).
        vm.prank(address(0xDEAD));
        strat.harvest();

        // Owner can lock it down to keepers only.
        strat.setHarvestPublic(false);
        vm.prank(address(0xDEAD));
        vm.expectRevert(bytes("!keeper"));
        strat.harvest();

        // Allowlisted keeper still works while locked down.
        vm.prank(keeper);
        strat.harvest();
    }

    function testTwapFloorBlocksManipulatedHarvest() public {
        // Deposit + accrue rewards so harvest has something to compound.
        vm.startPrank(user);
        IERC20(USDC).approve(address(zap), type(uint256).max);
        zap.zapIn(address(vault), USDC, 1_000e6, 1, user);
        vm.stopPrank();
        skip(7 days);

        // Attacker crashes the AERO price by dumping a huge amount of AERO into the pool,
        // so the harvest's AERO->USDC swap would execute far below the TWAP.
        ( , uint256 aeroReserve, ) = IAeroPool(POOL).getReserves(); // r1 = AERO
        address attacker = address(0xBAD);
        deal(AERO, attacker, aeroReserve); // ~100% of reserves -> >>10% price move
        vm.startPrank(attacker);
        IERC20(AERO).approve(ROUTER, type(uint256).max);
        IAeroRouter.Route[] memory r = new IAeroRouter.Route[](1);
        r[0] = IAeroRouter.Route({ from: AERO, to: USDC, stable: false, factory: FACTORY });
        IAeroRouter(ROUTER).swapExactTokensForTokens(aeroReserve, 0, r, attacker, block.timestamp);
        vm.stopPrank();

        // Even though spot is now manipulated, the TWAP floor rejects the bad swap -> harvest reverts.
        vm.prank(keeper);
        vm.expectRevert();
        strat.harvest();
    }

    function testHarvestOnDeposit() public {
        strat.setHarvestOnDeposit(true);
        vm.startPrank(user);
        IERC20(USDC).approve(address(zap), type(uint256).max);
        uint256 shares = zap.zapIn(address(vault), USDC, 500e6, 1, user);
        vm.stopPrank();
        assertGt(shares, 0, "deposit with harvestOnDeposit works");

        // Second deposit triggers a harvest first; must still succeed.
        skip(3 days);
        deal(USDC, user, 500e6);
        vm.startPrank(user);
        uint256 shares2 = zap.zapIn(address(vault), USDC, 500e6, 1, user);
        vm.stopPrank();
        assertGt(shares2, 0, "second deposit ok");
    }

    function testDepositCap() public {
        // Seed 50 USDC, then cap at the current SHARE supply (cap is in shares now).
        vm.startPrank(user);
        IERC20(USDC).approve(address(zap), type(uint256).max);
        zap.zapIn(address(vault), USDC, 50e6, 1, user);
        vm.stopPrank();

        assertEq(vault.maxDeposit(user), type(uint256).max, "uncapped initially");
        uint256 supply = vault.totalSupply();
        vault.setDepositCap(supply); // cap at current share supply
        assertEq(vault.maxMint(user), 0, "no share room at cap");
        assertEq(vault.maxDeposit(user), 0, "no room at cap");

        // Further deposit reverts.
        deal(USDC, user, 50e6);
        vm.startPrank(user);
        vm.expectRevert();
        zap.zapIn(address(vault), USDC, 50e6, 1, user);
        vm.stopPrank();

        // Withdrawals still work at the cap.
        uint256 shares = vault.balanceOf(user);
        vm.startPrank(user);
        vault.approve(address(zap), shares);
        uint256 out = zap.zapOut(address(vault), shares, USDC, 1, user);
        vm.stopPrank();
        assertGt(out, 0, "can still exit at cap");

        // Raising the cap re-opens deposits.
        vault.setDepositCap(supply * 10);
        deal(USDC, user, 50e6);
        vm.startPrank(user);
        uint256 sh = zap.zapIn(address(vault), USDC, 50e6, 1, user);
        vm.stopPrank();
        assertGt(sh, 0, "deposit works after raising cap");
    }

    // ── FIX M-1: cap is donation-immune (capped on totalSupply, not totalAssets) ──
    function test_capGrief_donationDoesNotBrickDeposits() public {
        vm.startPrank(user);
        IERC20(USDC).approve(address(zap), type(uint256).max);
        zap.zapIn(address(vault), USDC, 50e6, 1, user);
        vm.stopPrank();

        uint256 supply = vault.totalSupply();
        vault.setDepositCap(supply * 3); // leave headroom for more deposits
        assertGt(vault.maxDeposit(user), 0, "room exists before grief");

        // Griefer donates LP far exceeding the old asset-cap to BOTH vault and strategy.
        // Pre-fix (cap on totalAssets) this bricked all deposits; post-fix it is inert.
        address grief = address(0x6471EF);
        deal(POOL, grief, 1e16);
        vm.startPrank(grief);
        IERC20(POOL).transfer(address(vault), 5e15);
        IERC20(POOL).transfer(address(strat), 5e15);
        vm.stopPrank();

        assertGt(vault.maxDeposit(user), 0, "donation did NOT brick deposits (FIXED)");
        deal(USDC, user, 50e6);
        vm.startPrank(user);
        uint256 sh = zap.zapIn(address(vault), USDC, 50e6, 1, user);
        vm.stopPrank();
        assertGt(sh, 0, "victim still deposits after a donation grief attempt");
    }

    // ── FIX H-1: strategy migration is timelocked (no instant owner rug) ──
    function test_setStrategyMigrationTimelock() public {
        BasementAeroStrategy strat2 = _deployStrat();

        // setStrategy is initial-only now; a migration must go through propose/upgrade.
        vm.expectRevert(bytes("use proposeStrategy"));
        vault.setStrategy(address(strat2));

        vault.proposeStrategy(address(strat2));
        vm.expectRevert(bytes("timelocked"));
        vault.upgradeStrategy(); // before delay

        skip(2 days);
        vault.upgradeStrategy(); // after delay
        assertEq(vault.strategy(), address(strat2), "migrated only after the timelock elapsed");
    }

    // ── FIX M-2: emergency exit is gauge-independent (survives a reverting gauge) ──
    function test_emergencyWithdraw_survivesDeadGauge() public {
        vm.startPrank(user);
        IERC20(USDC).approve(address(zap), type(uint256).max);
        zap.zapIn(address(vault), USDC, 100e6, 1, user);
        vm.stopPrank();
        deal(POOL, address(strat), 1e12); // idle want sitting in the strategy

        // Break the gauge: every withdraw reverts.
        vm.mockCallRevert(GAUGE, abi.encodeWithSelector(IAeroGauge.withdraw.selector), "gauge dead");

        uint256 vaultLpBefore = IERC20(POOL).balanceOf(address(vault));
        // Must NOT revert, and must push recoverable idle want to the vault despite the dead gauge.
        strat.emergencyWithdraw();
        assertGe(IERC20(POOL).balanceOf(address(vault)) - vaultLpBefore, 1e12 - 1, "idle want recovered");
    }

    function _deployStrat() internal returns (BasementAeroStrategy s) {
        IAeroRouter.Route[] memory rewardRoute = new IAeroRouter.Route[](1);
        rewardRoute[0] = IAeroRouter.Route({ from: AERO, to: USDC, stable: false, factory: FACTORY });
        BasementAeroStrategy.Params memory p = BasementAeroStrategy.Params({
            want: POOL, lpToken0: USDC, lpToken1: AERO, stable: false, output: AERO,
            gauge: GAUGE, router: ROUTER, factory: FACTORY, vault: address(vault),
            treasury: treasury, performanceFee: 1000, callFee: 100
        });
        s = new BasementAeroStrategy(p, rewardRoute, address(this));
    }
}
