# Basement Contracts

Solidity (Foundry) contracts for the Basement yield vaults on Base. All vaults are ERC-4626, `Ownable`, `Pausable`, and carry a **donation-immune, share-denominated deposit cap** (the cap is enforced on `totalSupply`, not `totalAssets`, so a donation can't brick deposits).

## Contracts

| File | Role |
|---|---|
| `EarnUSDC.sol` / `EarnETH.sol` / `EarnBTC.sol` | ERC-4626 wrappers around a Morpho ERC-4626 vault. Morpho-style share-dilution performance fee (10% of yield), `_decimalsOffset()=6`, per-user `principalDeposited` tracking with an `_update` transfer hook. |
| `BasementAeroVault.sol` + `BasementAeroStrategy.sol` | Aerodrome LP vault: shares are LP-denominated; the strategy stakes LP in the gauge and auto-compounds AERO. Public harvest is bounded by a TWAP sandwich floor. Strategy migration is timelocked. `Ownable2Step`, owned by the Safe. |
| `MorphoZap.sol` | Generic deposit router for the Earn\* vaults: `zapIn(vault, tokenIn, amountIn, minShares, to)` reads `vault.asset()`, swaps `tokenIn` → asset via a WETH hub, and deposits. Token allowlist {USDC, WETH, cbBTC}. |
| `BasementAeroZap.sol` | Single-token ⇄ LP router for the Aerodrome vaults (optimal split + zap in/out). |

## Security model

- **Deposit caps** — share-based and donation-immune; enforced via `maxMint`/`maxDeposit`; set with `setDepositCap` (share units).
- **Pause** — `pause()` blocks deposits/mints; redemptions always stay open so users can exit.
- **Inflation** — `1e6` virtual-share offset on every vault.
- The vaults were reviewed with multi-agent adversarial audits prior to deployment.

## Usage

```bash
forge build
forge test                                   # fork tests against Base (needs ALCHEMY_KEY)
```

`.env` (gitignored) provides `TREASURY`, `ALCHEMY_KEY`, `BASESCAN_API_KEY`. RPC alias `base` and Etherscan verification are configured in `foundry.toml`. There is **no private key** in `.env` — production deploys and all admin actions are signed by the **Safe multisig (Trezor)**.

### Deploy

Production contracts are deployed **deterministically (CREATE2) and Safe-owned from construction**, driven from the admin console (which builds the Trezor/Safe transaction). Owner and treasury are set to the Safe in the constructor, so no post-deploy ownership transfer is needed. The `script/` Foundry scripts are for local fork testing.

Deployed addresses are listed in the [root README](../README.md).
