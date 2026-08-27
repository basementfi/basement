// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/BasementAeroZap.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice Compares the live half-split zap vs the new optimal-swap zap on the live vault.
///   source .env && forge test --match-contract AeroZapOptimal -vv
contract AeroZapOptimalTest is Test {
    BasementAeroZap oldZap = BasementAeroZap(0xfB37e8f8419A5C9C0E60caA07A18278bF34a9f0B); // deployed (half-split)
    BasementAeroZap newZap; // optimal-swap (this branch's code)
    address vault    = 0x461a3FaE15A489aBa661FA5c076b9eb1095737b9;
    address constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address constant AERO = 0x940181a94A35A4569E4529A3CDfB74e38FD98631;
    address user = address(0xBEEF);

    function setUp() public {
        vm.createSelectFork(vm.rpcUrl("base"));
        newZap = new BasementAeroZap(address(this));
    }

    function _run(BasementAeroZap zap, uint256 amount, string memory label) internal {
        deal(USDC, user, amount);
        deal(AERO, user, 0);
        vm.startPrank(user);
        IERC20(USDC).approve(address(zap), type(uint256).max);
        uint256 shares = zap.zapIn(vault, USDC, amount, 1, user);
        vm.stopPrank();

        uint256 usdcDust = IERC20(USDC).balanceOf(user);
        uint256 aeroDust = IERC20(AERO).balanceOf(user);
        uint256 consumed = amount - usdcDust;
        emit log_string(label);
        emit log_named_decimal_uint("  amount in        ", amount, 6);
        emit log_named_decimal_uint("  USDC dust refund ", usdcDust, 6);
        emit log_named_decimal_uint("  AERO dust refund ", aeroDust, 18);
        emit log_named_decimal_uint("  net deposited    ", consumed, 6);
        emit log_named_uint       ("  shares           ", shares);
    }

    function testHalfSplit_10()  public { _run(oldZap, 10e6,  "OLD half-split zap (10 USDC):"); }
    function testOptimal_10()    public { _run(newZap, 10e6,  "NEW optimal zap (10 USDC):"); }
    function testHalfSplit_1000() public { _run(oldZap, 1_000e6, "OLD half-split zap (1,000 USDC):"); }
    function testOptimal_1000()   public { _run(newZap, 1_000e6, "NEW optimal zap (1,000 USDC):"); }
}
