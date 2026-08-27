// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/BasementAeroZap.sol";
import "../src/BasementAeroVault.sol";
import "../src/interfaces/IAerodrome.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice Forks live Base and runs the deployed Zap with exactly 10 USDC to break down where
///   the money goes (pulled / into-LP / refunded). Run: source .env && forge test --match-contract DepositCheck -vv
contract DepositCheck is Test {
    BasementAeroZap zap      = BasementAeroZap(0xfB37e8f8419A5C9C0E60caA07A18278bF34a9f0B);
    address vault    = 0x461a3FaE15A489aBa661FA5c076b9eb1095737b9;
    address constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address constant AERO = 0x940181a94A35A4569E4529A3CDfB74e38FD98631;
    address user = address(0xBEEF);

    function testTenUsdcDeposit() public {
        vm.createSelectFork(vm.rpcUrl("base"));
        deal(USDC, user, 10e6);

        uint256 usdcBefore = IERC20(USDC).balanceOf(user);
        uint256 aeroBefore = IERC20(AERO).balanceOf(user);

        vm.startPrank(user);
        IERC20(USDC).approve(address(zap), type(uint256).max);
        uint256 shares = zap.zapIn(vault, USDC, 10e6, 0, user);
        vm.stopPrank();

        uint256 usdcSpent    = usdcBefore - IERC20(USDC).balanceOf(user); // net USDC actually consumed
        uint256 usdcRefund   = IERC20(USDC).balanceOf(user);             // dust returned (started at 0 after the 10e6 pull)
        uint256 aeroRefund   = IERC20(AERO).balanceOf(user) - aeroBefore;
        uint256 positionUsdc = zap.valueOfSharesInToken(vault, shares, USDC); // USD value now sitting in the LP

        emit log_named_decimal_uint("USDC sent in            ", 10e6, 6);
        emit log_named_decimal_uint("USDC refunded (dust)    ", usdcRefund, 6);
        emit log_named_decimal_uint("AERO refunded (dust)    ", aeroRefund, 18);
        emit log_named_decimal_uint("Net USDC consumed       ", usdcSpent, 6);
        emit log_named_decimal_uint("Position value (USDC)   ", positionUsdc, 6);
        emit log_named_uint       ("Shares minted           ", shares);
    }
}
