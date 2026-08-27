import { encodeFunctionData, type Abi } from "viem";

/// The Basement governance Safe (2-of-3) on Base. Owner + treasury of every Earn vault.
export const SAFE_ADDRESS = "0x2DFdCd13367E045b89Cfa126Ed8d896C6e172225" as const;

/// The three Safe-owned Earn vaults, with their underlying Morpho venue and its
/// type. bETH sits on a Morpho Vault V2 (has programmable gates); the other two
/// are classic MetaMorpho v1.1. The version tag drives the gate watch below.
export const ADMIN_VAULTS = [
  {
    id: "usdc", name: "EarnUSDC", shareSymbol: "bUSDC", asset: "USDC", decimals: 6,
    address: "0xd795C20D954204853BB08d574DaE4ae362F2500a",
    morpho: "0xeE8F4eC5672F09119b96Ab6fB59C27E1b7e44b61", morphoName: "Gauntlet USDC Prime", version: "v1.1",
    usd: (n: number) => n, // USDC ≈ $1
  },
  {
    id: "weth", name: "EarnETH", shareSymbol: "bETH", asset: "WETH", decimals: 18,
    address: "0xD53e343bae99F8707042a049Acd539C7BE231AFB",
    morpho: "0xFeFeC33668E22677c4762d0853d56245a800ff08", morphoName: "Gauntlet WETH Balanced", version: "V2",
  },
  {
    id: "btc", name: "EarnBTC", shareSymbol: "bBTC", asset: "cbBTC", decimals: 8,
    address: "0x2656Fc87033F23216E848E0D3738A62cb116e070",
    morpho: "0x6770216aC60F634483Ec073cBABC4011c94307Cb", morphoName: "Gauntlet cbBTC Core", version: "v1.1",
  },
] as const;

export type AdminVault = (typeof ADMIN_VAULTS)[number];

/// Governance reads + admin writes on EarnVault. Read functions feed the
/// dashboard; write functions are only ever encoded into a Safe transaction,
/// never sent from the page.
export const EARN_ADMIN_ABI = [
  { name: "owner", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { name: "treasury", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { name: "performanceFee", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { name: "MAX_FEE", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { name: "depositCap", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { name: "paused", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
  { name: "totalAssets", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { name: "totalSupply", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { name: "balanceOf", type: "function", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
  // Writes — encode only.
  { name: "pause", type: "function", stateMutability: "nonpayable", inputs: [], outputs: [] },
  { name: "unpause", type: "function", stateMutability: "nonpayable", inputs: [], outputs: [] },
  { name: "setTreasury", type: "function", stateMutability: "nonpayable", inputs: [{ name: "_treasury", type: "address" }], outputs: [] },
  { name: "setPerformanceFee", type: "function", stateMutability: "nonpayable", inputs: [{ name: "_fee", type: "uint256" }], outputs: [] },
  { name: "setDepositCap", type: "function", stateMutability: "nonpayable", inputs: [{ name: "cap", type: "uint256" }], outputs: [] },
] as const;

/// Safe reads for the governance panel + the access gate.
export const SAFE_ABI = [
  { name: "getOwners", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "address[]" }] },
  { name: "getThreshold", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
] as const;

/// The four gate getters on a Morpho Vault V2. All-zero = no gate installed.
export const GATE_ABI = [
  { name: "sendAssetsGate", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { name: "sendSharesGate", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { name: "receiveSharesGate", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { name: "receiveAssetsGate", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
] as const;

export const GATE_LABELS = ["sendAssetsGate", "sendSharesGate", "receiveSharesGate", "receiveAssetsGate"] as const;

export const ZERO = "0x0000000000000000000000000000000000000000";

/// A ready-to-sign Safe transaction: where to send it and the calldata. `to` is
/// the vault, `value` is always 0 (no admin action moves ETH).
export type SafeTx = { to: string; data: `0x${string}`; label: string; summary: string };

export function buildTx(vault: AdminVault, fn: string, args: readonly unknown[], summary: string): SafeTx {
  return {
    to: vault.address,
    data: encodeFunctionData({ abi: EARN_ADMIN_ABI as Abi, functionName: fn, args: args as unknown[] }),
    label: `${vault.name}.${fn}`,
    summary,
  };
}

/// Deep-link that opens the Transaction Builder Safe App pointed at the Basement
/// Safe on Base. You paste the target + calldata there and co-sign — the same
/// flow used to set the first cap.
export function safeTxBuilderUrl(): string {
  const app = encodeURIComponent("https://apps-portal.safe.global/tx-builder");
  return `https://app.safe.global/apps/open?safe=base:${SAFE_ADDRESS}&appUrl=${app}`;
}

/// A share-denominated cap from a human asset amount, at parity (shares =
/// assets × 10^offset). Matches how the first bUSDC cap (100k → 1e17) was set.
/// The vault admits progressively more assets than this as the price grows.
export function assetCapToShareUnits(assetAmount: number, assetDecimals: number): bigint {
  // assetAmount × 10^(assetDecimals + 6), computed without float dust.
  const [whole, frac = ""] = assetAmount.toString().split(".");
  const fracPadded = (frac + "0".repeat(assetDecimals)).slice(0, assetDecimals);
  const rawAssets = BigInt(whole + fracPadded); // asset smallest units
  return rawAssets * 1_000_000n; // × 10^6 offset → share smallest units
}

export const short = (a?: string) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "—");
