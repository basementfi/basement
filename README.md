# Basement

Liquid yield vaults on **Base**. Deposit a single asset and earn auto-compounding yield through battle-tested venues (Morpho, Aerodrome) wrapped in audited ERC-4626 vaults.

Live app: **https://basement.finance**

## Vaults (Base mainnet)

| Vault | Share token | Strategy | Address |
|---|---|---|---|
| EarnUSDC | bUSDC | Morpho USDC | [`0xd795C20D954204853BB08d574DaE4ae362F2500a`](https://basescan.org/address/0xd795C20D954204853BB08d574DaE4ae362F2500a) |
| EarnETH | bETH | Morpho WETH (Gauntlet) | [`0xD53e343bae99F8707042a049Acd539C7BE231AFB`](https://basescan.org/address/0xD53e343bae99F8707042a049Acd539C7BE231AFB) |
| EarnBTC | bBTC | Morpho cbBTC (Gauntlet Core) | [`0x2656Fc87033F23216E848E0D3738A62cb116e070`](https://basescan.org/address/0x2656Fc87033F23216E848E0D3738A62cb116e070) |
| LP USDC/AERO | bUSDC/AERO | Aerodrome LP + gauge auto-compound | [`0x658c3C796066Af21f19e496C3C7733257D8da985`](https://basescan.org/address/0x658c3C796066Af21f19e496C3C7733257D8da985) |
| LP WETH/cbBTC | bWETH/cbBTC | Aerodrome LP + gauge auto-compound | [`0x5a38D1546122eDfe766799058e93dFb11C8FEFEd`](https://basescan.org/address/0x5a38D1546122eDfe766799058e93dFb11C8FEFEd) |

Deposit routers: **MorphoZap** `0x7f8FB8b7Cb225AC642a22234931c43B5E2E9dB3D` (multi-token → Earn\* vaults), **BasementAeroZap** `0x8E2c0106051C73bB28Fcd16F0731140e8926dAED` (single-token ⇄ LP). The LP vaults are **Ownable2Step, owned by the Safe multisig**.

## How it works

- **Earn\*** vaults are ERC-4626 wrappers around a Morpho ERC-4626 vault, with a Morpho-style share-dilution performance fee (10% of yield) and a `1e6` virtual-share inflation offset. Deposit USDC/ETH/WETH/cbBTC via MorphoZap (swapped to the vault asset through a WETH hub).
- **LP** vaults hold an Aerodrome LP token, stake it in the gauge, and auto-compound AERO emissions; shares are LP-denominated. Deposit/withdraw a single token (USDC or WETH) through BasementAeroZap, or withdraw the raw LP token directly via `redeem`.

All vaults are `Ownable` + `Pausable`, carry a **donation-immune, share-denominated deposit cap**, and track per-user principal for yield display.

## Tech stack

Next.js 16 (App Router, Turbopack) · wagmi / viem · RainbowKit · Recharts · Tailwind. Smart contracts in Solidity (Foundry) — see [`contracts/`](contracts/).

## Development

```bash
npm install
npm run dev          # http://localhost:3000
npm run build        # production build
```

Contracts:

```bash
cd contracts
forge build
forge test           # fork tests (needs ALCHEMY_KEY in contracts/.env)
```
