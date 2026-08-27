import type { PublicClient } from "viem";
import { AERO_TOKEN_ADDRESS } from "./contracts";

// Per-epoch (weekly) net-APY history for an Aerodrome LP vault, computed entirely on-chain:
// APR(epoch) = rewardRateByEpoch(epoch) × seconds/yr × AERO price ÷ staked TVL, then net-of-fee &
// daily-compounded — the same formula as the live useAeroApr, fed each epoch's historical emission rate.
// NOTE: only the emission rate is historical; AERO price and staked TVL are read at "now" (an archive
// node would be needed for fully-historical price/TVL), so this is the emissions-driven APY trend.

const SECONDS_PER_YEAR = 31_556_952n;
const WEEK = 604_800;
const ONE_AERO = 10n ** 18n;
const COMPOUNDS_PER_YEAR = 365;

const GAUGE_ABI = [
  { name: "rewardRateByEpoch", type: "function", stateMutability: "view", inputs: [{ name: "", type: "uint256" }], outputs: [{ name: "", type: "uint256" }] },
  { name: "totalSupply", type: "function", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
] as const;
const POOL_ABI = [
  { name: "getReserves", type: "function", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }, { name: "", type: "uint256" }, { name: "", type: "uint256" }] },
  { name: "totalSupply", type: "function", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { name: "getAmountOut", type: "function", stateMutability: "view", inputs: [{ name: "", type: "uint256" }, { name: "", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
] as const;
const STRAT_ABI = [
  { name: "rewardPool", type: "function", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
  { name: "performanceFee", type: "function", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
] as const;

const VAULT_ABI = [
  { name: "totalAssets", type: "function", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
] as const;

export interface AeroApyPoint { ts: number; apy: number }

/// @notice Historical TVL of an LP vault, valued in its deposit token (= pool token0), at each block.
///   TVL@B = vault.totalAssets()@B (LP held) × pool value-per-LP@B, where value-per-LP = 2 × token0
///   reserve ÷ pool LP supply (50/50 pool). Reads are at past blocks (archive). Returns bigints in the
///   deposit-token's decimals (null for a block before the vault existed / read failure).
export async function fetchAeroTvlHistory(
  client: PublicClient,
  vaultAddr: string,
  poolAddr: string,
  blockNumbers: bigint[],
): Promise<(bigint | null)[]> {
  const vault = vaultAddr as `0x${string}`;
  const pool = poolAddr as `0x${string}`;
  const BATCH = 5;
  const out: (bigint | null)[] = [];
  for (let i = 0; i < blockNumbers.length; i += BATCH) {
    const batch = blockNumbers.slice(i, i + BATCH);
    const res = await Promise.all(
      batch.map(async (bn) => {
        try {
          const r = await client.multicall({
            contracts: [
              { address: vault, abi: VAULT_ABI, functionName: "totalAssets" },
              { address: pool, abi: POOL_ABI, functionName: "getReserves" },
              { address: pool, abi: POOL_ABI, functionName: "totalSupply" },
            ],
            allowFailure: true,
            blockNumber: bn,
          });
          if (r[0].status !== "success" || r[1].status !== "success" || r[2].status !== "success") return null;
          const totalAssets = r[0].result as bigint;
          const reserves = r[1].result as readonly [bigint, bigint, bigint];
          const poolSupply = r[2].result as bigint;
          if (poolSupply === 0n) return null;
          return (totalAssets * 2n * reserves[0]) / poolSupply; // TVL in token0 (deposit-token) decimals
        } catch {
          return null;
        }
      }),
    );
    out.push(...res);
  }
  return out;
}

/// @param epochs how many recent weekly epochs to fetch (pre-inception epochs return 0 and are dropped)
export async function fetchAeroApyHistory(
  client: PublicClient,
  cfg: { gauge: string; pool: string; strategy: string },
  epochs: number,
  nowSec: number,
): Promise<AeroApyPoint[]> {
  const gauge = cfg.gauge as `0x${string}`;
  const pool = cfg.pool as `0x${string}`;
  const strategy = cfg.strategy as `0x${string}`;

  const currentEpoch = nowSec - (nowSec % WEEK);
  const epochStarts: number[] = [];
  for (let k = epochs - 1; k >= 0; k--) epochStarts.push(currentEpoch - k * WEEK); // oldest → newest

  // Current TVL / fee / reward pool (price source). Held constant across epochs.
  const [stakedLp, reserves, poolSupply, rewardPool, perfFee] = (await Promise.all([
    client.readContract({ address: gauge, abi: GAUGE_ABI, functionName: "totalSupply" }),
    client.readContract({ address: pool, abi: POOL_ABI, functionName: "getReserves" }),
    client.readContract({ address: pool, abi: POOL_ABI, functionName: "totalSupply" }),
    client.readContract({ address: strategy, abi: STRAT_ABI, functionName: "rewardPool" }),
    client.readContract({ address: strategy, abi: STRAT_ABI, functionName: "performanceFee" }),
  ])) as [bigint, readonly [bigint, bigint, bigint], bigint, `0x${string}`, bigint];

  if (poolSupply === 0n || stakedLp === 0n) return [];
  const hubReserve = reserves[0]; // pool token0 = the hub the reward swaps into
  const stakedTvlHub = (stakedLp * 2n * hubReserve) / poolSupply; // 50/50 pool → 2× one side
  if (stakedTvlHub === 0n) return [];

  const aeroPrice = (await client.readContract({
    address: rewardPool, abi: POOL_ABI, functionName: "getAmountOut", args: [ONE_AERO, AERO_TOKEN_ADDRESS as `0x${string}`],
  })) as bigint;
  if (aeroPrice === 0n) return [];

  const feeBps = Number(perfFee);

  // Historical per-epoch emission rates in one multicall.
  const rates = await client.multicall({
    contracts: epochStarts.map((e) => ({
      address: gauge, abi: GAUGE_ABI, functionName: "rewardRateByEpoch", args: [BigInt(e)],
    })),
    allowFailure: true,
  });

  const pts: AeroApyPoint[] = [];
  epochStarts.forEach((e, i) => {
    const r = rates[i];
    if (r.status !== "success") return;
    const rate = r.result as bigint;
    if (rate === 0n) return; // before gauge inception / no emissions that epoch
    const annualHub = (rate * SECONDS_PER_YEAR * aeroPrice) / ONE_AERO; // hub-wei / year
    const grossApr = Number((annualHub * 100n * 100n) / stakedTvlHub) / 100; // % (2 dp)
    const netApr = (grossApr / 100) * (10_000 - feeBps) / 10_000;
    const netApy = (Math.pow(1 + netApr / COMPOUNDS_PER_YEAR, COMPOUNDS_PER_YEAR) - 1) * 100;
    pts.push({ ts: e, apy: Math.round(netApy * 100) / 100 });
  });
  return pts;
}
