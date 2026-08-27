// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/AeroLpVault.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice Fork test against live Base. Run with the Alchemy key available:
///   source .env && forge test --match-contract AeroLpVaultTest -vv
contract AeroLpVaultTest is Test {
    AeroLpVault vault;
    address constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address user = address(0xBEEF);

    function setUp() public {
        vm.createSelectFork(vm.rpcUrl("base"));
        // owner = this test, treasury = this test, 10% perf fee
        vault = new AeroLpVault(address(this), address(this), 1000);
        vault.setSlippage(300); // 3% for fork-price wiggle
        deal(USDC, user, 1_000e6); // 1,000 USDC
    }

    function testDepositStakeHarvestWithdraw() public {
        // ── Deposit ──
        vm.startPrank(user);
        IERC20(USDC).approve(address(vault), type(uint256).max);
        uint256 shares = vault.deposit(1_000e6, user);
        vm.stopPrank();

        assertGt(shares, 0, "shares minted");
        assertGt(vault.totalStakedLp(), 0, "LP staked in gauge");
        emit log_named_uint("shares minted", shares);
        emit log_named_uint("LP staked", vault.totalStakedLp());
        emit log_named_uint("USDC value (display, 6dp)", vault.totalAssets());

        // ── Accrue rewards + harvest (compounds into more LP, no new shares) ──
        uint256 supplyBefore = vault.totalSupply();
        uint256 lpBefore = vault.totalStakedLp();
        skip(7 days);
        vault.harvest();
        uint256 lpAfter = vault.totalStakedLp();

        emit log_named_uint("pending->LP before harvest", lpBefore);
        emit log_named_uint("LP after harvest", lpAfter);
        assertGe(lpAfter, lpBefore, "LP did not decrease on harvest");
        assertEq(vault.totalSupply(), supplyBefore, "harvest must NOT mint shares");

        // ── Withdraw everything ──
        vm.startPrank(user);
        uint256 usdcOut = vault.redeem(vault.balanceOf(user), user, user);
        vm.stopPrank();

        emit log_named_uint("USDC withdrawn (6dp)", usdcOut);
        assertGt(usdcOut, 0, "got USDC back");
        // round-trip should be in a sane band (slippage + a little IL), not a total loss
        assertGt(usdcOut, 900e6, "round-trip lost too much");
    }
}
