# FAQ

### What is Basement?

A set of liquid yield vaults on Base. You deposit a single asset and earn auto-compounding yield through Morpho (lending) and Aerodrome (liquidity), wrapped in ERC-4626 vaults. See the [Overview](README.md).

### Which chain is it on?

**Base** mainnet. You'll need a wallet connected to Base and a little ETH for gas.

### Do you take custody of my funds?

No. Deposits mint you ERC-4626 **share tokens** that you hold in your own wallet. You can redeem them for the underlying value at any time, and withdrawals are never gated by the team.

### What are the fees?

A **10% performance fee on yield only** — no deposit, withdrawal, or management fees. LP-vault harvests also pay a 1% caller fee to whoever triggers the harvest. Full details in [Fees](fees.md).

### How is yield generated?

* **Earn vaults** supply your asset to a curated Morpho lending vault and compound the interest.
* **LP vaults** provide liquidity on Aerodrome, stake the LP in the gauge, and auto-compound AERO emissions.

### Can I lose money?

Yes — this is DeFi. Earn vaults carry the smart-contract and market risk of the underlying Morpho vaults. LP vaults additionally carry **impermanent loss**. Returns are variable and not guaranteed. Only deposit what you can afford to lose.

### Is it audited?

The contracts were reviewed with multi-agent adversarial audits before deployment. Audits reduce risk but don't eliminate it. See [Security](security.md).

### Who controls the vaults?

A **Safe multisig (2-of-3)** owns every vault and strategy, using two-step ownership transfer. Privileged actions require multiple signers. No single key can move or trap user funds.

### What tokens can I deposit?

* **Earn vaults:** USDC, ETH, WETH, or cbBTC (non-native tokens are swapped into the vault asset automatically).
* **LP vaults:** the pool's tokens, plus native ETH where supported, and USDC into the WETH/cbBTC vault.

### How do I withdraw?

Open the vault, go to the Withdraw tab, and confirm. For LP vaults you can choose to receive a single token (USDC/WETH) or the raw Aerodrome LP token. Step-by-step in [Depositing & Withdrawing](depositing-and-withdrawing.md).

### What are `bUSDC`, `bETH`, `bBTC`?

They're the **share (receipt) tokens** you receive when you deposit into the corresponding Earn vault. Their redemption value rises as the vault earns yield. LP vaults issue `bUSDC/AERO` and `bWETH/cbBTC` shares.

### Where are the contract addresses?

See [Contract Addresses](addresses.md). Always cross-check against [basement.finance](https://basement.finance) before interacting with any contract.
