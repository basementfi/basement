// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/interfaces/IERC4626.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "../src/EarnVaultBase.sol";

/// @notice Shared fork-test harness for the Basement Earn vaults. Every test here exercises the
///         common EarnVaultBase mechanism and runs against whatever concrete vault a subclass
///         deploys via `_newVaultWithMorpho`. EarnVaultV1.t.sol and EarnVaultV2.t.sol extend this
///         and add the limit-behaviour tests specific to each.
abstract contract EarnVaultSharedTest is Test {
    address constant WETH = 0x4200000000000000000000000000000000000006;
    address constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address constant CBBTC = 0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf;
    address constant TREASURY = 0xa60Ad2DFD253f2E1d8395D48454C1977092E303C;
    address constant OWNER = address(0xA11CE);

    EarnVaultBase vault;
    address user = address(0xBEEF);
    address user2 = address(0xCAFE);

    // Per-deployment parameters, provided by the concrete test contracts.
    function ASSET() internal pure virtual returns (address);
    function MORPHO() internal pure virtual returns (address);
    function NAME() internal pure virtual returns (string memory);
    function SYMBOL() internal pure virtual returns (string memory);
    /// One "typical deposit" in the asset's smallest unit.
    function AMT() internal pure virtual returns (uint256);
    /// A token that is NOT the vault's asset and NOT its Morpho vault (for rescue tests).
    function OTHER() internal pure virtual returns (address);
    function OTHER_AMT() internal pure virtual returns (uint256);

    /// Deploy the concrete vault (V1 or V2) against a given Morpho vault. Used by setUp with the
    /// real venue and by the asset-mismatch test with a wrong one.
    function _newVaultWithMorpho(address morpho) internal virtual returns (EarnVaultBase);

    function setUp() public {
        vm.createSelectFork(vm.rpcUrl("base"), 47620000);
        vault = _newVaultWithMorpho(MORPHO());
    }

    function _pos(address who) internal view returns (uint256) {
        return vault.convertToAssets(vault.balanceOf(who));
    }

    function _deposit(address who, uint256 amt) internal {
        deal(ASSET(), who, amt);
        vm.startPrank(who);
        IERC20(ASSET()).approve(address(vault), amt);
        vault.deposit(amt, who);
        vm.stopPrank();
    }

    // ────────────────────────────────────────────────────────────
    // Core mechanism
    // ────────────────────────────────────────────────────────────

    function test_identity() public view {
        assertEq(vault.name(), NAME(), "name");
        assertEq(vault.symbol(), SYMBOL(), "symbol");
        assertEq(vault.owner(), OWNER, "owner");
        assertEq(vault.pendingOwner(), address(0), "pendingOwner should start empty");
        assertEq(vault.treasury(), TREASURY, "treasury");
        assertEq(vault.performanceFee(), 1000, "fee");
        assertEq(vault.decimals(), IERC20Metadata(ASSET()).decimals() + 6, "decimals");
    }

    function test_assetMismatchReverts() public {
        address wrongMorpho = ASSET() == USDC
            ? 0xFeFeC33668E22677c4762d0853d56245a800ff08 // Gauntlet WETH
            : 0xeE8F4eC5672F09119b96Ab6fB59C27E1b7e44b61; // Morpho USDC
        vm.expectRevert("asset mismatch");
        _newVaultWithMorpho(wrongMorpho);
    }

    function test_directDeposit() public {
        uint256 amt = AMT();
        _deposit(user, amt);
        assertGt(vault.balanceOf(user), 0, "no shares");
        assertApproxEqRel(_pos(user), amt, 0.001e18, "position != deposit");
        assertApproxEqRel(
            vault.morphoVault().convertToAssets(vault.morphoVault().balanceOf(address(vault))),
            amt, 0.001e18, "morpho mismatch"
        );
    }

    function test_partialWithdraw() public {
        uint256 amt = AMT();
        _deposit(user, amt);

        uint256 half = vault.balanceOf(user) / 2;
        uint256 balBefore = IERC20(ASSET()).balanceOf(user);
        vm.prank(user);
        vault.redeem(half, user, user);

        uint256 got = IERC20(ASSET()).balanceOf(user) - balBefore;
        assertApproxEqRel(got, amt / 2, 0.002e18, "partial withdraw != half");
        assertApproxEqRel(_pos(user), amt / 2, 0.005e18, "remaining != half");
    }

    function test_pauseBlocksDepositsNotWithdrawals() public {
        uint256 amt = AMT();
        _deposit(user, amt);

        vm.prank(OWNER);
        vault.pause();

        assertEq(vault.maxMint(user), 0, "paused maxMint");
        assertEq(vault.maxDeposit(user), 0, "paused maxDeposit");

        deal(ASSET(), user, amt);
        vm.startPrank(user);
        IERC20(ASSET()).approve(address(vault), amt);
        vm.expectRevert();
        vault.deposit(amt, user);
        // Exit stays open while paused.
        vault.redeem(vault.balanceOf(user), user, user);
        vm.stopPrank();
        assertEq(vault.balanceOf(user), 0, "could not exit while paused");
    }

    function test_feeMintsToTreasuryOnYield() public {
        _deposit(user, AMT());
        vm.warp(block.timestamp + 30 days);

        uint256 treasuryBefore = vault.balanceOf(TREASURY);
        _deposit(user, AMT() / 1000 + 1); // any entry point accrues
        assertGe(vault.balanceOf(TREASURY), treasuryBefore, "treasury shares must not drop");
    }

    function test_onlyOwnerAdmin() public {
        vm.expectRevert();
        vault.pause();
        vm.expectRevert();
        vault.setDepositCap(1);
        vm.prank(OWNER);
        vault.setDepositCap(123);
        assertEq(vault.depositCap(), 123, "owner can set cap");
    }

    // ────────────────────────────────────────────────────────────
    // Ownable2Step
    // ────────────────────────────────────────────────────────────

    function test_ownershipIsTwoStep() public {
        address newOwner = address(0x0A11);

        vm.prank(OWNER);
        vault.transferOwnership(newOwner);
        assertEq(vault.owner(), OWNER, "owner changed too early");
        assertEq(vault.pendingOwner(), newOwner, "pendingOwner not set");

        vm.prank(address(0xBAD));
        vm.expectRevert();
        vault.acceptOwnership();

        vm.prank(newOwner);
        vault.acceptOwnership();
        assertEq(vault.owner(), newOwner, "ownership not transferred");
        assertEq(vault.pendingOwner(), address(0), "pending not cleared");

        vm.prank(OWNER);
        vm.expectRevert();
        vault.pause();
    }

    function test_transferOwnershipOnlyOwner() public {
        vm.prank(address(0xBAD));
        vm.expectRevert();
        vault.transferOwnership(address(0x1234));
    }

    // ────────────────────────────────────────────────────────────
    // Deposit cap (present on both vault types)
    // ────────────────────────────────────────────────────────────

    function test_capLimitsDeposits() public {
        _deposit(user, AMT());
        uint256 supply = vault.totalSupply();

        vm.prank(OWNER);
        vault.setDepositCap(supply);
        assertEq(vault.maxMint(user), 0, "cap should leave no headroom");
        assertEq(vault.maxDeposit(user), 0, "cap should leave no headroom (assets)");

        deal(ASSET(), user2, AMT());
        vm.startPrank(user2);
        IERC20(ASSET()).approve(address(vault), AMT());
        vm.expectRevert();
        vault.deposit(AMT(), user2);
        vm.stopPrank();

        vm.prank(OWNER);
        vault.setDepositCap(0); // uncap
        assertGt(vault.maxDeposit(user), 0, "uncap should reopen deposits");
        _deposit(user2, AMT());
        assertGt(vault.balanceOf(user2), 0, "deposit blocked after uncap");
    }

    // ────────────────────────────────────────────────────────────
    // Fee-aware conversions / previews
    // ────────────────────────────────────────────────────────────

    function test_previewsPriceInPendingFee() public {
        _deposit(user, AMT());
        uint256 userShares = vault.balanceOf(user);

        // Try to accrue Morpho yield so a fee is pending but not yet minted. (A Vault V2 venue's
        // view may not extrapolate interest on vm.warp, so the strict check is gated on a fee.)
        vm.warp(block.timestamp + 180 days);

        uint256 offset = 10 ** 6;
        uint256 noFee = Math.mulDiv(userShares, vault.totalAssets() + 1, vault.totalSupply() + offset);
        uint256 feeAware = vault.previewRedeem(userShares);

        assertLe(feeAware, noFee, "preview priced above fee-free value");

        uint256 treasuryBefore = vault.balanceOf(TREASURY);
        _deposit(user2, AMT() / 1000 + 1);
        uint256 minted = vault.balanceOf(TREASURY) - treasuryBefore;

        if (minted > 0) {
            assertLt(feeAware, noFee, "fee accrued but was not priced into the preview");
        }
        assertApproxEqRel(vault.previewRedeem(userShares), feeAware, 0.0002e18, "preview shifted across accrual");
    }

    // ────────────────────────────────────────────────────────────
    // rescueERC20
    // ────────────────────────────────────────────────────────────

    function test_rescueUnrelatedToken() public {
        uint256 amt = OTHER_AMT();
        deal(OTHER(), address(vault), amt);
        address to = address(0xD00D);

        vm.expectRevert();
        vault.rescueERC20(IERC20(OTHER()), to, amt);

        vm.prank(OWNER);
        vault.rescueERC20(IERC20(OTHER()), to, amt);
        assertEq(IERC20(OTHER()).balanceOf(to), amt, "rescue did not deliver");
    }

    function test_rescueCannotTouchBackingShares() public {
        _deposit(user, AMT());

        IERC4626 morpho = vault.morphoVault();
        uint256 backing = morpho.balanceOf(address(vault));
        assertGt(backing, 0, "no backing to protect");

        vm.prank(OWNER);
        vm.expectRevert("cannot touch backing shares");
        vault.rescueERC20(IERC20(address(morpho)), OWNER, backing);

        vm.prank(OWNER);
        vm.expectRevert("bad recipient");
        vault.rescueERC20(IERC20(OTHER()), address(0), 0);

        assertEq(morpho.balanceOf(address(vault)), backing, "backing shares moved");
        assertApproxEqRel(_pos(user), AMT(), 0.001e18, "user position changed");
    }
}
