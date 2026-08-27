# Overview

**Basement** is a set of liquid yield vaults on **Base**. You deposit a single asset and earn auto-compounding yield through established venues — [Morpho](https://morpho.org) for lending and [Aerodrome](https://aerodrome.finance) for liquidity — wrapped in audited [ERC-4626](https://eips.ethereum.org/EIPS/eip-4626) vaults.

Live app: [**basement.finance**](https://basement.finance)

## What you get

* **One-asset deposits.** Put in USDC, ETH, or a supported token — Basement routes it into the strategy for you.
* **Auto-compounding.** Yield (and, for LP vaults, AERO rewards) is harvested and reinvested, so your position grows without any action from you.
* **A standard receipt token.** Every vault is ERC-4626; your deposit mints share tokens (e.g. `bUSDC`) that represent your slice of the vault and can be redeemed at any time.
* **Non-custodial.** You always hold your shares. Withdrawals are never gated by the team — even when a vault is paused, redemptions stay open.

## The vaults

| Family | Vaults | Strategy |
|---|---|---|
| **[Earn](earn-vaults.md)** | `bUSDC`, `bETH`, `bBTC` | Supply to a Morpho lending vault, auto-compounding |
| **[LP](lp-vaults.md)** | `bUSDC/AERO`, `bWETH/cbBTC` | Provide Aerodrome liquidity, stake in the gauge, auto-compound AERO |

## How it's governed

All vaults are owned by a **Safe multisig (2-of-3)** and use two-step ownership transfer. Deposit caps are donation-immune and share-denominated. See [Security](security.md) for the full model, and [Contract Addresses](addresses.md) for the live deployment.
