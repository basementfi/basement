# LP Vaults

LP vaults turn a single-token deposit into a staked [Aerodrome](https://aerodrome.finance) liquidity position that auto-compounds its AERO rewards. The vault's asset is the Aerodrome **LP token**, so your shares are LP-denominated; the strategy stakes that LP in Aerodrome's gauge and periodically harvests AERO emissions back into the position.

## The vaults

| Vault | Share token | Deposit | Pool |
|---|---|---|---|
| **LP USDC/AERO** | `bUSDC/AERO` | USDC | USDC/AERO on Aerodrome |
| **LP WETH/cbBTC** | `bWETH/cbBTC` | WETH or ETH (or USDC) | WETH/cbBTC on Aerodrome |

Addresses are in [Contract Addresses](addresses.md).

## How it works

1. **Zap in.** You deposit one token. The **BasementAeroZap** router splits it 50/50 into the two pool tokens, adds liquidity on Aerodrome, and deposits the resulting LP into the vault — one flow, one position.
2. **Stake.** The vault sends the LP to its strategy, which stakes it in the Aerodrome gauge.
3. **Auto-compound.** The strategy harvests AERO emissions, swaps and re-adds them to the LP, and re-stakes — increasing every share's value. No new shares are minted, so harvesting simply raises the price per share.

## Harvesting

Harvesting is **permissionless** — anyone can call it, and the caller earns a **1% fee in AERO** as a gas incentive. Harvest swaps are protected by a **TWAP floor**, so a sandwich attempt that pushes the pool price makes the harvest revert rather than execute at a manipulated rate. The protocol takes a **10% performance fee** on harvested rewards (see [Fees](fees.md)).

## Withdrawing

When you withdraw an LP vault you can choose what to receive:

* **A single token** (USDC or WETH) — the zap unwinds your LP and swaps it back to one token.
* **The raw LP token** — a direct `redeem` returns the underlying Aerodrome LP to your wallet with no swap, if you'd rather manage the position yourself.

See [Depositing & Withdrawing](depositing-and-withdrawing.md) for the step-by-step.

## Risks specific to LP vaults

Providing liquidity carries **impermanent loss**: if the two pool tokens diverge in price, the LP can be worth less than simply holding them. AERO rewards are designed to offset this, but returns are variable and not guaranteed. LP vaults suit users comfortable with liquidity-provision risk.
