// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./EarnVaultBase.sol";

/// @title EarnVaultV2
/// @notice Basement Earn vault for a Morpho **Vault V2** venue (currently bETH). Identical to the
///         shared EarnVaultBase mechanism with NO extra limit binding: Morpho Vault V2 does not
///         implement the ERC-4626 max views (maxDeposit returns 0 while deposits work), so binding
///         to them would falsely report zero capacity and block deposits/withdrawals. Limits are
///         therefore the plain cap only; gate/illiquidity risk is handled operationally (pause).
///         "V2" refers to the Morpho vault generation this wraps, not a newer Basement design.
contract EarnVaultV2 is EarnVaultBase {
    constructor(
        IERC20 asset_,
        IERC4626 morphoVault_,
        string memory name_,
        string memory symbol_,
        address owner_,
        address treasury_,
        uint256 performanceFee_
    ) EarnVaultBase(asset_, morphoVault_, name_, symbol_, owner_, treasury_, performanceFee_) {}
}
