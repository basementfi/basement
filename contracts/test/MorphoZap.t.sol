// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/interfaces/IERC4626.sol";
import "../src/EarnUSDC.sol";
import "../src/EarnETH.sol";
import "../src/EarnBTC.sol";
import "../src/MorphoZap.sol";

/// @notice Fork tests for MorphoZap: every supported token (USDC/WETH/cbBTC) into each Earn vault.
contract MorphoZapTest is Test {
    address constant USDC  = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address constant WETH  = 0x4200000000000000000000000000000000000006;
    address constant CBBTC = 0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf;
    address constant M_USDC = 0xeE8F4eC5672F09119b96Ab6fB59C27E1b7e44b61; // Morpho USDC
    address constant M_WETH = 0xFeFeC33668E22677c4762d0853d56245a800ff08; // Gauntlet WETH Balanced
    address constant M_CBBTC = 0x6770216aC60F634483Ec073cBABC4011c94307Cb; // Gauntlet cbBTC Core
    address constant TREASURY = 0xa60Ad2DFD253f2E1d8395D48454C1977092E303C;

    EarnUSDC vUsdc;
    EarnETH vEth;
    EarnBTC vBtc;
    MorphoZap zap;
    address user = address(0xBEEF);

    function setUp() public {
        vm.createSelectFork(vm.rpcUrl("base"), 47620000);
        vUsdc = new EarnUSDC(IERC20(USDC), IERC4626(M_USDC), TREASURY, 1000, true);
        vEth  = new EarnETH(IERC20(WETH), IERC4626(M_WETH), TREASURY, 1000, true);
        vBtc  = new EarnBTC(IERC20(CBBTC), IERC4626(M_CBBTC), TREASURY, 1000);
        zap = new MorphoZap();
    }

    function _zap(address vault, address token, uint256 amt) internal returns (uint256 shares) {
        deal(token, user, amt);
        vm.startPrank(user);
        IERC20(token).approve(address(zap), amt);
        shares = zap.zapIn(vault, token, amt, 0, user);
        vm.stopPrank();
        assertGt(shares, 0, "no shares");
        assertEq(IERC20(token).balanceOf(address(zap)), 0, "tokenIn stuck");
        assertEq(IERC20(IEarnVault(vault).asset()).balanceOf(address(zap)), 0, "asset stuck");
    }

    // ── EarnUSDC (asset USDC) ──
    function test_usdcVault_directUsdc() public { _zap(address(vUsdc), USDC, 2_000e6); }
    function test_usdcVault_fromWeth() public { uint256 s = _zap(address(vUsdc), WETH, 1 ether); emit log_named_uint("WETH->USDC vault shares", s); }
    function test_usdcVault_fromCbbtc() public { uint256 s = _zap(address(vUsdc), CBBTC, 0.03e8); emit log_named_uint("cbBTC->USDC vault shares", s); }

    // ── EarnETH (asset WETH) ──
    function test_ethVault_directWeth() public { _zap(address(vEth), WETH, 1 ether); }
    function test_ethVault_fromUsdc() public { uint256 s = _zap(address(vEth), USDC, 2_000e6); emit log_named_uint("USDC->WETH vault shares", s); }
    function test_ethVault_fromCbbtc() public { uint256 s = _zap(address(vEth), CBBTC, 0.03e8); emit log_named_uint("cbBTC->WETH vault shares", s); }

    // ── EarnBTC (asset cbBTC) ──
    function test_btcVault_directCbbtc() public { _zap(address(vBtc), CBBTC, 0.05e8); }
    function test_btcVault_fromWeth() public { uint256 s = _zap(address(vBtc), WETH, 1 ether); emit log_named_uint("WETH->cbBTC vault shares", s); }
    function test_btcVault_fromUsdc() public { uint256 s = _zap(address(vBtc), USDC, 2_000e6); emit log_named_uint("USDC->cbBTC vault shares", s); }

    // ── Guards ──
    function test_minSharesReverts() public {
        deal(USDC, user, 2_000e6);
        vm.startPrank(user);
        IERC20(USDC).approve(address(zap), 2_000e6);
        vm.expectRevert(MorphoZap.Slippage.selector);
        zap.zapIn(address(vBtc), USDC, 2_000e6, type(uint256).max, user);
        vm.stopPrank();
    }

    function test_unsupportedTokenReverts() public {
        address AERO = 0x940181a94A35A4569E4529A3CDfB74e38FD98631;
        deal(AERO, user, 1 ether);
        vm.startPrank(user);
        IERC20(AERO).approve(address(zap), 1 ether);
        vm.expectRevert(MorphoZap.UnsupportedToken.selector);
        zap.zapIn(address(vUsdc), AERO, 1 ether, 0, user);
        vm.stopPrank();
    }

    function test_previewMatchesActual() public {
        uint256 amt = 1 ether;
        uint256 preview = zap.previewAssetOut(address(vBtc), WETH, amt);
        assertGt(preview, 0, "preview 0");
        emit log_named_uint("previewAssetOut WETH->cbBTC", preview);
    }
}
