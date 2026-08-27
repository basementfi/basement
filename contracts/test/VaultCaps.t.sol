// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/interfaces/IERC4626.sol";
import "../src/EarnUSDC.sol";

/// @notice Fork tests for the donation-immune deposit cap on EarnUSDC (representative of all three
///         Earn* vaults): uncapped by default, cap enforcement, share-based donation immunity,
///         pause behavior (deposits blocked, redemptions open), and owner-gating of the cap.
contract VaultCapsTest is Test {
    address constant USDC         = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address constant MORPHO_USDC  = 0xeE8F4eC5672F09119b96Ab6fB59C27E1b7e44b61;
    address constant TREASURY     = 0xa60Ad2DFD253f2E1d8395D48454C1977092E303C;

    EarnUSDC usdcVault;
    address user  = address(0xBEEF);
    address user2 = address(0xCAFE);

    function setUp() public {
        vm.createSelectFork(vm.rpcUrl("base"), 47620000);
        usdcVault = new EarnUSDC(IERC20(USDC), IERC4626(MORPHO_USDC), TREASURY, 1000, true);
    }

    // ───────────────────────── EarnUSDC: deposit cap ─────────────────────────

    function test_usdc_uncappedByDefault() public view {
        assertEq(usdcVault.depositCap(), 0, "should start uncapped");
        assertEq(usdcVault.maxMint(user), type(uint256).max, "uncapped maxMint");
        assertEq(usdcVault.maxDeposit(user), type(uint256).max, "uncapped maxDeposit");
    }

    function test_usdc_capBlocksDepositOverCap() public {
        _depositUsdc(user, 1_000e6);
        usdcVault.setDepositCap(usdcVault.totalSupply()); // no room left
        assertEq(usdcVault.maxDeposit(user2), 0, "no room");

        deal(USDC, user2, 100e6);
        vm.startPrank(user2);
        IERC20(USDC).approve(address(usdcVault), 100e6);
        vm.expectRevert(); // ERC4626ExceededMaxDeposit
        usdcVault.deposit(100e6, user2);
        vm.stopPrank();
    }

    function test_usdc_capAllowsDepositUpToRoom() public {
        _depositUsdc(user, 1_000e6);
        usdcVault.setDepositCap(usdcVault.totalSupply() * 2); // ~1000 USDC of room
        _depositUsdc(user2, 500e6); // within room → ok
        assertGt(usdcVault.balanceOf(user2), 0, "deposit within cap should succeed");
    }

    /// @dev The whole point of a SHARE-based cap: inflating totalAssets via a donation must NOT
    ///      shrink the remaining cap room (the totalAssets-based griefing vector).
    function test_usdc_donationDoesNotShrinkCapRoom() public {
        _depositUsdc(user, 1_000e6);
        usdcVault.setDepositCap(usdcVault.totalSupply() * 2);

        uint256 roomBefore = usdcVault.maxMint(user2);
        assertGt(roomBefore, 0, "should have room");

        // Donation: park USDC in the Morpho vault crediting the EarnUSDC vault, inflating totalAssets.
        deal(USDC, address(this), 1_000_000e6);
        IERC20(USDC).approve(MORPHO_USDC, 1_000_000e6);
        IERC4626(MORPHO_USDC).deposit(1_000_000e6, address(usdcVault));

        assertGt(usdcVault.totalAssets(), 1_000_000e6, "totalAssets inflated by donation");
        assertEq(usdcVault.maxMint(user2), roomBefore, "cap room must be unchanged (share-based)");
    }

    function test_usdc_pauseBlocksDepositButAllowsRedeem() public {
        _depositUsdc(user, 1_000e6);
        usdcVault.pause();

        assertEq(usdcVault.maxMint(user2), 0, "paused => maxMint 0");
        deal(USDC, user2, 100e6);
        vm.startPrank(user2);
        IERC20(USDC).approve(address(usdcVault), 100e6);
        vm.expectRevert();
        usdcVault.deposit(100e6, user2);
        vm.stopPrank();

        // Exit still works while paused.
        uint256 ubal = usdcVault.balanceOf(user);
        vm.prank(user);
        usdcVault.redeem(ubal, user, user);
        assertGt(IERC20(USDC).balanceOf(user), 0, "redeem must stay open while paused");
    }

    function test_usdc_setDepositCap_onlyOwner() public {
        vm.prank(user);
        vm.expectRevert();
        usdcVault.setDepositCap(123);
    }

    // ───────────────────────────── helpers ─────────────────────────────

    function _depositUsdc(address who, uint256 amt) internal {
        deal(USDC, who, amt);
        vm.startPrank(who);
        IERC20(USDC).approve(address(usdcVault), amt);
        usdcVault.deposit(amt, who);
        vm.stopPrank();
    }
}
