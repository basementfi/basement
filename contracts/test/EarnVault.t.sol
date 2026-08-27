// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/interfaces/IERC4626.sol";
import "../src/EarnVault.sol";
import "../src/MorphoZap.sol";

/// @notice Fork tests for the generic EarnVault, run once per deployment config
///         (bUSDC 6dp / bETH 18dp / bBTC 8dp) via the three concrete contracts
///         at the bottom. One mechanism, three parameter sets — the tests only
///         differ by the same constructor arguments the deploy script uses.
abstract contract EarnVaultForkTest is Test {
    address constant WETH = 0x4200000000000000000000000000000000000006;
    address constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address constant CBBTC = 0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf;
    address constant TREASURY = 0xa60Ad2DFD253f2E1d8395D48454C1977092E303C;
    address constant OWNER = address(0xA11CE);

    EarnVault vault;
    MorphoZap zap;
    address user = address(0xBEEF);

    // Per-deployment parameters, provided by the concrete test contracts.
    function ASSET() internal pure virtual returns (address);
    function MORPHO() internal pure virtual returns (address);
    function NAME() internal pure virtual returns (string memory);
    function SYMBOL() internal pure virtual returns (string memory);
    /// One "typical deposit" in the asset's smallest unit.
    function AMT() internal pure virtual returns (uint256);
    /// A zap-in token that is NOT the vault's asset.
    function OTHER() internal pure virtual returns (address);
    function OTHER_AMT() internal pure virtual returns (uint256);

    function setUp() public {
        vm.createSelectFork(vm.rpcUrl("base"), 47620000);
        vault = new EarnVault(
            IERC20(ASSET()), IERC4626(MORPHO()), NAME(), SYMBOL(), OWNER, TREASURY, 1000
        );
        zap = new MorphoZap();
    }

    function _pos(address who) internal view returns (uint256) {
        return vault.convertToAssets(vault.balanceOf(who));
    }

    function test_identity() public view {
        assertEq(vault.name(), NAME(), "name");
        assertEq(vault.symbol(), SYMBOL(), "symbol");
        assertEq(vault.owner(), OWNER, "owner");
        assertEq(vault.treasury(), TREASURY, "treasury");
        assertEq(vault.performanceFee(), 1000, "fee");
        // Share decimals = asset decimals + the 1e6 virtual-share offset.
        assertEq(vault.decimals(), IERC20Metadata(ASSET()).decimals() + 6, "decimals");
        // Uncapped launch: nothing limits deposits.
        assertEq(vault.maxMint(user), type(uint256).max, "uncapped maxMint");
        assertEq(vault.maxDeposit(user), type(uint256).max, "uncapped maxDeposit");
    }

    function test_assetMismatchReverts() public {
        // Wiring the vault to a Morpho market of a DIFFERENT asset must fail at deploy.
        address wrongMorpho = ASSET() == USDC
            ? 0xFeFeC33668E22677c4762d0853d56245a800ff08 // Gauntlet WETH
            : 0xeE8F4eC5672F09119b96Ab6fB59C27E1b7e44b61; // Morpho USDC
        vm.expectRevert("asset mismatch");
        new EarnVault(
            IERC20(ASSET()), IERC4626(wrongMorpho), NAME(), SYMBOL(), OWNER, TREASURY, 1000
        );
    }

    function test_directDeposit() public {
        uint256 amt = AMT();
        deal(ASSET(), user, amt);
        vm.startPrank(user);
        IERC20(ASSET()).approve(address(vault), amt);
        uint256 shares = vault.deposit(amt, user);
        vm.stopPrank();

        assertGt(shares, 0, "no shares");
        assertApproxEqRel(_pos(user), amt, 0.001e18, "position != deposit");
        assertApproxEqRel(
            IERC4626(MORPHO()).convertToAssets(IERC4626(MORPHO()).balanceOf(address(vault))),
            amt, 0.001e18, "morpho mismatch"
        );
    }

    function test_partialWithdraw() public {
        uint256 amt = AMT();
        deal(ASSET(), user, amt);
        vm.startPrank(user);
        IERC20(ASSET()).approve(address(vault), amt);
        vault.deposit(amt, user);

        uint256 half = vault.balanceOf(user) / 2;
        uint256 balBefore = IERC20(ASSET()).balanceOf(user);
        vault.redeem(half, user, user);
        vm.stopPrank();

        uint256 got = IERC20(ASSET()).balanceOf(user) - balBefore;
        assertApproxEqRel(got, amt / 2, 0.002e18, "partial withdraw != half");
        assertApproxEqRel(_pos(user), amt / 2, 0.005e18, "remaining != half");
    }

    function test_zapInFromOtherToken() public {
        uint256 amt = OTHER_AMT();
        deal(OTHER(), user, amt);
        vm.startPrank(user);
        IERC20(OTHER()).approve(address(zap), amt);
        uint256 shares = zap.zapIn(address(vault), OTHER(), amt, 0, user);
        vm.stopPrank();

        assertGt(shares, 0, "no shares from zap");
        assertGt(_pos(user), 0, "no position");
        assertEq(IERC20(OTHER()).balanceOf(address(zap)), 0, "tokenIn stuck in zap");
        assertEq(IERC20(ASSET()).balanceOf(address(zap)), 0, "asset stuck in zap");
    }

    function test_zapMinSharesGuardReverts() public {
        uint256 amt = OTHER_AMT();
        deal(OTHER(), user, amt);
        vm.startPrank(user);
        IERC20(OTHER()).approve(address(zap), amt);
        vm.expectRevert(MorphoZap.Slippage.selector);
        zap.zapIn(address(vault), OTHER(), amt, type(uint256).max, user);
        vm.stopPrank();
    }

    function test_pauseBlocksDepositsNotWithdrawals() public {
        uint256 amt = AMT();
        deal(ASSET(), user, amt);
        vm.startPrank(user);
        IERC20(ASSET()).approve(address(vault), amt);
        vault.deposit(amt, user);
        vm.stopPrank();

        vm.prank(OWNER);
        vault.pause();

        assertEq(vault.maxMint(user), 0, "paused maxMint");
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
        uint256 amt = AMT();
        deal(ASSET(), user, amt);
        vm.startPrank(user);
        IERC20(ASSET()).approve(address(vault), amt);
        vault.deposit(amt, user);
        vm.stopPrank();

        // Let the Morpho market accrue real interest.
        vm.warp(block.timestamp + 30 days);

        uint256 treasuryBefore = vault.balanceOf(TREASURY);
        // Any entry point accrues; a dust deposit works.
        uint256 dust = AMT() / 1000 + 1;
        deal(ASSET(), user, dust);
        vm.startPrank(user);
        IERC20(ASSET()).approve(address(vault), dust);
        vault.deposit(dust, user);
        vm.stopPrank();

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
}

contract EarnVaultUSDCTest is EarnVaultForkTest {
    function ASSET() internal pure override returns (address) { return USDC; }
    function MORPHO() internal pure override returns (address) { return 0xeE8F4eC5672F09119b96Ab6fB59C27E1b7e44b61; }
    function NAME() internal pure override returns (string memory) { return "Basement Earn USDC"; }
    function SYMBOL() internal pure override returns (string memory) { return "bUSDC"; }
    function AMT() internal pure override returns (uint256) { return 2_000e6; }
    function OTHER() internal pure override returns (address) { return WETH; }
    function OTHER_AMT() internal pure override returns (uint256) { return 1 ether; }
}

contract EarnVaultETHTest is EarnVaultForkTest {
    function ASSET() internal pure override returns (address) { return WETH; }
    function MORPHO() internal pure override returns (address) { return 0xFeFeC33668E22677c4762d0853d56245a800ff08; }
    function NAME() internal pure override returns (string memory) { return "Basement Earn ETH"; }
    function SYMBOL() internal pure override returns (string memory) { return "bETH"; }
    function AMT() internal pure override returns (uint256) { return 1 ether; }
    function OTHER() internal pure override returns (address) { return USDC; }
    function OTHER_AMT() internal pure override returns (uint256) { return 2_000e6; }
}

contract EarnVaultBTCTest is EarnVaultForkTest {
    function ASSET() internal pure override returns (address) { return CBBTC; }
    function MORPHO() internal pure override returns (address) { return 0x6770216aC60F634483Ec073cBABC4011c94307Cb; }
    function NAME() internal pure override returns (string memory) { return "Basement Earn BTC"; }
    function SYMBOL() internal pure override returns (string memory) { return "bBTC"; }
    function AMT() internal pure override returns (uint256) { return 0.05e8; }
    function OTHER() internal pure override returns (address) { return USDC; }
    function OTHER_AMT() internal pure override returns (uint256) { return 2_000e6; }
}
