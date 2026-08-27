# Earn Vaults

Earn vaults are ERC-4626 wrappers around a [Morpho](https://morpho.org) lending vault. You deposit a single asset; the vault supplies it to a curated Morpho vault and auto-compounds the lending yield. Your shares (`bUSDC` / `bETH` / `bBTC`) appreciate as yield accrues — no rewards to claim, no positions to manage.

## The vaults

| Vault | Share token | Deposit asset | Morpho venue |
|---|---|---|---|
| **EarnUSDC** | `bUSDC` | USDC | Gauntlet USDC Prime |
| **EarnETH** | `bETH` | WETH / ETH | Gauntlet WETH Balanced |
| **EarnBTC** | `bBTC` | cbBTC | Gauntlet cbBTC Core |

Addresses are in [Contract Addresses](addresses.md).

## Multi-asset deposits

You don't have to hold the vault's underlying asset. Each Earn vault accepts **USDC, ETH, WETH, or cbBTC** through the shared **MorphoZap** router, which swaps your token into the vault's asset (via a WETH hub on Aerodrome) and deposits in a single transaction. Depositing the vault's native asset skips the swap.

## How yield works

* The vault holds shares of the underlying Morpho vault. As borrowers pay interest, the Morpho vault's share price rises, and so does your `b*` balance's redemption value.
* A **10% performance fee** is taken on yield only, Morpho-style, via share dilution — there is no fee on your principal. See [Fees](fees.md).
* Yield compounds continuously; there is nothing to claim.

## V1 vs V2

Two wrapper implementations exist because Morpho's two vault standards report their deposit limits differently:

* **`EarnVaultV1`** (bUSDC, bBTC) wraps **Morpho v1.1** vaults, which implement the ERC-4626 `maxDeposit`/`maxMint` views.
* **`EarnVaultV2`** (bETH) wraps a **Morpho Vault V2** vault, which reports `maxDeposit == 0` even though deposits succeed — so this wrapper deliberately does not bind to that view.

This is an implementation detail; from a depositor's perspective all three vaults behave identically.
