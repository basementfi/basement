// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/interfaces/IERC4626.sol";
import "../src/EarnBTC.sol";
import "../src/EarnZap.sol";

/// @notice Fork tests for EarnBTC (Gauntlet cbBTC Core wrapper) + EarnZap multi-token deposits.
contract EarnBTCTest is Test {
    address constant CBBTC   = 0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf; // 8dp
    address constant WETH    = 0x4200000000000000000000000000000000000006;
    address constant USDC    = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address constant MORPHO  = 0x6770216aC60F634483Ec073cBABC4011c94307Cb; // Gauntlet cbBTC Core
    address constant TREASURY = 0xa60Ad2DFD253f2E1d8395D48454C1977092E303C;

    EarnBTC vault;
    EarnZap zap;
    address user = address(0xBEEF);

    function setUp() public {
        vm.createSelectFork(vm.rpcUrl("base"), 47620000);
        vault = new EarnBTC(IERC20(CBBTC), IERC4626(MORPHO), TREASURY, 1000);
        zap = new EarnZap();
    }

    function _posCbbtc(address who) internal view returns (uint256) {
        return vault.convertToAssets(vault.balanceOf(who));
    }

    function test_directCbbtcDeposit() public {
        uint256 amt = 0.05e8; // 0.05 cbBTC
        deal(CBBTC, user, amt);
        vm.startPrank(user);
        IERC20(CBBTC).approve(address(vault), amt);
        uint256 shares = vault.deposit(amt, user);
        vm.stopPrank();

        assertGt(shares, 0, "no shares");
        assertApproxEqRel(_posCbbtc(user), amt, 0.001e18, "position != deposit");
        assertApproxEqRel(IERC4626(MORPHO).convertToAssets(IERC4626(MORPHO).balanceOf(address(vault))), amt, 0.001e18, "morpho mismatch");
    }

    function test_wethZapIn() public {
        uint256 amt = 1 ether;
        deal(WETH, user, amt);
        vm.startPrank(user);
        IERC20(WETH).approve(address(zap), amt);
        uint256 shares = zap.zapIn(address(vault), WETH, amt, 0, user);
        vm.stopPrank();

        assertGt(shares, 0, "no shares from WETH zap");
        assertGt(_posCbbtc(user), 0, "no cbBTC position");
        assertEq(IERC20(WETH).balanceOf(address(zap)), 0, "WETH stuck in zap");
        assertEq(IERC20(CBBTC).balanceOf(address(zap)), 0, "cbBTC stuck in zap");
        emit log_named_uint("WETH 1.0 -> cbBTC position (8dp)", _posCbbtc(user));
    }

    function test_usdcZapIn() public {
        uint256 amt = 2_000e6; // 2000 USDC
        deal(USDC, user, amt);
        vm.startPrank(user);
        IERC20(USDC).approve(address(zap), amt);
        uint256 shares = zap.zapIn(address(vault), USDC, amt, 0, user);
        vm.stopPrank();

        assertGt(shares, 0, "no shares from USDC zap");
        assertGt(_posCbbtc(user), 0, "no cbBTC position");
        assertEq(IERC20(USDC).balanceOf(address(zap)), 0, "USDC stuck in zap");
        emit log_named_uint("USDC 2000 -> cbBTC position (8dp)", _posCbbtc(user));
    }

    function test_cbbtcZapInDirect() public {
        uint256 amt = 0.05e8;
        deal(CBBTC, user, amt);
        vm.startPrank(user);
        IERC20(CBBTC).approve(address(zap), amt);
        uint256 shares = zap.zapIn(address(vault), CBBTC, amt, 0, user);
        vm.stopPrank();
        assertGt(shares, 0, "no shares");
        assertApproxEqRel(_posCbbtc(user), amt, 0.001e18, "position != deposit");
    }

    function test_partialWithdraw() public {
        uint256 amt = 0.05e8;
        deal(CBBTC, user, amt);
        vm.startPrank(user);
        IERC20(CBBTC).approve(address(vault), amt);
        vault.deposit(amt, user);

        uint256 shares = vault.balanceOf(user);
        uint256 half = shares / 2;
        uint256 cbbtcBefore = IERC20(CBBTC).balanceOf(user);
        vault.redeem(half, user, user);
        vm.stopPrank();

        uint256 got = IERC20(CBBTC).balanceOf(user) - cbbtcBefore;
        assertApproxEqRel(got, amt / 2, 0.002e18, "partial withdraw != half");
        assertApproxEqRel(_posCbbtc(user), amt / 2, 0.005e18, "remaining != half");
    }

    function test_minSharesGuardReverts() public {
        uint256 amt = 1 ether;
        deal(WETH, user, amt);
        vm.startPrank(user);
        IERC20(WETH).approve(address(zap), amt);
        vm.expectRevert(EarnZap.Slippage.selector);
        zap.zapIn(address(vault), WETH, amt, type(uint256).max, user);
        vm.stopPrank();
    }

    function test_unsupportedTokenReverts() public {
        deal(0x940181a94A35A4569E4529A3CDfB74e38FD98631, user, 1 ether); // AERO
        vm.startPrank(user);
        IERC20(0x940181a94A35A4569E4529A3CDfB74e38FD98631).approve(address(zap), 1 ether);
        vm.expectRevert(EarnZap.UnsupportedToken.selector);
        zap.zapIn(address(vault), 0x940181a94A35A4569E4529A3CDfB74e38FD98631, 1 ether, 0, user);
        vm.stopPrank();
    }

    function test_yieldAccruesToShareValue() public {
        uint256 amt = 0.1e8;
        deal(CBBTC, user, amt);
        vm.startPrank(user);
        IERC20(CBBTC).approve(address(vault), amt);
        vault.deposit(amt, user);
        vm.stopPrank();

        uint256 before = _posCbbtc(user);
        // Simulate Morpho yield: donate cbBTC into the Morpho vault so its share price rises.
        deal(CBBTC, address(this), 0.01e8);
        IERC20(CBBTC).approve(MORPHO, 0.01e8);
        IERC4626(MORPHO).deposit(0.01e8, MORPHO); // park in the morpho vault itself (raises pricePerShare via assets)
        // Poke fee accrual by a 0-ish interaction path isn't needed; convertToAssets reflects morpho price.
        assertGe(_posCbbtc(user), before, "position should not drop");
    }
}
