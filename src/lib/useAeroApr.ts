"use client";

import { useReadContract } from "wagmi";
import { AERO_TOKEN_ADDRESS, AERO_STRATEGY_ABI } from "./contracts";

const SECONDS_PER_YEAR = 31_556_952n;
const COMPOUNDS_PER_YEAR = 365; // daily auto-compounding assumption for APR -> APY
const ONE_AERO = 10n ** 18n;

const GAUGE_ABI = [
  { name: "rewardRate", type: "function", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { name: "totalSupply", type: "function", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
] as const;

const POOL_ABI = [
  { name: "getReserves", type: "function", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }, { name: "", type: "uint256" }, { name: "", type: "uint256" }] },
  { name: "totalSupply", type: "function", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { name: "getAmountOut", type: "function", stateMutability: "view", inputs: [{ name: "amountIn", type: "uint256" }, { name: "tokenIn", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
] as const;

const ZERO = "0x0000000000000000000000000000000000000000";

export interface AeroApr {
  grossApr: number; // Aerodrome emissions APR — simple rate, matches their site
  netApy: number;   // net-of-fee, daily-COMPOUNDED APY — what an auto-compounding depositor realizes
  feeBps: number;   // performance fee in basis points (e.g. 1000 = 10%)
}

export interface AeroAprConfig {
  strategy: string; // BasementAeroStrategy (performanceFee + rewardPool)
  pool: string;     // want pool (LP) — token0 is the "hub" leg
  gauge: string;    // gauge (rewardRate + total staked LP)
}

/// @notice Live Aerodrome yield for any OptAero LP vault, generic over the pool pair.
///         gross APR = (annual AERO emissions valued in the hub token) / (gauge TVL in the hub token).
///           • AERO price (in hub) comes from the strategy's reward pool via `getAmountOut`.
///           • hub = want pool token0; gauge TVL ≈ stakedLP × 2 × hubReserve / poolSupply (50/50 pool).
///         Then net APY = compound(grossApr × (1 − fee)) daily. Returns null while loading.
export function useAeroApr(cfg?: AeroAprConfig, enabled = true): AeroApr | null {
  const on = enabled && !!cfg;
  const q = { query: { enabled: on } } as const;
  const gauge = cfg?.gauge as `0x${string}` | undefined;
  const pool = cfg?.pool as `0x${string}` | undefined;
  const strategy = cfg?.strategy as `0x${string}` | undefined;

  const { data: rewardRate } = useReadContract({ address: gauge, abi: GAUGE_ABI, functionName: "rewardRate", ...q });
  const { data: stakedLp }   = useReadContract({ address: gauge, abi: GAUGE_ABI, functionName: "totalSupply", ...q });
  const { data: reserves }   = useReadContract({ address: pool,  abi: POOL_ABI,  functionName: "getReserves", ...q });
  const { data: poolSupply } = useReadContract({ address: pool,  abi: POOL_ABI,  functionName: "totalSupply", ...q });
  const { data: perfFee }    = useReadContract({ address: strategy, abi: AERO_STRATEGY_ABI, functionName: "performanceFee", ...q });
  const { data: rewardPool } = useReadContract({ address: strategy, abi: AERO_STRATEGY_ABI, functionName: "rewardPool", ...q });
  // AERO price in the hub token, via the strategy's reward pool (AERO/hub).
  const { data: aeroPrice }  = useReadContract({
    address: rewardPool as `0x${string}` | undefined, abi: POOL_ABI, functionName: "getAmountOut",
    args: [ONE_AERO, AERO_TOKEN_ADDRESS],
    query: { enabled: on && !!rewardPool && rewardPool !== ZERO },
  });

  if (!on || rewardRate === undefined || stakedLp === undefined || reserves === undefined ||
      poolSupply === undefined || perfFee === undefined || aeroPrice === undefined) return null;
  if (stakedLp === 0n || poolSupply === 0n) return null;

  const hubReserve = reserves[0]; // want pool token0 = hub
  const annualHub = rewardRate * SECONDS_PER_YEAR * (aeroPrice as bigint) / ONE_AERO; // hub-wei / year
  const stakedTvlHub = stakedLp * 2n * hubReserve / poolSupply;                        // hub-wei
  if (stakedTvlHub === 0n) return null;

  const grossApr = Number(annualHub * 100n * 100n / stakedTvlHub) / 100; // % with 2-dp
  const feeBps = Number(perfFee as bigint);
  const netApr = (grossApr / 100) * (10000 - feeBps) / 10000;
  const netApy = (Math.pow(1 + netApr / COMPOUNDS_PER_YEAR, COMPOUNDS_PER_YEAR) - 1) * 100;
  return { grossApr, netApy, feeBps };
}
