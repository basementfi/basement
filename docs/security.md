# Security

Basement is non-custodial: you hold ERC-4626 shares and can redeem them at any time. The design goal is that no single party — including the team — can take user funds or trap them in a vault.

## Ownership: Safe multisig

Every vault and strategy is owned by a **Safe multisig (2-of-3)** from the moment it's deployed. The same Safe is the fee **treasury**. Privileged actions (setting a strategy, adjusting a deposit cap, pausing) require a multisig transaction — no single key can execute them.

Ownership uses **`Ownable2Step`**: transferring ownership is a two-step propose/accept, so a mistyped address can't lock the contract.

## Withdrawals always open

Vaults are `Pausable`, but pausing only blocks **new deposits**. **Redemptions are never gated** — if a vault is paused, existing depositors can still withdraw. Exits are not owner-controlled.

## Deposit caps

Each vault carries a **donation-immune, share-denominated deposit cap**. The cap is enforced on `totalSupply` (shares), not `totalAssets`, so nobody can brick deposits by donating tokens directly to the vault. Caps let the protocol stage launches and bound exposure.

## Inflation protection

New vaults are vulnerable to the classic ERC-4626 "inflation" / first-depositor attack. Basement mitigates it two ways: a **`1e6` virtual-share offset** on every vault, and a **seed deposit** made at launch so no vault is ever empty when the public deposits.

## Strategy migration is timelocked

For LP vaults, swapping the strategy behind a vault is subject to a **timelock** (propose, wait, then execute). This gives depositors time to react before the venue behind their funds changes.

## Harvest protection (LP vaults)

Permissionless harvesting is bounded by a **TWAP floor** on its swaps. An attacker who moves the pool price to sandwich a harvest causes the harvest to **revert** instead of executing at a manipulated rate.

## Audits

The contracts were reviewed with multi-agent **adversarial audits** before deployment (inflation, donation, cap-bypass, fee-math, harvest-MEV, reentrancy, and exit-rounding vectors, among others). As with any DeFi protocol, audits reduce but do not eliminate risk — deposit only what you can afford to lose.

## Underlying-venue risk

Basement's yield comes from **Morpho** and **Aerodrome**. Deposits inherit the smart-contract and market risk of those venues (e.g. a Morpho vault's bad debt, or an Aerodrome pool's impermanent loss). Basement does not add leverage.
