// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./EarnVaultBase.sol";

/// @title EarnVaultV1
/// @notice Basement Earn vault for a Morpho **v1.1 (MetaMorpho)** venue (currently bUSDC, bBTC).
///         Adds the one behaviour that only makes sense on venues whose ERC-4626 max views are
///         reliable: it bounds maxDeposit/maxMint/maxWithdraw/maxRedeem by the underlying Morpho
///         vault's own limits, so the views never over-report what is actually depositable or
///         withdrawable when the market is capped or illiquid. Everything else is EarnVaultBase.
///         "V1" refers to the Morpho vault generation this wraps.
contract EarnVaultV1 is EarnVaultBase {
    constructor(
        IERC20 asset_,
        IERC4626 morphoVault_,
        string memory name_,
        string memory symbol_,
        address owner_,
        address treasury_,
        uint256 performanceFee_
    ) EarnVaultBase(asset_, morphoVault_, name_, symbol_, owner_, treasury_, performanceFee_) {}

    // ────────────────────────────────────────────────────────────
    // Limits — the smaller of the cap (base) and the Morpho vault's own limit
    // ────────────────────────────────────────────────────────────

    /// @notice Mintable shares: the smaller of the cap headroom and Morpho's deposit headroom.
    function maxMint(address receiver) public view override returns (uint256) {
        uint256 capShares = super.maxMint(receiver); // base: cap headroom (0 if paused/full)
        uint256 morphoAssets = morphoVault.maxDeposit(address(this));
        uint256 morphoShares = morphoAssets == type(uint256).max
            ? type(uint256).max
            : convertToShares(morphoAssets);
        return capShares < morphoShares ? capShares : morphoShares;
    }

    /// @notice Depositable assets: the smaller of the cap headroom and Morpho's deposit headroom.
    function maxDeposit(address receiver) public view override returns (uint256) {
        uint256 capAssets = super.maxDeposit(receiver); // base: cap headroom in assets
        uint256 morphoAssets = morphoVault.maxDeposit(address(this));
        return capAssets < morphoAssets ? capAssets : morphoAssets;
    }

    /// @notice Withdrawable assets: the smaller of the owner's balance and Morpho's liquidity, so a
    ///         withdraw ERC-4626 would allow but Morpho would revert (illiquid) is reported honestly.
    function maxWithdraw(address owner) public view override returns (uint256) {
        uint256 own = super.maxWithdraw(owner); // convertToAssets(balanceOf(owner))
        uint256 liq = morphoVault.maxWithdraw(address(this));
        return own < liq ? own : liq;
    }

    /// @notice Redeemable shares, bounded by Morpho's liquidity. When the owner's whole position
    ///         fits within available liquidity we return the full balance — converting liquidity→
    ///         shares only when liquidity is the binding limit — so "redeem all" never reverts by a
    ///         rounding wei.
    function maxRedeem(address owner) public view override returns (uint256) {
        uint256 ownShares = super.maxRedeem(owner); // balanceOf(owner)
        uint256 liqAssets = morphoVault.maxWithdraw(address(this));
        if (convertToAssets(ownShares) <= liqAssets) return ownShares;
        return convertToShares(liqAssets);
    }
}
