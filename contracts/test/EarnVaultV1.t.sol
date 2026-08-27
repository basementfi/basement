// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./EarnVaultShared.t.sol";
import "../src/EarnVaultV1.sol";

/// @notice Fork tests for EarnVaultV1 (Morpho v1.1 / MetaMorpho venues — bUSDC, bBTC). Runs the
///         shared mechanism suite plus the Point-4 limit-binding tests that only apply where the
///         underlying vault implements the ERC-4626 max views.
abstract contract EarnVaultV1ForkTest is EarnVaultSharedTest {
    function _newVaultWithMorpho(address morpho) internal override returns (EarnVaultBase) {
        return new EarnVaultV1(
            IERC20(ASSET()), IERC4626(morpho), NAME(), SYMBOL(), OWNER, TREASURY, 1000
        );
    }

    // ── Limits bound by the underlying Morpho v1.1 vault ──

    function test_uncappedIsBoundedByMorpho() public view {
        // With no cap, deposit headroom is exactly Morpho's own headroom (a finite number here).
        assertEq(
            vault.maxDeposit(user),
            vault.morphoVault().maxDeposit(address(vault)),
            "uncapped maxDeposit != morpho headroom"
        );
        assertLt(vault.maxDeposit(user), type(uint256).max, "v1.1 headroom should be finite");
    }

    function test_capAndMorphoTakeTheSmaller() public {
        // A tiny cap must dominate Morpho's (much larger) headroom.
        vm.prank(OWNER);
        vault.setDepositCap(1); // 1 share unit
        uint256 capAssets = vault.convertToAssets(1);
        uint256 morphoMax = vault.morphoVault().maxDeposit(address(vault));
        uint256 expected = capAssets < morphoMax ? capAssets : morphoMax;
        assertEq(vault.maxDeposit(user), expected, "did not take the smaller of cap/morpho");
    }

    function test_maxWithdrawBoundedByMorpho() public {
        _deposit(user, AMT());

        IERC4626 morpho = vault.morphoVault();
        uint256 byBalance = vault.convertToAssets(vault.balanceOf(user));
        uint256 morphoLiq = morpho.maxWithdraw(address(vault));

        // Never reports more than the owner's balance nor more than Morpho can pay.
        assertLe(vault.maxWithdraw(user), byBalance, "maxWithdraw exceeds own balance");
        assertLe(vault.maxWithdraw(user), morphoLiq, "maxWithdraw exceeds morpho liquidity");
        assertApproxEqAbs(
            vault.maxWithdraw(user), byBalance < morphoLiq ? byBalance : morphoLiq, 2,
            "maxWithdraw not ~min(balance, morphoLiq)"
        );

        // Morpho is liquid here → the owner can still redeem their whole balance (no rounding lockout).
        assertEq(vault.maxRedeem(user), vault.balanceOf(user), "cannot redeem full balance while liquid");
    }
}

contract EarnVaultV1USDCTest is EarnVaultV1ForkTest {
    function ASSET() internal pure override returns (address) { return USDC; }
    function MORPHO() internal pure override returns (address) { return 0xeE8F4eC5672F09119b96Ab6fB59C27E1b7e44b61; }
    function NAME() internal pure override returns (string memory) { return "Basement Earn USDC"; }
    function SYMBOL() internal pure override returns (string memory) { return "bUSDC"; }
    function AMT() internal pure override returns (uint256) { return 2_000e6; }
    function OTHER() internal pure override returns (address) { return WETH; }
    function OTHER_AMT() internal pure override returns (uint256) { return 1 ether; }
}

contract EarnVaultV1BTCTest is EarnVaultV1ForkTest {
    function ASSET() internal pure override returns (address) { return CBBTC; }
    function MORPHO() internal pure override returns (address) { return 0x6770216aC60F634483Ec073cBABC4011c94307Cb; }
    function NAME() internal pure override returns (string memory) { return "Basement Earn BTC"; }
    function SYMBOL() internal pure override returns (string memory) { return "bBTC"; }
    function AMT() internal pure override returns (uint256) { return 0.05e8; }
    function OTHER() internal pure override returns (address) { return USDC; }
    function OTHER_AMT() internal pure override returns (uint256) { return 2_000e6; }
}
