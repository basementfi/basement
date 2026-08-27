// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./EarnVaultShared.t.sol";
import "../src/EarnVaultV2.sol";

/// @notice Fork tests for EarnVaultV2 (Morpho Vault V2 venue — bETH). Runs the shared mechanism
///         suite plus the checks specific to a vault that deliberately does NOT bind its limits to
///         the underlying vault's max views (which V2 reports as 0 even though deposits work).
abstract contract EarnVaultV2ForkTest is EarnVaultSharedTest {
    function _newVaultWithMorpho(address morpho) internal override returns (EarnVaultBase) {
        return new EarnVaultV2(
            IERC20(ASSET()), IERC4626(morpho), NAME(), SYMBOL(), OWNER, TREASURY, 1000
        );
    }

    function test_uncappedAtLaunch() public view {
        // No cap and no Morpho binding → the ERC-4626 max is unbounded.
        assertEq(vault.maxMint(user), type(uint256).max, "uncapped maxMint");
        assertEq(vault.maxDeposit(user), type(uint256).max, "uncapped maxDeposit");
    }

    /// @dev Deposits/withdrawals must work on the bETH venue even though its Morpho Vault V2
    ///      reports maxDeposit == 0 — proving the limits are NOT bound to that view.
    function test_worksDespiteMorphoMaxViews() public {
        // Sanity: the underlying really does report 0 deposit capacity.
        assertEq(vault.morphoVault().maxDeposit(address(vault)), 0, "expected V2 maxDeposit == 0");

        _deposit(user, AMT());
        assertGt(vault.balanceOf(user), 0, "deposit blocked");

        uint256 bal = vault.balanceOf(user);
        vm.prank(user);
        vault.redeem(bal, user, user);
        assertEq(vault.balanceOf(user), 0, "could not fully exit");
    }
}

contract EarnVaultV2ETHTest is EarnVaultV2ForkTest {
    function ASSET() internal pure override returns (address) { return WETH; }
    function MORPHO() internal pure override returns (address) { return 0xFeFeC33668E22677c4762d0853d56245a800ff08; }
    function NAME() internal pure override returns (string memory) { return "Basement Earn ETH"; }
    function SYMBOL() internal pure override returns (string memory) { return "bETH"; }
    function AMT() internal pure override returns (uint256) { return 1 ether; }
    function OTHER() internal pure override returns (address) { return USDC; }
    function OTHER_AMT() internal pure override returns (uint256) { return 2_000e6; }
}
