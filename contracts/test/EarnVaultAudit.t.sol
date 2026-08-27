// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/interfaces/IERC4626.sol";
import "../src/EarnVault.sol";

/// @notice Adversarial audit tests: inflation from an empty vault, donation
///         griefing, and nested-4626 full-exit rounding. Run on a Base fork
///         against the live Gauntlet USDC Prime vault (the bUSDC venue).
contract EarnVaultAuditTest is Test {
    address constant USDC   = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address constant MORPHO = 0xeE8F4eC5672F09119b96Ab6fB59C27E1b7e44b61; // Gauntlet USDC Prime
    address constant TREASURY = 0xa60Ad2DFD253f2E1d8395D48454C1977092E303C;
    address constant OWNER = address(0xA11CE);

    EarnVault vault;
    address attacker = address(0xBAD);
    address victim = address(0x900D);

    function setUp() public {
        vm.createSelectFork(vm.rpcUrl("base"), 47620000);
        vault = new EarnVault(IERC20(USDC), IERC4626(MORPHO), "Basement Earn USDC", "bUSDC", OWNER, TREASURY, 1000);
    }

    function _pos(address who) internal view returns (uint256) {
        return vault.convertToAssets(vault.balanceOf(who));
    }

    /// First-depositor inflation attack from an empty vault: attacker seeds 1
    /// unit, donates a large amount of Morpho shares to inflate share price,
    /// then a victim deposits. The victim must still receive shares worth ~their
    /// deposit — the 1e6 offset must make the steal uneconomical.
    function test_inflationAttack_victimNotRobbed() public {
        // Attacker seeds the empty vault with 1 unit of USDC.
        deal(USDC, attacker, 1);
        vm.startPrank(attacker);
        IERC20(USDC).approve(address(vault), 1);
        vault.deposit(1, attacker);
        vm.stopPrank();

        // Attacker donates 10,000 USDC worth of Morpho shares straight to the vault
        // (the only donation vector: transfer the underlying Morpho shares in).
        uint256 donation = 10_000e6;
        deal(USDC, attacker, donation);
        vm.startPrank(attacker);
        IERC20(USDC).approve(MORPHO, donation);
        uint256 mShares = IERC4626(MORPHO).deposit(donation, attacker);
        IERC20(MORPHO).transfer(address(vault), mShares); // inflate totalAssets
        vm.stopPrank();

        // Victim deposits 1,000 USDC.
        uint256 vAmt = 1_000e6;
        deal(USDC, victim, vAmt);
        vm.startPrank(victim);
        IERC20(USDC).approve(address(vault), vAmt);
        vault.deposit(vAmt, victim);
        vm.stopPrank();

        // Victim's redeemable value must be close to what they put in — the
        // attack must not have rounded their shares to dust.
        assertGt(vault.balanceOf(victim), 0, "victim got zero shares (inflation succeeded)");
        assertGe(_pos(victim), vAmt * 99 / 100, "victim lost >1% to inflation");
    }

    /// Donation cannot brick deposits or the cap (cap is share-denominated).
    function test_donationDoesNotBrickDepositsOrCap() public {
        vm.prank(OWNER);
        vault.setDepositCap(1_000_000e12); // ~1M USDC worth of shares (12-dec shares)

        // Donate Morpho shares in.
        uint256 donation = 50_000e6;
        deal(USDC, attacker, donation);
        vm.startPrank(attacker);
        IERC20(USDC).approve(MORPHO, donation);
        uint256 mShares = IERC4626(MORPHO).deposit(donation, attacker);
        IERC20(MORPHO).transfer(address(vault), mShares);
        vm.stopPrank();

        // Deposits still work and the cap still has room (donation didn't fill it).
        assertGt(vault.maxMint(victim), 0, "cap bricked by donation");
        uint256 vAmt = 5_000e6;
        deal(USDC, victim, vAmt);
        vm.startPrank(victim);
        IERC20(USDC).approve(address(vault), vAmt);
        uint256 shares = vault.deposit(vAmt, victim);
        vm.stopPrank();
        assertGt(shares, 0, "deposit bricked by donation");
    }

    /// Nested-4626 full exit: the sole depositor redeems ALL shares. This is the
    /// rounding boundary — assert it does not revert and the receiver gets back
    /// essentially everything (within a couple of wei).
    function test_fullExit_soleDepositor() public {
        uint256 amt = 25_000e6;
        deal(USDC, victim, amt);
        vm.startPrank(victim);
        IERC20(USDC).approve(address(vault), amt);
        vault.deposit(amt, victim);

        uint256 shares = vault.balanceOf(victim);
        uint256 before = IERC20(USDC).balanceOf(victim);
        vault.redeem(shares, victim, victim); // must not revert
        vm.stopPrank();

        uint256 got = IERC20(USDC).balanceOf(victim) - before;
        assertApproxEqAbs(got, amt, 3, "sole full exit lost more than dust");
        assertEq(vault.balanceOf(victim), 0, "shares remain after full redeem");
    }

    /// Characterises the inherited-liquidity behaviour: maxWithdraw reports the
    /// holder's full balance, but an actual withdrawal of a large amount can
    /// revert when the underlying Morpho market cannot source that liquidity in
    /// the block — i.e. maxWithdraw is NOT a safe upper bound for integrators.
    function test_maxWithdrawOverstatesUnderIlliquidity() public {
        uint256 amt = 12_345e6;
        deal(USDC, victim, amt);
        vm.startPrank(victim);
        IERC20(USDC).approve(address(vault), amt);
        vault.deposit(amt, victim);

        // The vault advertises the full position as withdrawable...
        assertApproxEqRel(vault.maxWithdraw(victim), amt, 0.001e18, "maxWithdraw != position");

        // ...but pulling a large partial amount can revert from inside Morpho.
        // We do not assert success/revert (fork-state dependent); we record that
        // maxWithdraw gave no signal either way.
        try vault.withdraw(amt / 2, victim, victim) returns (uint256) {
            emit log("partial withdraw succeeded at this block");
        } catch {
            emit log("partial withdraw REVERTED despite maxWithdraw advertising it");
        }
        vm.stopPrank();
    }

    /// Fee shares only ever mint to the configured treasury, never dilute beyond
    /// the fee, and never mint on a loss.
    function test_feeAccrualBounds() public {
        uint256 amt = 100_000e6;
        deal(USDC, victim, amt);
        vm.startPrank(victim);
        IERC20(USDC).approve(address(vault), amt);
        vault.deposit(amt, victim);
        vm.stopPrank();

        assertEq(vault.balanceOf(TREASURY), 0, "treasury pre-yield shares");
        vm.warp(block.timestamp + 90 days); // real Morpho interest

        // Poke accrual with a dust deposit.
        deal(USDC, victim, 1e6);
        vm.startPrank(victim);
        IERC20(USDC).approve(address(vault), 1e6);
        vault.deposit(1e6, victim);
        vm.stopPrank();

        uint256 treasuryAssets = _pos(TREASURY);
        uint256 victimAssets = _pos(victim);
        // Treasury got a positive but small slice; user keeps the lion's share.
        assertGt(treasuryAssets, 0, "no fee accrued over 90d");
        assertLt(treasuryAssets, victimAssets / 5, "treasury took an outsized cut");
    }
}
