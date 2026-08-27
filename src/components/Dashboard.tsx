"use client";

import { useAccount, useReadContract, usePublicClient, useBlockNumber } from "wagmi";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import Image from "next/image";
import { VAULTS } from "@/lib/vaults";
import { fmt6, fmtUsd, fmtUnits } from "@/lib/format";
import { EARN_USDC_ADDRESS, EARN_USDC_ABI, EARN_ETH_ADDRESS, EARN_BTC_ADDRESS, MORPHO_CBBTC_VAULT_ADDRESS, MORPHO_VAULT_ADDRESS, MORPHO_WETH_VAULT_ADDRESS, MORPHO_VAULT_ABI, USDC_ADDRESS, ERC20_ABI, AERO_LP_ABI, AERO_ZAP_ADDRESS, AERO_ZAP_ABI, ETH_USD_FEED, BTC_USD_FEED, CHAINLINK_ABI } from "@/lib/contracts";
import { useState, useEffect } from "react";
import { useMorphoApy } from "@/lib/useMorphoApy";
import { useAeroApr } from "@/lib/useAeroApr";
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts";



// USD price per whole token (USDC = 1; WETH/cbBTC via Chainlink). undefined while the feed loads.
function useUsdPrice(symbol: string): number | undefined {
  const feed = symbol === "WETH" ? ETH_USD_FEED : symbol === "cbBTC" ? BTC_USD_FEED : undefined;
  const { data } = useReadContract({ address: feed, abi: CHAINLINK_ABI, functionName: "latestRoundData", query: { enabled: !!feed } });
  if (!feed) return 1; // USDC / unknown → already USD
  return data !== undefined ? Number(data[1]) / 1e8 : undefined; // answer (8dp)
}

// Shared building blocks for the mobile card variant of each position row.
// Desktop keeps the exact <td> layout; mobile renders a glass card with the
// same data via these helpers so logic/markup stays in one component.
function MobileCardShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border p-4 flex flex-col gap-3 w-full max-w-full" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
      {children}
    </div>
  );
}

function MobileMetric({ label, value, valueColor }: { label: string; value: React.ReactNode; valueColor?: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs shrink-0" style={{ color: "var(--text-muted)" }}>{label}</span>
      <span className="text-sm font-medium text-right min-w-0 truncate" style={valueColor ? { color: valueColor } : undefined}>{value}</span>
    </div>
  );
}

function MobileActions({ depositHref, withdrawHref, disabled }: { depositHref?: string; withdrawHref?: string; disabled?: boolean }) {
  if (disabled) {
    return (
      <div className="flex gap-2 w-full">
        <span className="flex-1 text-center px-4 py-2.5 rounded-lg text-xs font-medium opacity-40 cursor-not-allowed" style={{ background: "rgba(52,211,153,0.15)", color: "#ffffff", border: "1px solid rgba(52,211,153,0.3)" }}>Deposit</span>
        <span className="flex-1 text-center px-4 py-2.5 rounded-lg text-xs font-medium opacity-40 cursor-not-allowed" style={{ background: "transparent", color: "#ffffff", border: "1px solid var(--border)" }}>Withdraw</span>
      </div>
    );
  }
  return (
    <div className="flex gap-2 w-full">
      <Link href={depositHref!} onClick={(e) => e.stopPropagation()} className="flex-1 text-center px-4 py-2.5 rounded-lg text-xs font-medium transition-opacity hover:opacity-80" style={{ background: "rgba(52,211,153,0.15)", color: "#ffffff", border: "1px solid rgba(52,211,153,0.3)" }}>
        Deposit
      </Link>
      <Link href={withdrawHref!} onClick={(e) => e.stopPropagation()} className="flex-1 text-center px-4 py-2.5 rounded-lg text-xs font-medium transition-opacity hover:opacity-80" style={{ background: "transparent", color: "#ffffff", border: "1px solid var(--border)" }}>
        Withdraw
      </Link>
    </div>
  );
}

function UsdcVaultRow({ address, mobile }: { address: `0x${string}`; mobile?: boolean }) {
  const { apy } = useMorphoApy();

  // User's EarnUSDC shares
  const { data: userShares } = useReadContract({
    address: EARN_USDC_ADDRESS, abi: EARN_USDC_ABI,
    functionName: "balanceOf", args: [address],
  });

  // Total EarnUSDC supply
  const { data: totalSupply } = useReadContract({
    address: EARN_USDC_ADDRESS, abi: EARN_USDC_ABI,
    functionName: "totalSupply",
  });

  // Morpho shares owned by EarnUSDC
  const { data: morphoShares } = useReadContract({
    address: MORPHO_VAULT_ADDRESS, abi: MORPHO_VAULT_ABI,
    functionName: "balanceOf", args: [EARN_USDC_ADDRESS],
  });

  // Total USDC value sitting in Morpho for our vault
  const { data: morphoTotalAssets } = useReadContract({
    address: MORPHO_VAULT_ADDRESS, abi: MORPHO_VAULT_ABI,
    functionName: "convertToAssets",
    args: morphoShares ? [morphoShares] : undefined,
    query: { enabled: morphoShares !== undefined && morphoShares > 0n },
  });

  // User's proportional USDC value = morphoTotalAssets * userShares / totalSupply
  const currentAssets =
    morphoTotalAssets !== undefined && totalSupply !== undefined && totalSupply > 0n && userShares !== undefined
      ? (morphoTotalAssets * userShares) / totalSupply
      : 0n;


  const tvlUsd = morphoTotalAssets !== undefined
    ? fmtUsd(Number(morphoTotalAssets) / 1e6)
    : "—";
  const tvlNative = morphoTotalAssets !== undefined
    ? `${Math.round(Number(morphoTotalAssets) / 1e6).toLocaleString()} USDC`
    : "—";
  const apyStr = apy !== null ? `${apy.toFixed(2)}%` : "—";
  const vault = VAULTS.find(v => v.id === "usdc")!;
  // Position: USD value on top, underlying amount below (USDC ≈ 1:1 USD).
  const posUsd = fmtUsd(Number(currentAssets) / 1e6);
  const posNative = `${fmt6(currentAssets)} USDC`;

  if (mobile) {
    return (
      <MobileCardShell>
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full overflow-hidden shrink-0 flex items-center justify-center" style={{ background: vault.iconBg }}>
            <Image src={vault.iconUrl} alt={vault.tokenSymbol} width={36} height={36} className="w-full h-full object-contain p-0.5" unoptimized />
          </div>
          <div className="min-w-0">
            <div className="font-medium text-sm truncate">{vault.name}</div>
            <div className="text-xs" style={{ color: "var(--text-muted)" }}>{vault.tokenSymbol}</div>
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <MobileMetric label="TVL" value={<span className="flex flex-col items-end"><span>{tvlUsd}</span>{tvlNative !== "—" && <span className="text-xs font-normal" style={{ color: "var(--text-muted)" }}>{tvlNative}</span>}</span>} />
          <MobileMetric label="Position" value={<span className="flex flex-col items-end"><span>{posUsd}</span><span className="text-xs font-normal" style={{ color: "var(--text-muted)" }}>{posNative}</span></span>} />
          <MobileMetric label="APY" value={apyStr} valueColor="#34D399" />
        </div>
        <MobileActions depositHref="/vault/usdc" withdrawHref="/vault/usdc#withdraw" />
      </MobileCardShell>
    );
  }

  return (
    <>
      <td className="py-6 pl-5 pr-2">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full overflow-hidden shrink-0 flex items-center justify-center" style={{ background: vault.iconBg }}>
            <Image src={vault.iconUrl} alt={vault.tokenSymbol} width={32} height={32} className="w-full h-full object-contain p-0.5" unoptimized />
          </div>
          <div>
            <div className="font-medium text-sm">{vault.name}</div>
            <div className="text-xs" style={{ color: "var(--text-muted)" }}>{vault.tokenSymbol}</div>
          </div>
        </div>
      </td>
      <td className="py-6 pr-2">
        <div className="text-sm font-medium">{tvlUsd}</div>
        {tvlNative !== "—" && <div className="text-xs" style={{ color: "var(--text-muted)" }}>{tvlNative}</div>}
      </td>
      <td className="py-6 pr-2">
        <div className="text-sm font-medium">{posUsd}</div>
        <div className="text-xs" style={{ color: "var(--text-muted)" }}>{posNative}</div>
      </td>
      <td className="py-6 pr-2 text-sm" style={{ color: "#34D399" }}>{apyStr}</td>
      <td className="py-6 pr-5">
        <div className="flex gap-2 justify-end">
          <Link href="/vault/usdc" onClick={(e) => e.stopPropagation()} className="px-4 py-1.5 rounded-lg text-xs font-medium transition-opacity hover:opacity-80" style={{ background: "rgba(52,211,153,0.15)", color: "#ffffff", border: "1px solid rgba(52,211,153,0.3)" }}>
            Deposit
          </Link>
          <Link href="/vault/usdc#withdraw" onClick={(e) => e.stopPropagation()} className="px-4 py-1.5 rounded-lg text-xs font-medium transition-opacity hover:opacity-80" style={{ background: "transparent", color: "#ffffff", border: "1px solid var(--border)" }}>
            Withdraw
          </Link>
        </div>
      </td>
    </>
  );
}

function WethVaultRow({ address, mobile }: { address: `0x${string}`; mobile?: boolean }) {
  const vault = VAULTS.find(v => v.id === "weth")!;
  const { apy } = useMorphoApy(MORPHO_WETH_VAULT_ADDRESS);

  const { data: userShares } = useReadContract({
    address: EARN_ETH_ADDRESS, abi: EARN_USDC_ABI,
    functionName: "balanceOf", args: [address],
  });
  const { data: totalSupply } = useReadContract({
    address: EARN_ETH_ADDRESS, abi: EARN_USDC_ABI,
    functionName: "totalSupply",
  });
  const { data: morphoShares } = useReadContract({
    address: MORPHO_WETH_VAULT_ADDRESS, abi: MORPHO_VAULT_ABI,
    functionName: "balanceOf", args: [EARN_ETH_ADDRESS],
  });
  const { data: morphoTotalAssets } = useReadContract({
    address: MORPHO_WETH_VAULT_ADDRESS, abi: MORPHO_VAULT_ABI,
    functionName: "convertToAssets",
    args: morphoShares ? [morphoShares] : undefined,
    query: { enabled: morphoShares !== undefined && morphoShares > 0n },
  });

  const currentAssets =
    morphoTotalAssets !== undefined && totalSupply !== undefined && totalSupply > 0n && userShares !== undefined
      ? (morphoTotalAssets * userShares) / totalSupply
      : 0n;

  const tvlNative = morphoTotalAssets !== undefined ? `${fmtUnits(morphoTotalAssets, 18, 4)} WETH` : "—";
  const ethPrice = useUsdPrice("WETH");
  const tvlUsd = morphoTotalAssets !== undefined && ethPrice !== undefined
    ? fmtUsd((Number(morphoTotalAssets) / 1e18) * ethPrice)
    : "—";
  const apyStr = `${(apy ?? vault.netApy).toFixed(2)}%`;
  // Position: USD value on top, WETH amount below.
  const posUsd = ethPrice !== undefined ? fmtUsd((Number(currentAssets) / 1e18) * ethPrice) : null;
  const posNative = `${fmtUnits(currentAssets, 18, 4)} WETH`;

  if (mobile) {
    return (
      <MobileCardShell>
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full overflow-hidden shrink-0 flex items-center justify-center" style={{ background: vault.iconBg }}>
            <Image src={vault.iconUrl} alt={vault.tokenSymbol} width={36} height={36} className="w-full h-full object-contain p-0.5" unoptimized />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 font-medium text-sm">
              <span className="truncate">{vault.name}</span>
              <span className="text-xs px-2 py-0.5 rounded-full shrink-0" style={{ background: "rgba(52,211,153,0.1)", color: "#34D399" }}>New</span>
            </div>
            <div className="text-xs" style={{ color: "var(--text-muted)" }}>{vault.tokenSymbol}</div>
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <MobileMetric label="TVL" value={<span className="flex flex-col items-end"><span>{tvlUsd}</span>{tvlNative !== "—" && <span className="text-xs font-normal" style={{ color: "var(--text-muted)" }}>{tvlNative}</span>}</span>} />
          <MobileMetric label="Position" value={<span className="flex flex-col items-end"><span>{posUsd ?? posNative}</span>{posUsd !== null && <span className="text-xs font-normal" style={{ color: "var(--text-muted)" }}>{posNative}</span>}</span>} />
          <MobileMetric label="APY" value={apyStr} valueColor="#34D399" />
        </div>
        <MobileActions depositHref="/vault/weth" withdrawHref="/vault/weth#withdraw" />
      </MobileCardShell>
    );
  }

  return (
    <>
      <td className="py-6 pl-5 pr-2">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full overflow-hidden shrink-0 flex items-center justify-center" style={{ background: vault.iconBg }}>
            <Image src={vault.iconUrl} alt={vault.tokenSymbol} width={32} height={32} className="w-full h-full object-contain p-0.5" unoptimized />
          </div>
          <div>
            <div className="flex items-center gap-2 font-medium text-sm">
              {vault.name}
              <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: "rgba(52,211,153,0.1)", color: "#34D399" }}>New</span>
            </div>
            <div className="text-xs" style={{ color: "var(--text-muted)" }}>{vault.tokenSymbol}</div>
          </div>
        </div>
      </td>
      <td className="py-6 pr-2">
        <div className="text-sm font-medium">{tvlUsd}</div>
        {tvlNative !== "—" && <div className="text-xs" style={{ color: "var(--text-muted)" }}>{tvlNative}</div>}
      </td>
      <td className="py-6 pr-2">
        <div className="text-sm font-medium">{posUsd ?? posNative}</div>
        {posUsd !== null && <div className="text-xs" style={{ color: "var(--text-muted)" }}>{posNative}</div>}
      </td>
      <td className="py-6 pr-2 text-sm" style={{ color: "#34D399" }}>{apyStr}</td>
      <td className="py-6 pr-5">
        <div className="flex gap-2 justify-end">
          <Link href="/vault/weth" onClick={(e) => e.stopPropagation()} className="px-4 py-1.5 rounded-lg text-xs font-medium transition-opacity hover:opacity-80" style={{ background: "rgba(52,211,153,0.15)", color: "#ffffff", border: "1px solid rgba(52,211,153,0.3)" }}>
            Deposit
          </Link>
          <Link href="/vault/weth#withdraw" onClick={(e) => e.stopPropagation()} className="px-4 py-1.5 rounded-lg text-xs font-medium transition-opacity hover:opacity-80" style={{ background: "transparent", color: "#ffffff", border: "1px solid var(--border)" }}>
            Withdraw
          </Link>
        </div>
      </td>
    </>
  );
}

function EarnBtcVaultRow({ address, mobile }: { address: `0x${string}`; mobile?: boolean }) {
  const vault = VAULTS.find(v => v.id === "earnbtc")!;
  const { apy } = useMorphoApy(MORPHO_CBBTC_VAULT_ADDRESS);

  const { data: userShares } = useReadContract({
    address: EARN_BTC_ADDRESS, abi: EARN_USDC_ABI,
    functionName: "balanceOf", args: [address],
  });
  const { data: totalSupply } = useReadContract({
    address: EARN_BTC_ADDRESS, abi: EARN_USDC_ABI,
    functionName: "totalSupply",
  });
  const { data: morphoShares } = useReadContract({
    address: MORPHO_CBBTC_VAULT_ADDRESS, abi: MORPHO_VAULT_ABI,
    functionName: "balanceOf", args: [EARN_BTC_ADDRESS],
  });
  const { data: morphoTotalAssets } = useReadContract({
    address: MORPHO_CBBTC_VAULT_ADDRESS, abi: MORPHO_VAULT_ABI,
    functionName: "convertToAssets",
    args: morphoShares ? [morphoShares] : undefined,
    query: { enabled: morphoShares !== undefined && morphoShares > 0n },
  });

  const currentAssets =
    morphoTotalAssets !== undefined && totalSupply !== undefined && totalSupply > 0n && userShares !== undefined
      ? (morphoTotalAssets * userShares) / totalSupply
      : 0n;

  const tvlNative = morphoTotalAssets !== undefined ? `${fmtUnits(morphoTotalAssets, 8, 6)} cbBTC` : "—";
  const btcPrice = useUsdPrice("cbBTC");
  const tvlUsd = morphoTotalAssets !== undefined && btcPrice !== undefined
    ? fmtUsd((Number(morphoTotalAssets) / 1e8) * btcPrice)
    : "—";
  const apyStr = `${(apy ?? vault.netApy).toFixed(2)}%`;
  // Position: USD value on top, cbBTC amount below.
  const posUsd = btcPrice !== undefined ? fmtUsd((Number(currentAssets) / 1e8) * btcPrice) : null;
  const posNative = `${fmtUnits(currentAssets, 8, 6)} cbBTC`;

  if (mobile) {
    return (
      <MobileCardShell>
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full overflow-hidden shrink-0 flex items-center justify-center" style={{ background: vault.iconBg }}>
            <Image src={vault.iconUrl} alt={vault.tokenSymbol} width={36} height={36} className="w-full h-full object-contain p-0.5" unoptimized />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 font-medium text-sm">
              <span className="truncate">{vault.name}</span>
              <span className="text-xs px-2 py-0.5 rounded-full shrink-0" style={{ background: "rgba(52,211,153,0.1)", color: "#34D399" }}>New</span>
            </div>
            <div className="text-xs" style={{ color: "var(--text-muted)" }}>{vault.tokenSymbol}</div>
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <MobileMetric label="TVL" value={<span className="flex flex-col items-end"><span>{tvlUsd}</span>{tvlNative !== "—" && <span className="text-xs font-normal" style={{ color: "var(--text-muted)" }}>{tvlNative}</span>}</span>} />
          <MobileMetric label="Position" value={<span className="flex flex-col items-end"><span>{posUsd ?? posNative}</span>{posUsd !== null && <span className="text-xs font-normal" style={{ color: "var(--text-muted)" }}>{posNative}</span>}</span>} />
          <MobileMetric label="APY" value={apyStr} valueColor="#34D399" />
        </div>
        <MobileActions depositHref="/vault/earnbtc" withdrawHref="/vault/earnbtc#withdraw" />
      </MobileCardShell>
    );
  }

  return (
    <>
      <td className="py-6 pl-5 pr-2">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full overflow-hidden shrink-0 flex items-center justify-center" style={{ background: vault.iconBg }}>
            <Image src={vault.iconUrl} alt={vault.tokenSymbol} width={32} height={32} className="w-full h-full object-contain p-0.5" unoptimized />
          </div>
          <div>
            <div className="flex items-center gap-2 font-medium text-sm">
              {vault.name}
              <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: "rgba(52,211,153,0.1)", color: "#34D399" }}>New</span>
            </div>
            <div className="text-xs" style={{ color: "var(--text-muted)" }}>{vault.tokenSymbol}</div>
          </div>
        </div>
      </td>
      <td className="py-6 pr-2">
        <div className="text-sm font-medium">{tvlUsd}</div>
        {tvlNative !== "—" && <div className="text-xs" style={{ color: "var(--text-muted)" }}>{tvlNative}</div>}
      </td>
      <td className="py-6 pr-2">
        <div className="text-sm font-medium">{posUsd ?? posNative}</div>
        {posUsd !== null && <div className="text-xs" style={{ color: "var(--text-muted)" }}>{posNative}</div>}
      </td>
      <td className="py-6 pr-2 text-sm" style={{ color: "#34D399" }}>{apyStr}</td>
      <td className="py-6 pr-5">
        <div className="flex gap-2 justify-end">
          <Link href="/vault/earnbtc" onClick={(e) => e.stopPropagation()} className="px-4 py-1.5 rounded-lg text-xs font-medium transition-opacity hover:opacity-80" style={{ background: "rgba(52,211,153,0.15)", color: "#ffffff", border: "1px solid rgba(52,211,153,0.3)" }}>
            Deposit
          </Link>
          <Link href="/vault/earnbtc#withdraw" onClick={(e) => e.stopPropagation()} className="px-4 py-1.5 rounded-lg text-xs font-medium transition-opacity hover:opacity-80" style={{ background: "transparent", color: "#ffffff", border: "1px solid var(--border)" }}>
            Withdraw
          </Link>
        </div>
      </td>
    </>
  );
}

function ComingSoonRow({ name, symbol, mobile }: { name: string; symbol: string; apy: number; mobile?: boolean }) {
  const vault = VAULTS.find(v => v.name === name);

  if (mobile) {
    return (
      <MobileCardShell>
        <div className="flex items-center gap-3 opacity-50">
          {vault && (
            <div className="w-9 h-9 rounded-full overflow-hidden shrink-0 flex items-center justify-center" style={{ background: vault.iconBg }}>
              <Image src={vault.iconUrl} alt={symbol} width={36} height={36} className="w-full h-full object-contain p-0.5" unoptimized />
            </div>
          )}
          <div className="min-w-0">
            <div className="flex items-center gap-2 font-medium text-sm">
              <span className="truncate">{name}</span>
              <span className="text-xs px-2 py-0.5 rounded-full shrink-0" style={{ background: "rgba(255,255,255,0.08)", color: "var(--text-muted)" }}>Coming Soon</span>
            </div>
            <div className="text-xs" style={{ color: "var(--text-muted)" }}>{symbol}</div>
          </div>
        </div>
        <div className="flex flex-col gap-2 opacity-50">
          <MobileMetric label="TVL" value="—" />
          <MobileMetric label="Position" value="—" />
          <MobileMetric label="APY" value="—" />
        </div>
        <MobileActions disabled />
      </MobileCardShell>
    );
  }

  return (
    <>
      <td className="py-6 pl-5 pr-2 opacity-50">
        <div className="flex items-center gap-3">
          {vault && (
            <div className="w-8 h-8 rounded-full overflow-hidden shrink-0 flex items-center justify-center" style={{ background: vault.iconBg }}>
              <Image src={vault.iconUrl} alt={symbol} width={32} height={32} className="w-full h-full object-contain p-0.5" unoptimized />
            </div>
          )}
          <div>
            <div className="flex items-center gap-2 font-medium text-sm">
              {name}
              <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: "rgba(255,255,255,0.08)", color: "var(--text-muted)" }}>
                Coming Soon
              </span>
            </div>
            <div className="text-xs" style={{ color: "var(--text-muted)" }}>{symbol}</div>
          </div>
        </div>
      </td>
      <td className="py-6 pr-2 text-sm opacity-50">—</td>
      <td className="py-6 pr-2 text-sm opacity-50">—</td>
      <td className="py-6 pr-2 text-sm opacity-50">—</td>
      <td className="py-6 pr-2 text-sm opacity-50">—</td>
      <td className="py-6 pr-5">
        <div className="flex gap-2 justify-end">
          <span className="px-4 py-1.5 rounded-lg text-xs font-medium opacity-40 cursor-not-allowed" style={{ background: "rgba(52,211,153,0.15)", color: "#ffffff", border: "1px solid rgba(52,211,153,0.3)" }}>Deposit</span>
          <span className="px-4 py-1.5 rounded-lg text-xs font-medium opacity-40 cursor-not-allowed" style={{ background: "transparent", color: "#ffffff", border: "1px solid var(--border)" }}>Withdraw</span>
        </div>
      </td>
    </>
  );
}

// Aerodrome LP vault (auto-compounding): shares are LP-denominated, so TVL/position come from
// BasementAeroZap.valueOfSharesInToken (valued in the deposit token). No principal tracking → yield is
// auto-compounded into the position rather than separately claimable.
function AeroLpVaultRow({ vault, address, mobile }: { vault: typeof VAULTS[number]; address: `0x${string}`; mobile?: boolean }) {
  const lp = vault.lp!;
  const vaultAddr = vault.contractAddress as `0x${string}`;
  const quote = lp.depositToken as `0x${string}`;
  const dec = vault.decimals ?? 6;
  const isUsd = lp.depositSymbol === "USDC";
  const apr = useAeroApr(lp);

  const { data: totalSupply } = useReadContract({ address: vaultAddr, abi: AERO_LP_ABI, functionName: "totalSupply" });
  const { data: tvl } = useReadContract({
    address: AERO_ZAP_ADDRESS, abi: AERO_ZAP_ABI, functionName: "valueOfSharesInToken",
    args: totalSupply !== undefined ? [vaultAddr, totalSupply, quote] : undefined,
    query: { enabled: totalSupply !== undefined && totalSupply > 0n },
  });
  const { data: userShares } = useReadContract({
    address: vaultAddr, abi: AERO_LP_ABI, functionName: "balanceOf",
    args: address ? [address] : undefined, query: { enabled: !!address },
  });
  const { data: userValue } = useReadContract({
    address: AERO_ZAP_ADDRESS, abi: AERO_ZAP_ABI, functionName: "valueOfSharesInToken",
    args: userShares !== undefined ? [vaultAddr, userShares, quote] : undefined,
    query: { enabled: userShares !== undefined && userShares > 0n },
  });

  // TVL: USD main + native deposit-token amount below. USDC LP is already USD; WETH LP needs the price.
  const ethPrice = useUsdPrice(lp.depositSymbol);
  const tvlUsd = tvl !== undefined && (isUsd || ethPrice !== undefined)
    ? fmtUsd(isUsd ? Number(tvl) / 10 ** dec : (Number(tvl) / 10 ** dec) * ethPrice!)
    : "—";
  const tvlNative = tvl !== undefined ? `${fmtUnits(tvl, dec, isUsd ? 2 : 4)} ${lp.depositSymbol}` : "—";
  // Position: USD value on top, native deposit-token amount below.
  const uv = userValue ?? 0n;
  const posUsd = isUsd
    ? fmtUsd(Number(uv) / 10 ** dec)
    : (ethPrice !== undefined ? fmtUsd((Number(uv) / 10 ** dec) * ethPrice) : null);
  const posNative = `${fmtUnits(uv, dec, isUsd ? 2 : 4)} ${lp.depositSymbol}`;
  const apyStr = apr !== null ? `${apr.netApy.toFixed(2)}%` : vault.netApy > 0 ? `${vault.netApy.toFixed(2)}%` : "—";

  if (mobile) {
    return (
      <MobileCardShell>
        <div className="flex items-center gap-3">
          <div className="flex items-center shrink-0">
            {lp.assets.map((t, i) => (
              <div key={t.alt} className="w-9 h-9 rounded-full overflow-hidden shrink-0 flex items-center justify-center" style={{ background: t.bg, marginLeft: i === 0 ? 0 : -10, boxShadow: i === 0 ? undefined : "0 0 0 2px #1B1B1B" }}>
                <Image src={t.src} alt={t.alt} width={36} height={36} className="w-full h-full object-contain p-0.5" unoptimized />
              </div>
            ))}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 font-medium text-sm">
              <span className="truncate">{vault.name}</span>
              <span className="text-xs px-2 py-0.5 rounded-full shrink-0" style={{ background: "rgba(52,211,153,0.1)", color: "#34D399" }}>New</span>
            </div>
            <div className="text-xs" style={{ color: "var(--text-muted)" }}>{lp.assets[0].alt}/{lp.assets[1].alt}</div>
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <MobileMetric label="TVL" value={<span className="flex flex-col items-end"><span>{tvlUsd}</span>{tvlNative !== "—" && <span className="text-xs font-normal" style={{ color: "var(--text-muted)" }}>{tvlNative}</span>}</span>} />
          <MobileMetric label="Position" value={<span className="flex flex-col items-end"><span>{posUsd ?? posNative}</span>{posUsd !== null && <span className="text-xs font-normal" style={{ color: "var(--text-muted)" }}>{posNative}</span>}</span>} />
          <MobileMetric label="APY" value={apyStr} valueColor="#34D399" />
        </div>
        <MobileActions depositHref={`/vault/${vault.id}`} withdrawHref={`/vault/${vault.id}#withdraw`} />
      </MobileCardShell>
    );
  }

  return (
    <>
      <td className="py-6 pl-5 pr-2">
        <div className="flex items-center gap-3">
          <div className="flex items-center shrink-0">
            {lp.assets.map((t, i) => (
              <div key={t.alt} className="w-8 h-8 rounded-full overflow-hidden shrink-0 flex items-center justify-center" style={{ background: t.bg, marginLeft: i === 0 ? 0 : -10, boxShadow: i === 0 ? undefined : "0 0 0 2px #1B1B1B" }}>
                <Image src={t.src} alt={t.alt} width={32} height={32} className="w-full h-full object-contain p-0.5" unoptimized />
              </div>
            ))}
          </div>
          <div>
            <div className="flex items-center gap-2 font-medium text-sm">
              {vault.name}
              <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: "rgba(52,211,153,0.1)", color: "#34D399" }}>New</span>
            </div>
            <div className="text-xs" style={{ color: "var(--text-muted)" }}>{lp.assets[0].alt}/{lp.assets[1].alt}</div>
          </div>
        </div>
      </td>
      <td className="py-6 pr-2">
        <div className="text-sm font-medium">{tvlUsd}</div>
        {tvlNative !== "—" && <div className="text-xs" style={{ color: "var(--text-muted)" }}>{tvlNative}</div>}
      </td>
      <td className="py-6 pr-2">
        <div className="text-sm font-medium">{posUsd ?? posNative}</div>
        {posUsd !== null && <div className="text-xs" style={{ color: "var(--text-muted)" }}>{posNative}</div>}
      </td>
      <td className="py-6 pr-2 text-sm" style={{ color: "#34D399" }}>{apyStr}</td>
      <td className="py-6 pr-5">
        <div className="flex gap-2 justify-end">
          <Link href={`/vault/${vault.id}`} onClick={(e) => e.stopPropagation()} className="px-4 py-1.5 rounded-lg text-xs font-medium transition-opacity hover:opacity-80" style={{ background: "rgba(52,211,153,0.15)", color: "#ffffff", border: "1px solid rgba(52,211,153,0.3)" }}>
            Deposit
          </Link>
          <Link href={`/vault/${vault.id}#withdraw`} onClick={(e) => e.stopPropagation()} className="px-4 py-1.5 rounded-lg text-xs font-medium transition-opacity hover:opacity-80" style={{ background: "transparent", color: "#ffffff", border: "1px solid var(--border)" }}>
            Withdraw
          </Link>
        </div>
      </td>
    </>
  );
}

// Shared position readers for the portfolio totals. Identical reads to the row components, so
// react-query dedupes them (no extra network cost). Returns native-unit amounts.
function useMorphoVaultPos(earnAddr: `0x${string}`, morphoAddr: `0x${string}`, address?: `0x${string}`) {
  const { data: userShares } = useReadContract({ address: earnAddr, abi: EARN_USDC_ABI, functionName: "balanceOf", args: address ? [address] : undefined, query: { enabled: !!address } });
  const { data: totalSupply } = useReadContract({ address: earnAddr, abi: EARN_USDC_ABI, functionName: "totalSupply" });
  const { data: morphoShares } = useReadContract({ address: morphoAddr, abi: MORPHO_VAULT_ABI, functionName: "balanceOf", args: [earnAddr] });
  const { data: morphoTotalAssets } = useReadContract({ address: morphoAddr, abi: MORPHO_VAULT_ABI, functionName: "convertToAssets", args: morphoShares ? [morphoShares] : undefined, query: { enabled: morphoShares !== undefined && morphoShares > 0n } });
  const currentAssets = morphoTotalAssets !== undefined && totalSupply !== undefined && totalSupply > 0n && userShares !== undefined ? (morphoTotalAssets * userShares) / totalSupply : 0n;
  return { currentAssets };
}

function useLpVaultPos(vault: typeof VAULTS[number], address?: `0x${string}`) {
  const lp = vault.lp!;
  const vaultAddr = vault.contractAddress as `0x${string}`;
  const { data: userShares } = useReadContract({ address: vaultAddr, abi: AERO_LP_ABI, functionName: "balanceOf", args: address ? [address] : undefined, query: { enabled: !!address } });
  const { data: userValue } = useReadContract({ address: AERO_ZAP_ADDRESS, abi: AERO_ZAP_ABI, functionName: "valueOfSharesInToken", args: userShares !== undefined ? [vaultAddr, userShares, lp.depositToken as `0x${string}`] : undefined, query: { enabled: userShares !== undefined && userShares > 0n } });
  const apr = useAeroApr(lp);
  return { userValue: (userValue as bigint | undefined) ?? 0n, apy: apr !== null ? apr.netApy : null };
}

export default function Dashboard() {
  const { isConnected, address } = useAccount();
  const router = useRouter();

  const { data: userShares2 } = useReadContract({
    address: EARN_USDC_ADDRESS, abi: EARN_USDC_ABI,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });

  const { data: totalSupply2 } = useReadContract({
    address: EARN_USDC_ADDRESS, abi: EARN_USDC_ABI,
    functionName: "totalSupply",
  });

  const { data: morphoShares2 } = useReadContract({
    address: MORPHO_VAULT_ADDRESS, abi: MORPHO_VAULT_ABI,
    functionName: "balanceOf", args: [EARN_USDC_ADDRESS],
  });

  const { data: morphoTotal2 } = useReadContract({
    address: MORPHO_VAULT_ADDRESS, abi: MORPHO_VAULT_ABI,
    functionName: "convertToAssets",
    args: morphoShares2 ? [morphoShares2] : undefined,
    query: { enabled: morphoShares2 !== undefined && morphoShares2 > 0n },
  });

  const totalAssets =
    morphoTotal2 !== undefined && totalSupply2 !== undefined && totalSupply2 > 0n && userShares2 !== undefined
      ? (morphoTotal2 * userShares2) / totalSupply2
      : 0n;

  const { apy: dashboardApy } = useMorphoApy();

  // ── Remaining active vaults (EarnETH, EarnBTC, LP×2) for all-vault portfolio totals ──
  // WETH / cbBTC positions are valued in USD via Chainlink (8-decimal answer).
  const { data: ethFeed } = useReadContract({ address: ETH_USD_FEED, abi: CHAINLINK_ABI, functionName: "latestRoundData" });
  const { data: btcFeed } = useReadContract({ address: BTC_USD_FEED, abi: CHAINLINK_ABI, functionName: "latestRoundData" });
  const ethPrice = ethFeed !== undefined ? Number(ethFeed[1]) / 1e8 : undefined;
  const btcPrice = btcFeed !== undefined ? Number(btcFeed[1]) / 1e8 : undefined;

  const wethPos = useMorphoVaultPos(EARN_ETH_ADDRESS, MORPHO_WETH_VAULT_ADDRESS, address);
  const { apy: wethApy } = useMorphoApy(MORPHO_WETH_VAULT_ADDRESS);
  const earnBtcPos = useMorphoVaultPos(EARN_BTC_ADDRESS, MORPHO_CBBTC_VAULT_ADDRESS, address);
  const { apy: earnBtcApy } = useMorphoApy(MORPHO_CBBTC_VAULT_ADDRESS);

  const lpAeroVault = VAULTS.find((v) => v.id === "lp-aero-usdc")!;
  const lpWethVault = VAULTS.find((v) => v.id === "lp-weth-cbbtc")!;
  const lpAeroPos = useLpVaultPos(lpAeroVault, address); // deposit token USDC (6dp)
  const lpWethPos = useLpVaultPos(lpWethVault, address); // deposit token WETH (18dp)

  const { data: walletBalance } = useReadContract({
    address: USDC_ADDRESS, abi: ERC20_ABI,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });

  // ── Portfolio totals across ALL active vaults, valued in USD ──
  // LP vaults auto-compound yield into the position, so they have no separately-tracked accrued yield.
  const positions: { posUsd: number; apy: number | null }[] = [
    { posUsd: Number(totalAssets) / 1e6, apy: dashboardApy },
    { posUsd: ethPrice !== undefined ? (Number(wethPos.currentAssets) / 1e18) * ethPrice : 0, apy: wethApy ?? VAULTS.find((v) => v.id === "weth")!.netApy },
    { posUsd: btcPrice !== undefined ? (Number(earnBtcPos.currentAssets) / 1e8) * btcPrice : 0, apy: earnBtcApy ?? VAULTS.find((v) => v.id === "earnbtc")!.netApy },
    { posUsd: Number(lpAeroPos.userValue) / 1e6, apy: lpAeroPos.apy ?? lpAeroVault.netApy },
    { posUsd: ethPrice !== undefined ? (Number(lpWethPos.userValue) / 1e18) * ethPrice : 0, apy: lpWethPos.apy },
  ];
  const totalPositionUsd = positions.reduce((s, p) => s + p.posUsd, 0);
  // APY blended by the user's USD position in each vault (vaults with no position don't affect it).
  const apyWeightBase = positions.reduce((s, p) => (p.apy !== null && p.posUsd > 0 ? s + p.posUsd : s), 0);
  const blendedApy = apyWeightBase > 0 ? positions.reduce((s, p) => (p.apy !== null && p.posUsd > 0 ? s + p.apy * p.posUsd : s), 0) / apyWeightBase : null;
  const estYearly = positions.reduce((s, p) => (p.apy !== null ? s + p.posUsd * (p.apy / 100) : s), 0);

  // ── Historical chart ──
  type ChartRange = "1D" | "1W" | "1M" | "1Y" | "All";
  const RANGE_CONFIG: Record<ChartRange, { points: number; blocksPerPoint: bigint; labelFn: (d: Date) => string }> = {
    "1D":  { points: 24, blocksPerPoint: 1800n,   labelFn: (d) => d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) },
    "1W":  { points: 14, blocksPerPoint: 21600n,  labelFn: (d) => d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) },
    "1M":  { points: 30, blocksPerPoint: 43200n,  labelFn: (d) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) },
    "1Y":  { points: 52, blocksPerPoint: 302400n, labelFn: (d) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) },
    "All": { points: 52, blocksPerPoint: 302400n, labelFn: (d) => d.toLocaleDateString("en-US", { month: "short", year: "2-digit" }) },
  };
  const publicClient = usePublicClient();
  const { data: currentBlock } = useBlockNumber({ watch: false });
  const [chartData, setChartData] = useState<{ date: string; value: number }[]>([]);
  const [chartLoading, setChartLoading] = useState(false);
  const [chartRange, setChartRange] = useState<ChartRange>("1M");

  const [apyChartData, setApyChartData] = useState<{ date: string; value: number }[]>([]);
  const [apyChartLoading, setApyChartLoading] = useState(false);
  const [apyChartRange, setApyChartRange] = useState<ChartRange>("1M");

  useEffect(() => {
    if (!currentBlock || !publicClient || !address) return;
    const { points, blocksPerPoint, labelFn } = RANGE_CONFIG[chartRange];
    const BATCH = 3; // ~18 reads/block now (all vaults) → smaller batches to stay under RPC limits

    async function fetchHistory() {
      setChartLoading(true);
      setChartData([]);
      try {
        const blockNumbers = Array.from({ length: points }, (_, i) => {
          const stepsAgo = BigInt(points - 1 - i);
          const b = currentBlock! - stepsAgo * blocksPerPoint;
          return b > 0n ? b : 1n;
        });

        // LP vault addresses + their deposit (quote) tokens, for valuing the historical LP positions.
        const lpAeroV = VAULTS.find((v) => v.id === "lp-aero-usdc")!;
        const lpWethV = VAULTS.find((v) => v.id === "lp-weth-cbbtc")!;
        const lpAeroAddr = lpAeroV.contractAddress as `0x${string}`;
        const lpAeroQuote = lpAeroV.lp!.depositToken as `0x${string}`;
        const lpWethAddr = lpWethV.contractAddress as `0x${string}`;
        const lpWethQuote = lpWethV.lp!.depositToken as `0x${string}`;

        // Total USD position across ALL active vaults at one block. Every vault read is isolated, so a
        // revert (e.g. a vault that did not exist yet at an old block) contributes 0 rather than nulling
        // the whole point. WETH/cbBTC legs are valued with the Chainlink price AT that block.
        const positionAtBlock = async (blockNumber: bigint): Promise<number> => {
          const pc = publicClient!;
          const usr = address!;
          const safe = async <T,>(fn: () => Promise<T>, fb: T): Promise<T> => { try { return await fn(); } catch { return fb; } };
          // ERC-4626 Earn vault: user assets = totalAssets * balanceOf / totalSupply (native units).
          const earnPos = (addr: `0x${string}`) => safe(async () => {
            const [ta, bal, sup] = await Promise.all([
              pc.readContract({ address: addr, abi: EARN_USDC_ABI, functionName: "totalAssets", blockNumber }) as Promise<bigint>,
              pc.readContract({ address: addr, abi: EARN_USDC_ABI, functionName: "balanceOf", args: [usr], blockNumber }) as Promise<bigint>,
              pc.readContract({ address: addr, abi: EARN_USDC_ABI, functionName: "totalSupply", blockNumber }) as Promise<bigint>,
            ]);
            return sup > 0n ? (ta * bal) / sup : 0n;
          }, 0n);
          // Aerodrome LP vault: user value via BasementAeroZap, in the deposit token's units.
          const lpPos = (addr: `0x${string}`, quote: `0x${string}`) => safe(async () => {
            const bal = await pc.readContract({ address: addr, abi: AERO_LP_ABI, functionName: "balanceOf", args: [usr], blockNumber }) as bigint;
            if (bal === 0n) return 0n;
            return await pc.readContract({ address: AERO_ZAP_ADDRESS, abi: AERO_ZAP_ABI, functionName: "valueOfSharesInToken", args: [addr, bal, quote], blockNumber }) as bigint;
          }, 0n);
          // Chainlink price (whole-token USD) at this block.
          const priceAt = (feed: `0x${string}`) => safe(async () => {
            const r = await pc.readContract({ address: feed, abi: CHAINLINK_ABI, functionName: "latestRoundData", blockNumber }) as readonly [bigint, bigint, bigint, bigint, bigint];
            return Number(r[1]) / 1e8;
          }, 0);

          const [usdc, weth, earnBtc, lpUsdc, lpWeth, ethP, btcP] = await Promise.all([
            earnPos(EARN_USDC_ADDRESS),
            earnPos(EARN_ETH_ADDRESS),
            earnPos(EARN_BTC_ADDRESS),
            lpPos(lpAeroAddr, lpAeroQuote),
            lpPos(lpWethAddr, lpWethQuote),
            priceAt(ETH_USD_FEED),
            priceAt(BTC_USD_FEED),
          ]);
          const totalUsd =
            Number(usdc) / 1e6 +
            (Number(weth) / 1e18) * ethP +
            (Number(earnBtc) / 1e8) * btcP +
            Number(lpUsdc) / 1e6 +
            (Number(lpWeth) / 1e18) * ethP;
          return Math.round(totalUsd * 100) / 100;
        };

        const positions: number[] = [];
        for (let i = 0; i < blockNumbers.length; i += BATCH) {
          const batch = blockNumbers.slice(i, i + BATCH);
          const results = await Promise.all(batch.map((blockNumber) => positionAtBlock(blockNumber)));
          positions.push(...results);
        }

        const nowMs = Date.now();
        const stepMs = Number(blocksPerPoint) * 2000;
        const data = positions.map((val, i) => {
          const stepsAgo = points - 1 - i;
          const d = new Date(nowMs - stepsAgo * stepMs);
          return { date: labelFn(d), value: val ?? 0 };
        });
        setChartData(data);
      } finally {
        setChartLoading(false);
      }
    }
    fetchHistory();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentBlock, publicClient, chartRange, address]);

  useEffect(() => {
    const { labelFn } = RANGE_CONFIG[apyChartRange];
    setApyChartLoading(true);
    setApyChartData([]);

    fetch(`/api/apy-history?range=${apyChartRange}`)
      .then((r) => r.json())
      .then((usdcResp) => {
        const usdcPts: { timestamp: number; apy: number }[] = usdcResp.data ?? [];
        const pts = usdcPts.map((p) => ({
          date: labelFn(new Date(p.timestamp * 1000)),
          value: Math.round(p.apy * 100) / 100,
        }));
        setApyChartData(pts);
      })
      .catch(() => setApyChartData([]))
      .finally(() => setApyChartLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apyChartRange, totalAssets]);

  if (!isConnected) {
    return (
      <div className="flex flex-col items-center gap-6 pt-10 text-center">
        <div className="text-5xl">🔗</div>
        <h2 className="text-2xl font-bold">Connect your wallet</h2>
        <p className="text-gray-400 max-w-sm">
          Connect your wallet to view your vault positions and portfolio history.
        </p>
        <ConnectButton label="Connect Wallet" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8 max-w-[1440px] w-full">
      <div className="flex flex-col gap-2">
        <h2 className="text-3xl" style={{ fontWeight: 300 }}>Dashboard</h2>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <div className="rounded-2xl p-5" style={{ background: "#212121" }}>
          <div className="text-xs mb-2" style={{ color: "var(--text)" }}>Position</div>
          <div className="text-2xl font-bold" style={{ color: "#34D399" }}>{fmtUsd(totalPositionUsd)}</div>
        </div>
        <div className="rounded-2xl p-5" style={{ background: "#212121" }}>
          <div className="text-xs mb-2" style={{ color: "var(--text)" }}>Wallet Balance</div>
          <div className="text-2xl font-bold">${fmt6(walletBalance ?? 0n)}</div>
        </div>
        <div className="rounded-2xl p-5" style={{ background: "#212121" }}>
          <div className="text-xs mb-2" style={{ color: "var(--text)" }}>Est. Yearly Yield</div>
          <div className="text-2xl font-bold">{fmtUsd(estYearly)}</div>
        </div>
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* TVL chart */}
        <div className="rounded-2xl p-5" style={{ background: "#212121" }}>
          <div className="flex items-center justify-between gap-2 flex-wrap mb-4">
            <div>
              <div className="text-xs font-semibold">Position</div>
              <div className="text-xl font-bold mt-0.5" style={{ color: "#34D399" }}>
                {fmtUsd(totalPositionUsd)}
              </div>
            </div>
            <div className="flex items-center gap-1">
              {chartLoading && <span className="text-xs mr-2" style={{ color: "var(--text-muted)" }}>Loading…</span>}
              {(["1D", "1W", "1M", "1Y", "All"] as ChartRange[]).map((r) => (
                <button
                  key={r}
                  onClick={() => setChartRange(r)}
                  className="px-2.5 py-1 rounded-lg text-xs font-medium transition-colors"
                  style={
                    chartRange === r
                      ? { background: "rgba(52,211,153,0.15)", color: "#34D399", border: "1px solid rgba(52,211,153,0.35)" }
                      : { background: "transparent", color: "var(--text-muted)", border: "1px solid transparent" }
                  }
                >
                  {r}
                </button>
              ))}
            </div>
          </div>
          {chartData.length === 0 && !chartLoading ? (
            <div className="flex items-center justify-center h-[200px] text-sm" style={{ color: "var(--text-muted)" }}>
              No data available
            </div>
          ) : (
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="portfolioGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#34D399" stopOpacity={0.4} />
                  <stop offset="100%" stopColor="#34D399" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
              <XAxis dataKey="date" hide={true} />
              <YAxis tick={{ fill: "var(--text-muted)", fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${v}`} />
              <Tooltip
                contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: "12px", fontSize: "12px", color: "var(--text)" }}
                labelStyle={{ color: "var(--text-muted)", marginBottom: 4 }}
                formatter={(v) => [`$${Number(v).toFixed(2)}`, "Position"]}
              />
              <Area type="monotone" dataKey="value" stroke="#34D399" strokeWidth={3} fill="url(#portfolioGradient)" dot={false} activeDot={{ r: 5, fill: "#34D399", strokeWidth: 0 }} />
            </AreaChart>
          </ResponsiveContainer>
          )}
        </div>

        {/* APY chart */}
        <div className="rounded-2xl p-5" style={{ background: "#212121" }}>
          <div className="flex items-center justify-between gap-2 flex-wrap mb-4">
            <div>
              <div className="text-xs font-semibold">APY %</div>
              <div className="text-xl font-bold mt-0.5" style={{ color: "#34D399" }}>
                {blendedApy !== null ? `${blendedApy.toFixed(2)}%` : "—"}
              </div>
            </div>
            <div className="flex items-center gap-1">
              {apyChartLoading && <span className="text-xs mr-2" style={{ color: "var(--text-muted)" }}>Loading…</span>}
              {(["1D", "1W", "1M", "1Y", "All"] as ChartRange[]).map((r) => (
                <button
                  key={r}
                  onClick={() => setApyChartRange(r)}
                  className="px-2.5 py-1 rounded-lg text-xs font-medium transition-colors"
                  style={
                    apyChartRange === r
                      ? { background: "rgba(52,211,153,0.15)", color: "#34D399", border: "1px solid rgba(52,211,153,0.35)" }
                      : { background: "transparent", color: "var(--text-muted)", border: "1px solid transparent" }
                  }
                >
                  {r}
                </button>
              ))}
            </div>
          </div>
          {apyChartData.length === 0 && !apyChartLoading ? (
            <div className="flex items-center justify-center h-[200px] text-sm" style={{ color: "var(--text-muted)" }}>
              No data available
            </div>
          ) : (
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={apyChartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="apyGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#34D399" stopOpacity={0.4} />
                  <stop offset="100%" stopColor="#34D399" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
              <XAxis dataKey="date" hide={true} />
              <YAxis tick={{ fill: "var(--text-muted)", fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v) => `${v}%`} />
              <Tooltip
                contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: "12px", fontSize: "12px", color: "var(--text)" }}
                labelStyle={{ color: "var(--text-muted)", marginBottom: 4 }}
                formatter={(v) => [`${Number(v).toFixed(2)}%`, "APY"]}
              />
              <Area type="monotone" dataKey="value" stroke="#34D399" strokeWidth={3} fill="url(#apyGradient)" dot={false} activeDot={{ r: 5, fill: "#34D399", strokeWidth: 0 }} />
            </AreaChart>
          </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Positions — desktop table */}
      <div className="hidden md:block w-full overflow-x-auto rounded-2xl">
        <table className="w-full text-left table-fixed">
          <thead>
            <tr className="text-xs uppercase tracking-wider rounded-tl-2xl rounded-tr-2xl" style={{ color: "var(--text)", background: "#212121" }}>
              <th className="py-5 pl-5 pr-2 font-medium w-56">Vault</th>
              <th className="py-5 pr-2 font-medium w-36">TVL</th>
              <th className="py-5 pr-2 font-medium w-36">Position</th>
              <th className="py-5 pr-2 font-medium w-28">APY</th>
              <th className="py-5 pr-5 font-medium text-right w-20">Action</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b transition-opacity hover:opacity-80 cursor-pointer" style={{ borderColor: "var(--border)", background: "#1B1B1B" }} onClick={() => router.push("/vault/usdc")}>
              <UsdcVaultRow address={address!} />
            </tr>
            <tr className="border-b transition-opacity hover:opacity-80 cursor-pointer" style={{ borderColor: "var(--border)", background: "#1B1B1B" }} onClick={() => router.push("/vault/weth")}>
              <WethVaultRow address={address!} />
            </tr>
            <tr className="border-b transition-opacity hover:opacity-80 cursor-pointer" style={{ borderColor: "var(--border)", background: "#1B1B1B" }} onClick={() => router.push("/vault/earnbtc")}>
              <EarnBtcVaultRow address={address!} />
            </tr>
            {VAULTS.filter((v) => v.lp).map((v) => (
              <tr key={v.id} className="border-b transition-opacity hover:opacity-80 cursor-pointer" style={{ borderColor: "var(--border)", background: "#1B1B1B" }} onClick={() => router.push(`/vault/${v.id}`)}>
                <AeroLpVaultRow vault={v} address={address!} />
              </tr>
            ))}
            {VAULTS.filter((v) => v.comingSoon).map((v) => (
              <tr key={v.id} className="border-b transition-opacity hover:opacity-80" style={{ borderColor: "var(--border)", background: "#1B1B1B" }}>
                <ComingSoonRow name={v.name} symbol={v.tokenSymbol} apy={v.netApy} />
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Positions — mobile cards */}
      <div className="md:hidden flex flex-col gap-3">
        <div onClick={() => router.push("/vault/usdc")}>
          <UsdcVaultRow address={address!} mobile />
        </div>
        <div onClick={() => router.push("/vault/weth")}>
          <WethVaultRow address={address!} mobile />
        </div>
        <div onClick={() => router.push("/vault/earnbtc")}>
          <EarnBtcVaultRow address={address!} mobile />
        </div>
        {VAULTS.filter((v) => v.lp).map((v) => (
          <div key={v.id} onClick={() => router.push(`/vault/${v.id}`)}>
            <AeroLpVaultRow vault={v} address={address!} mobile />
          </div>
        ))}
        {VAULTS.filter((v) => v.comingSoon).map((v) => (
          <div key={v.id}>
            <ComingSoonRow name={v.name} symbol={v.tokenSymbol} apy={v.netApy} mobile />
          </div>
        ))}
      </div>

    </div>
  );
}
