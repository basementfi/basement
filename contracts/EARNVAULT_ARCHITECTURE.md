# EarnVault Architecture — V1 vs V2

The Earn\* vaults are ERC-4626 wrappers around a Morpho ERC-4626 vault. There are two wrapper
implementations because Morpho's two vault standards expose their deposit limits differently.

| Share | Wrapper | Asset | Morpho venue | Morpho standard |
|---|---|---|---|---|
| bUSDC | `EarnVaultV1` | USDC | Gauntlet USDC Prime (`0xeE8F…4b61`) | Morpho v1.1 |
| bBTC  | `EarnVaultV1` | cbBTC | Gauntlet cbBTC Core (`0x6770…07Cb`) | Morpho v1.1 |
| bETH  | `EarnVaultV2` | WETH | Gauntlet WETH (`0xFeFe…ff08`) | Morpho Vault V2 |

**Why two wrappers.** `EarnVaultV1` binds its ERC-4626 `maxDeposit`/`maxMint` to the underlying
Morpho vault, which works because Morpho v1.1 implements those max views. Morpho **Vault V2**
reports `maxDeposit == 0` even though deposits succeed, so `EarnVaultV2` deliberately does **not**
bind to that view. bETH uses the Gauntlet WETH V2 vault, hence `EarnVaultV2`.

Both wrappers share `EarnVaultBase.sol`: a Morpho-style share-dilution performance fee (10% /
1000 bps), a `1e6` virtual-share inflation offset, per-user `principalDeposited` tracking, and
`Ownable2Step` + `Pausable`. Owner **and** treasury are the Basement Safe
`0x2DFdCd13367E045b89Cfa126Ed8d896C6e172225` (2-of-3) from construction.

## By design
- **Seed deposit** on launch removes the empty-vault inflation edge that the `1e6` offset only
  mitigates.
- **No high-water mark**; **withdrawal liveness is delegated to Morpho** — documented in
  `EarnVaultBase.sol` NatSpec.
- **`renounceOwnership` left enabled** — deliberate; it cannot trap user funds (exits are never
  owner-gated).
- **bETH:** `morphoVault.maxDeposit(bETH)` reads `0` — expected for Morpho Vault V2; deposits still
  work. That quirk is the whole reason bETH is `EarnVaultV2`.
