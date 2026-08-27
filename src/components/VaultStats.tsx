"use client";

import Image from "next/image";
import Link from "next/link";
import { VAULTS } from "@/lib/vaults";
import { fmtUsd, fmtUnits, toUnits } from "@/lib/format";
import { EARN_USDC_ADDRESS, EARN_USDC_ABI, EARN_ETH_ADDRESS, EARN_BTC_ADDRESS, MORPHO_CBBTC_VAULT_ADDRESS, MORPHO_VAULT_ADDRESS, MORPHO_WETH_VAULT_ADDRESS, MORPHO_VAULT_ABI, AERO_LP_ABI, AERO_ZAP_ADDRESS, AERO_ZAP_ABI, ETH_USD_FEED, BTC_USD_FEED, CHAINLINK_ABI } from "@/lib/contracts";
import { useReadContract } from "wagmi";
import { TrendingUp, Users, DollarSign, Percent } from "lucide-react";
import { useState, useEffect } from "react";
import { useMorphoApy } from "@/lib/useMorphoApy";
import { useAeroApr } from "@/lib/useAeroApr";

// USD price per whole token (USDC = 1; WETH/cbBTC via Chainlink). undefined while the feed loads.
function useUsdPrice(symbol: string): number | undefined {
  const feed = symbol === "WETH" ? ETH_USD_FEED : symbol === "cbBTC" ? BTC_USD_FEED : undefined;
  const { data } = useReadContract({ address: feed, abi: CHAINLINK_ABI, functionName: "latestRoundData", query: { enabled: !!feed } });
  if (!feed) return 1; // USDC / unknown → already USD
  return data !== undefined ? Number(data[1]) / 1e8 : undefined; // answer (8dp)
}

// TVL metric value: USD main line + native amount in a smaller muted line below.
// The USD line inherits the surrounding "font-semibold text-sm" wrapper; the native line is muted.
function TvlValue({ usd, native }: { usd: string; native: string }) {
  return (
    <>
      {usd}
      <div className="text-xs font-normal mt-0.5" style={{ color: "var(--text-muted)" }}>{native}</div>
    </>
  );
}

function UsdcVaultCard() {
  const vault = VAULTS.find((v) => v.id === "usdc")!;
  const { apy, loading: apyLoading } = useMorphoApy();

  const { data: morphoShares } = useReadContract({
    address: MORPHO_VAULT_ADDRESS, abi: MORPHO_VAULT_ABI,
    functionName: "balanceOf", args: [EARN_USDC_ADDRESS],
  });
  const { data: liveTvl, isLoading: tvlLoading } = useReadContract({
    address: MORPHO_VAULT_ADDRESS, abi: MORPHO_VAULT_ABI,
    functionName: "convertToAssets",
    args: morphoShares ? [morphoShares] : undefined,
    query: { enabled: !!morphoShares },
  });

  const tvlUsd = liveTvl ? Number(liveTvl) / 1e6 : null;
  const tvlNative = liveTvl !== undefined ? `${fmtUnits(liveTvl, 6, 2)} USDC` : "—";
  const estYearly = tvlUsd !== null && apy !== null ? tvlUsd * (apy / 100) : null;

  return (
    <Link href="/vault/usdc" className="block group">
      <div className="rounded-2xl p-5 transition-all duration-200 group-hover:opacity-80" style={{ background: "#1B1B1B" }}>
        {/* Header */}
        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 rounded-full overflow-hidden flex items-center justify-center shrink-0" style={{ background: vault.iconBg }}>
            <Image src={vault.iconUrl} alt={vault.tokenSymbol} width={36} height={36} className="object-contain p-1" unoptimized />
          </div>
          <div className="min-w-0">
            <div className="font-semibold truncate">{vault.name}</div>
            <div className="text-xs truncate" style={{ color: "var(--text-muted)" }}>{vault.tokenSymbol} · Base Mainnet</div>
          </div>
          <span className="ml-auto shrink-0 text-xs font-medium px-2.5 py-0.5 rounded-full" style={{ background: "rgba(52,211,153,0.15)", color: "#34D399", border: "1px solid rgba(52,211,153,0.3)" }}>
            Live
          </span>
        </div>

        {/* Metrics */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: "Net APY", value: apy !== null ? `${apy.toFixed(2)}%` : "—", green: true, loading: apyLoading },
            { label: "Total Value Locked", value: tvlUsd !== null ? <TvlValue usd={fmtUsd(tvlUsd)} native={tvlNative} /> : "—", green: false, loading: tvlLoading },
            { label: "Est. Yearly Yield", value: estYearly !== null ? fmtUsd(estYearly) : "—", green: false, loading: tvlLoading },
            { label: "Strategy", value: "Morpho Lending", green: false, loading: false },
          ].map(({ label, value, green, loading }) => (
            <div key={label} className="flex flex-col gap-1">
              <div className="text-xs" style={{ color: "var(--text-muted)" }}>{label}</div>
              {loading
                ? <div className="h-4 w-16 rounded animate-pulse" style={{ background: "rgba(255,255,255,0.08)" }} />
                : <div className="font-semibold text-sm" style={green ? { color: "#34D399" } : {}}>{value}</div>
              }
            </div>
          ))}
        </div>
      </div>
    </Link>
  );
}

function WethVaultCard() {
  const vault = VAULTS.find((v) => v.id === "weth")!;
  const { apy, loading: apyLoading } = useMorphoApy(MORPHO_WETH_VAULT_ADDRESS);

  const { data: morphoShares } = useReadContract({
    address: MORPHO_WETH_VAULT_ADDRESS, abi: MORPHO_VAULT_ABI,
    functionName: "balanceOf", args: [EARN_ETH_ADDRESS],
  });
  const { data: liveTvl, isLoading: tvlLoading } = useReadContract({
    address: MORPHO_WETH_VAULT_ADDRESS, abi: MORPHO_VAULT_ABI,
    functionName: "convertToAssets",
    args: morphoShares ? [morphoShares] : undefined,
    query: { enabled: !!morphoShares },
  });

  // Morpho's blue-api does not index this vault, so live apy may be null — fall back to the static estimate.
  const effApy = apy ?? vault.netApy;
  const ethPrice = useUsdPrice("WETH");
  const tvlNative = liveTvl !== undefined ? `${fmtUnits(liveTvl, 18, 4)} WETH` : "—";
  const tvlUsd = liveTvl !== undefined && ethPrice !== undefined ? fmtUsd((Number(liveTvl) / 1e18) * ethPrice) : null;
  const estYearly = liveTvl !== undefined
    ? `${(toUnits(liveTvl, 18) * (effApy / 100)).toFixed(4)} WETH`
    : "—";

  return (
    <Link href="/vault/weth" className="block group">
      <div className="rounded-2xl p-5 transition-all duration-200 group-hover:opacity-80" style={{ background: "#1B1B1B" }}>
        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 rounded-full overflow-hidden flex items-center justify-center shrink-0" style={{ background: vault.iconBg }}>
            <Image src={vault.iconUrl} alt={vault.tokenSymbol} width={36} height={36} className="object-contain p-1" unoptimized />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 font-semibold">
              <span className="truncate">{vault.name}</span>
              <span className="shrink-0 text-xs px-2 py-0.5 rounded-full" style={{ background: "rgba(52,211,153,0.1)", color: "#34D399" }}>New</span>
            </div>
            <div className="text-xs truncate" style={{ color: "var(--text-muted)" }}>{vault.tokenSymbol} · Base Mainnet</div>
          </div>
          <span className="ml-auto shrink-0 text-xs font-medium px-2.5 py-0.5 rounded-full" style={{ background: "rgba(52,211,153,0.15)", color: "#34D399", border: "1px solid rgba(52,211,153,0.3)" }}>
            Live
          </span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: "Net APY", value: `${effApy.toFixed(2)}%`, green: true, loading: apyLoading },
            { label: "Total Value Locked", value: tvlUsd !== null ? <TvlValue usd={tvlUsd} native={tvlNative} /> : tvlNative, green: false, loading: tvlLoading },
            { label: "Est. Yearly Yield", value: estYearly, green: false, loading: tvlLoading || apyLoading },
            { label: "Strategy", value: "Morpho Lending", green: false, loading: false },
          ].map(({ label, value, green, loading }) => (
            <div key={label} className="flex flex-col gap-1">
              <div className="text-xs" style={{ color: "var(--text-muted)" }}>{label}</div>
              {loading
                ? <div className="h-4 w-16 rounded animate-pulse" style={{ background: "rgba(255,255,255,0.08)" }} />
                : <div className="font-semibold text-sm" style={green ? { color: "#34D399" } : {}}>{value}</div>
              }
            </div>
          ))}
        </div>
      </div>
    </Link>
  );
}

function EarnBtcVaultCard() {
  const vault = VAULTS.find((v) => v.id === "earnbtc")!;
  const { apy, loading: apyLoading } = useMorphoApy(MORPHO_CBBTC_VAULT_ADDRESS);

  const { data: morphoShares } = useReadContract({
    address: MORPHO_CBBTC_VAULT_ADDRESS, abi: MORPHO_VAULT_ABI,
    functionName: "balanceOf", args: [EARN_BTC_ADDRESS],
  });
  const { data: liveTvl, isLoading: tvlLoading } = useReadContract({
    address: MORPHO_CBBTC_VAULT_ADDRESS, abi: MORPHO_VAULT_ABI,
    functionName: "convertToAssets",
    args: morphoShares ? [morphoShares] : undefined,
    query: { enabled: !!morphoShares },
  });

  const effApy = apy ?? vault.netApy;
  const btcPrice = useUsdPrice("cbBTC");
  const tvlNative = liveTvl !== undefined ? `${fmtUnits(liveTvl, 8, 6)} cbBTC` : "—";
  const tvlUsd = liveTvl !== undefined && btcPrice !== undefined ? fmtUsd((Number(liveTvl) / 1e8) * btcPrice) : null;
  const estYearly = liveTvl !== undefined
    ? `${(toUnits(liveTvl, 8) * (effApy / 100)).toFixed(6)} cbBTC`
    : "—";

  return (
    <Link href="/vault/earnbtc" className="block group">
      <div className="rounded-2xl p-5 transition-all duration-200 group-hover:opacity-80" style={{ background: "#1B1B1B" }}>
        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 rounded-full overflow-hidden flex items-center justify-center shrink-0" style={{ background: vault.iconBg }}>
            <Image src={vault.iconUrl} alt={vault.tokenSymbol} width={36} height={36} className="object-contain p-1" unoptimized />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 font-semibold">
              <span className="truncate">{vault.name}</span>
              <span className="shrink-0 text-xs px-2 py-0.5 rounded-full" style={{ background: "rgba(52,211,153,0.1)", color: "#34D399" }}>New</span>
            </div>
            <div className="text-xs truncate" style={{ color: "var(--text-muted)" }}>{vault.tokenSymbol} · Base Mainnet</div>
          </div>
          <span className="ml-auto shrink-0 text-xs font-medium px-2.5 py-0.5 rounded-full" style={{ background: "rgba(52,211,153,0.15)", color: "#34D399", border: "1px solid rgba(52,211,153,0.3)" }}>
            Live
          </span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: "Net APY", value: `${effApy.toFixed(2)}%`, green: true, loading: apyLoading },
            { label: "Total Value Locked", value: tvlUsd !== null ? <TvlValue usd={tvlUsd} native={tvlNative} /> : tvlNative, green: false, loading: tvlLoading },
            { label: "Est. Yearly Yield", value: estYearly, green: false, loading: tvlLoading || apyLoading },
            { label: "Strategy", value: "Morpho Lending (cbBTC)", green: false, loading: false },
          ].map(({ label, value, green, loading }) => (
            <div key={label} className="flex flex-col gap-1">
              <div className="text-xs" style={{ color: "var(--text-muted)" }}>{label}</div>
              {loading
                ? <div className="h-4 w-16 rounded animate-pulse" style={{ background: "rgba(255,255,255,0.08)" }} />
                : <div className="font-semibold text-sm" style={green ? { color: "#34D399" } : {}}>{value}</div>
              }
            </div>
          ))}
        </div>
      </div>
    </Link>
  );
}

function AeroLpVaultCard({ vault }: { vault: typeof VAULTS[number] }) {
  const lp = vault.lp!;
  const vaultAddr = vault.contractAddress as `0x${string}`;
  const quote = lp.depositToken as `0x${string}`;
  const dec = vault.decimals ?? 6;
  const isUsd = lp.depositSymbol === "USDC";
  const apr = useAeroApr(lp);

  const { data: totalSupply } = useReadContract({ address: vaultAddr, abi: AERO_LP_ABI, functionName: "totalSupply" });
  const { data: tvl, isLoading: tvlLoading } = useReadContract({
    address: AERO_ZAP_ADDRESS, abi: AERO_ZAP_ABI, functionName: "valueOfSharesInToken",
    args: totalSupply !== undefined ? [vaultAddr, totalSupply, quote] : undefined,
    query: { enabled: totalSupply !== undefined && totalSupply > 0n },
  });

  // Mirror the canonical row's fallback: live APY if available, else the static estimate, else "—".
  // useAeroApr can return null non-transiently (e.g. zero-stake gauge), so don't gate a forever
  // loading skeleton on it — show "—" instead.
  const apyNum = apr !== null ? apr.netApy : vault.netApy;
  const hasApy = apr !== null || vault.netApy > 0;
  const apyStr = hasApy ? `${apyNum.toFixed(2)}%` : "—";
  // TVL is in the deposit token: USDC LP is already USD; value the WETH LP via the ETH/USD feed.
  const ethPrice = useUsdPrice(lp.depositSymbol);
  const tvlNative = tvl !== undefined ? `${fmtUnits(tvl, dec, isUsd ? 2 : 4)} ${lp.depositSymbol}` : "—";
  const tvlUsd = tvl !== undefined
    ? (isUsd ? fmtUsd(Number(tvl) / 1e6) : (ethPrice !== undefined ? fmtUsd((Number(tvl) / 10 ** dec) * ethPrice) : null))
    : null;
  const estYearly = tvl !== undefined && hasApy
    ? (isUsd ? fmtUsd((Number(tvl) / 1e6) * (apyNum / 100)) : `${(toUnits(tvl, dec) * (apyNum / 100)).toFixed(4)} ${lp.depositSymbol}`)
    : "—";

  return (
    <Link href={`/vault/${vault.id}`} className="block group">
      <div className="rounded-2xl p-5 transition-all duration-200 group-hover:opacity-80" style={{ background: "#1B1B1B" }}>
        <div className="flex items-center gap-3 mb-5">
          <div className="flex items-center shrink-0">
            {lp.assets.map((t, i) => (
              <div key={t.alt} className="w-10 h-10 rounded-full overflow-hidden flex items-center justify-center shrink-0" style={{ background: t.bg, marginLeft: i === 0 ? 0 : -12, boxShadow: i === 0 ? undefined : "0 0 0 2px #1B1B1B" }}>
                <Image src={t.src} alt={t.alt} width={40} height={40} className="object-contain p-1" unoptimized />
              </div>
            ))}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 font-semibold">
              <span className="truncate">{vault.name}</span>
              <span className="shrink-0 text-xs px-2 py-0.5 rounded-full" style={{ background: "rgba(52,211,153,0.1)", color: "#34D399" }}>New</span>
            </div>
            <div className="text-xs truncate" style={{ color: "var(--text-muted)" }}>{lp.assets[0].alt}/{lp.assets[1].alt} · Base Mainnet</div>
          </div>
          <span className="ml-auto shrink-0 text-xs font-medium px-2.5 py-0.5 rounded-full" style={{ background: "rgba(52,211,153,0.15)", color: "#34D399", border: "1px solid rgba(52,211,153,0.3)" }}>
            Live
          </span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: "Net APY", value: apyStr, green: true, loading: false },
            { label: "Total Value Locked", value: tvlUsd !== null ? <TvlValue usd={tvlUsd} native={tvlNative} /> : tvlNative, green: false, loading: tvlLoading },
            { label: "Est. Yearly Yield", value: estYearly, green: false, loading: tvlLoading },
            { label: "Strategy", value: "Aerodrome LP", green: false, loading: false },
          ].map(({ label, value, green, loading }) => (
            <div key={label} className="flex flex-col gap-1">
              <div className="text-xs" style={{ color: "var(--text-muted)" }}>{label}</div>
              {loading
                ? <div className="h-4 w-16 rounded animate-pulse" style={{ background: "rgba(255,255,255,0.08)" }} />
                : <div className="font-semibold text-sm" style={green ? { color: "#34D399" } : {}}>{value}</div>
              }
            </div>
          ))}
        </div>
      </div>
    </Link>
  );
}

function ComingSoonVaultCard({ vault }: { vault: typeof VAULTS[number] }) {
  return (
    <div className="rounded-2xl p-5" style={{ background: "#1B1B1B" }}>
      <div className="opacity-50 flex items-center gap-3 mb-5">
        <div className="w-10 h-10 rounded-full overflow-hidden flex items-center justify-center shrink-0" style={{ background: vault.iconBg }}>
          <Image src={vault.iconUrl} alt={vault.tokenSymbol} width={36} height={36} className="object-contain p-1" unoptimized />
        </div>
        <div className="min-w-0">
          <div className="font-semibold truncate">{vault.name}</div>
          <div className="text-xs truncate" style={{ color: "var(--text-muted)" }}>{vault.tokenSymbol} · Base Mainnet</div>
        </div>
        <span className="ml-auto shrink-0 text-xs font-medium px-2.5 py-0.5 rounded-full" style={{ background: "rgba(255,255,255,0.08)", color: "var(--text-muted)" }}>
          Coming Soon
        </span>
      </div>
      <div className="opacity-50 grid grid-cols-2 sm:grid-cols-4 gap-4">
        {["Net APY", "Total Value Locked", "Est. Yearly Yield", "Strategy"].map((label) => (
          <div key={label} className="flex flex-col gap-1">
            <div className="text-xs" style={{ color: "var(--text-muted)" }}>{label}</div>
            <div className="font-semibold text-sm" style={{ color: "var(--text-muted)" }}>—</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// TVL readers for the protocol summary (same reads as the per-vault cards, so react-query dedupes).
function useMorphoVaultTvl(earnAddr: `0x${string}`, morphoAddr: `0x${string}`) {
  const { data: morphoShares } = useReadContract({ address: morphoAddr, abi: MORPHO_VAULT_ABI, functionName: "balanceOf", args: [earnAddr] });
  const { data: liveTvl } = useReadContract({ address: morphoAddr, abi: MORPHO_VAULT_ABI, functionName: "convertToAssets", args: morphoShares ? [morphoShares] : undefined, query: { enabled: !!morphoShares } });
  return liveTvl as bigint | undefined;
}

function useLpVaultTvl(vault: typeof VAULTS[number]) {
  const lp = vault.lp!;
  const vaultAddr = vault.contractAddress as `0x${string}`;
  const { data: totalSupply } = useReadContract({ address: vaultAddr, abi: AERO_LP_ABI, functionName: "totalSupply" });
  const { data: tvl } = useReadContract({ address: AERO_ZAP_ADDRESS, abi: AERO_ZAP_ABI, functionName: "valueOfSharesInToken", args: totalSupply !== undefined ? [vaultAddr, totalSupply, lp.depositToken as `0x${string}`] : undefined, query: { enabled: totalSupply !== undefined && totalSupply > 0n } });
  return tvl as bigint | undefined;
}

function LiveTvlSummary() {
  // Per-vault APYs (live, with static fallbacks).
  const { apy: usdcApy } = useMorphoApy();
  const { apy: wethApy } = useMorphoApy(MORPHO_WETH_VAULT_ADDRESS);
  const { apy: earnBtcApy } = useMorphoApy(MORPHO_CBBTC_VAULT_ADDRESS);

  // Prices to value the WETH / cbBTC vault TVLs in USD (Chainlink, 8-decimal answer).
  const { data: ethFeed } = useReadContract({ address: ETH_USD_FEED, abi: CHAINLINK_ABI, functionName: "latestRoundData" });
  const { data: btcFeed } = useReadContract({ address: BTC_USD_FEED, abi: CHAINLINK_ABI, functionName: "latestRoundData" });
  const ethPrice = ethFeed !== undefined ? Number(ethFeed[1]) / 1e8 : undefined;
  const btcPrice = btcFeed !== undefined ? Number(btcFeed[1]) / 1e8 : undefined;

  // Per-vault protocol-wide TVL.
  const usdcTvl = useMorphoVaultTvl(EARN_USDC_ADDRESS, MORPHO_VAULT_ADDRESS);
  const wethTvl = useMorphoVaultTvl(EARN_ETH_ADDRESS, MORPHO_WETH_VAULT_ADDRESS);
  const earnBtcTvl = useMorphoVaultTvl(EARN_BTC_ADDRESS, MORPHO_CBBTC_VAULT_ADDRESS);

  const lpAeroVault = VAULTS.find((v) => v.id === "lp-aero-usdc")!;
  const lpWethVault = VAULTS.find((v) => v.id === "lp-weth-cbbtc")!;
  const lpAeroApr = useAeroApr(lpAeroVault.lp!);
  const lpWethApr = useAeroApr(lpWethVault.lp!);
  const lpAeroTvl = useLpVaultTvl(lpAeroVault);
  const lpWethTvl = useLpVaultTvl(lpWethVault);

  // Aggregate TVL + est. yearly yield across ALL active vaults, valued in USD.
  const wethFallback = VAULTS.find((v) => v.id === "weth")!.netApy;
  const earnBtcFallback = VAULTS.find((v) => v.id === "earnbtc")!.netApy;
  const agg: { tvlUsd: number; apy: number | null }[] = [
    { tvlUsd: usdcTvl !== undefined ? Number(usdcTvl) / 1e6 : 0, apy: usdcApy },
    { tvlUsd: wethTvl !== undefined && ethPrice !== undefined ? (Number(wethTvl) / 1e18) * ethPrice : 0, apy: wethApy ?? wethFallback },
    { tvlUsd: earnBtcTvl !== undefined && btcPrice !== undefined ? (Number(earnBtcTvl) / 1e8) * btcPrice : 0, apy: earnBtcApy ?? earnBtcFallback },
    { tvlUsd: lpAeroTvl !== undefined ? Number(lpAeroTvl) / 1e6 : 0, apy: lpAeroApr !== null ? lpAeroApr.netApy : (lpAeroVault.netApy > 0 ? lpAeroVault.netApy : null) },
    { tvlUsd: lpWethTvl !== undefined && ethPrice !== undefined ? (Number(lpWethTvl) / 1e18) * ethPrice : 0, apy: lpWethApr !== null ? lpWethApr.netApy : (lpWethVault.netApy > 0 ? lpWethVault.netApy : null) },
  ];
  const totalTvlUsd = agg.reduce((s, v) => s + v.tvlUsd, 0);
  const estYearly = agg.reduce((s, v) => (v.apy !== null ? s + v.tvlUsd * (v.apy / 100) : s), 0);

  const [depositorCount, setDepositorCount] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/depositors")
      .then((r) => r.json())
      .then((d) => { if (!cancelled) setDepositorCount(d.count ?? 0); })
      .catch(() => { if (!cancelled) setDepositorCount(0); });
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
      {[
        { label: "Total Value Locked", value: fmtUsd(totalTvlUsd), icon: DollarSign },
        { label: "Est. Yearly Yield", value: fmtUsd(estYearly), icon: TrendingUp },
        { label: "Active Vaults", value: String(VAULTS.filter((v) => !v.comingSoon).length), icon: Percent },
        { label: "Total Depositors", value: depositorCount !== null ? String(depositorCount) : "—", icon: Users },
      ].map(({ label, value, icon: Icon }) => (
        <div key={label} className="min-w-0 rounded-2xl p-5" style={{ background: "#212121" }}>
          <div className="text-xs mb-2" style={{ color: "var(--text)" }}>{label}</div>
          <div className="text-2xl font-bold truncate" style={{ color: "#34D399" }}>{value}</div>
        </div>
      ))}
    </div>
  );
}

export default function VaultStats() {
  return (
    <div className="flex flex-col gap-8 max-w-[1440px] w-full">
      <div className="flex flex-col gap-2">
        <h2 className="text-3xl" style={{ fontWeight: 300 }}>Protocol Stats</h2>
      </div>

      <LiveTvlSummary />

      <div className="flex flex-col gap-4">
        <UsdcVaultCard />
        <WethVaultCard />
        <EarnBtcVaultCard />
        {VAULTS.filter((v) => v.lp).map((v) => (
          <AeroLpVaultCard key={v.id} vault={v} />
        ))}
        {VAULTS.filter((v) => v.comingSoon).map((v) => (
          <ComingSoonVaultCard key={v.id} vault={v} />
        ))}
      </div>
    </div>
  );
}
