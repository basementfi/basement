"use client";

import { use, useState, useEffect, useRef } from "react";
import { useMorphoApy } from "@/lib/useMorphoApy";
import { useAeroApr } from "@/lib/useAeroApr";
import { fetchAeroApyHistory, fetchAeroTvlHistory } from "@/lib/aeroApyHistory";
import { VAULTS } from "@/lib/vaults";
import { fmtUnits, toUnits, parseAmount, fmtUsd } from "@/lib/format";
import { EARN_USDC_ADDRESS, EARN_USDC_ABI, EARN_ETH_ADDRESS, EARN_BTC_ADDRESS, MORPHO_ZAP_ADDRESS, MORPHO_ZAP_ABI, CBBTC_ADDRESS, MORPHO_CBBTC_VAULT_ADDRESS, MORPHO_VAULT_ADDRESS, MORPHO_WETH_VAULT_ADDRESS, MORPHO_VAULT_ABI, USDC_ADDRESS, WETH_ADDRESS, WETH_ABI, ERC20_ABI, AERO_LP_ABI, AERO_ZAP_ADDRESS, AERO_ZAP_ABI, AERO_STRATEGY_ABI, AERO_TOKEN_ADDRESS, ETH_USD_FEED, BTC_USD_FEED, CHAINLINK_ABI } from "@/lib/contracts";
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt, usePublicClient, useBlockNumber, useBalance } from "wagmi";
import Image from "next/image";
import Link from "next/link";
import { ExternalLink, Copy, Check, ArrowLeft, ArrowDown, ChevronDown } from "lucide-react";
import TxReview from "@/components/TxReview";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import Navbar from "@/components/Navbar";
import clsx from "clsx";
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  PieChart, Pie, Cell,
} from "recharts";
import Footer from "@/components/Footer";


// ── Governance introspection: who controls the vault, read live so the page
// cannot drift from on-chain reality. If the owner is a Safe, show M-of-N.
const GOV_ABI = [
  { name: "owner", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { name: "treasury", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
] as const;
const SAFE_INTROSPECT_ABI = [
  { name: "getThreshold", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { name: "getOwners", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "address[]" }] },
] as const;
const shortAddr = (a?: string) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "—");

/// The official Safe{Wallet} rounded mark (developer.safe.global brand asset).
function SafeIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 35 35" fill="none" aria-hidden="true" className="shrink-0">
      <rect width="35" height="35" rx="17.5" fill="#12FF80"/>
      <path d="M28.1421 17.4982H25.5277C24.7469 17.4982 24.1142 18.131 24.1142 18.912V22.7074C24.1142 23.4884 23.4815 24.1212 22.7007 24.1212H12.3C11.5192 24.1212 10.8865 24.7541 10.8865 25.535V28.15C10.8865 28.931 11.5192 29.5638 12.3 29.5638H23.3027C24.0836 29.5638 24.7072 28.931 24.7072 28.15V26.052C24.7072 25.271 25.3399 24.717 26.1207 24.717H28.1415C28.9224 24.717 29.555 24.0842 29.555 23.3032V18.8956C29.555 18.1146 28.9224 17.4982 28.1415 17.4982H28.1421Z" fill="#121312"/>
      <path d="M10.8859 12.3032C10.8859 11.5222 11.5186 10.8894 12.2994 10.8894H22.6938C23.4746 10.8894 24.1073 10.2565 24.1073 9.47556V6.86063C24.1073 6.07964 23.4746 5.44681 22.6938 5.44681H11.6969C10.9161 5.44681 10.2834 6.07964 10.2834 6.86063V8.87554C10.2834 9.65652 9.6507 10.2894 8.86988 10.2894H6.85808C6.07727 10.2894 5.44458 10.9222 5.44458 11.7032V16.1155C5.44458 16.8965 6.07991 17.4976 6.86073 17.4976H9.47507C10.2559 17.4976 10.8886 16.8648 10.8886 16.0838L10.8859 12.3037V12.3032Z" fill="#121312"/>
      <path d="M16.2696 14.7493H18.7808C19.5992 14.7493 20.2631 15.4139 20.2631 16.2319V18.7437C20.2631 19.5622 19.5986 20.2263 18.7808 20.2263H16.2696C15.4513 20.2263 14.7874 19.5617 14.7874 18.7437V16.2319C14.7874 15.4134 15.4518 14.7493 16.2696 14.7493Z" fill="#121312"/>
    </svg>
  );
}

export default function VaultPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { isConnected, address } = useAccount();
  const [actionTab, setActionTab] = useState<"deposit" | "withdraw" | "harvest">("deposit");
  const [copied, setCopied] = useState(false);
  // Copy feedback for the governance rows, keyed by address so each icon flips alone.
  const [copiedGov, setCopiedGov] = useState<string | null>(null);

  // navigator.clipboard only exists in secure contexts (https / localhost);
  // fall back to the hidden-textarea trick so copying also works on the
  // plain-http dev server.
  const copyText = (text: string) => {
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text);
      return;
    }
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
  };

  const copyGov = (a: string) => {
    copyText(a);
    setCopiedGov(a);
    setTimeout(() => setCopiedGov(null), 1500);
  };

  // Deep-link: /vault/<id>#withdraw (from the dashboard action buttons) opens the Withdraw tab.
  useEffect(() => {
    if (typeof window !== "undefined" && window.location.hash === "#withdraw") {
      setActionTab("withdraw");
    }
  }, []);

  function handleCopy(text: string) {
    copyText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const vault = VAULTS.find((v) => v.id === id);
  if (!vault) return <div className="p-10 text-center">Vault not found.</div>;

  const isUsdc     = vault.id === "usdc";
  const isWeth     = vault.id === "weth";
  const isBtc      = vault.id === "earnbtc";        // EarnBTC: cbBTC Morpho wrapper, multi-token deposit via EarnZap
  const lpCfg      = vault.lp;
  const isAeroLp   = !!lpCfg;                       // any Aerodrome LP vault (deposit via the shared zap)
  const isMorpho   = isUsdc || isWeth || isBtc;    // single Morpho-wrapper vaults (EarnUSDC / EarnETH / EarnBTC)
  const isLive     = isMorpho || isAeroLp;
  // LP-vault on-chain handles (config-driven, so the same code serves every Aerodrome LP vault)
  const lpVault        = (vault.contractAddress ?? USDC_ADDRESS) as `0x${string}`;
  const lpStrategy     = lpCfg?.strategy as `0x${string}` | undefined;
  const lpDepositToken = (lpCfg?.depositToken ?? USDC_ADDRESS) as `0x${string}`;
  const lpAllowNative  = !!lpCfg?.native;

  const dec        = vault.decimals ?? 6;          // underlying token decimals
  const isUsd      = vault.tokenSymbol === "USDC"; // display in $ vs token units

  // Resolve on-chain handles for the active Morpho-wrapper vault (EarnETH shares EarnUSDC's ABI)
  const wrapperAddress = isBtc ? EARN_BTC_ADDRESS : isWeth ? EARN_ETH_ADDRESS : EARN_USDC_ADDRESS;
  const morphoSource   = isBtc ? MORPHO_CBBTC_VAULT_ADDRESS : isWeth ? MORPHO_WETH_VAULT_ADDRESS : MORPHO_VAULT_ADDRESS;
  const underlyingAddr = isAeroLp ? lpDepositToken : isWeth ? WETH_ADDRESS : isBtc ? CBBTC_ADDRESS : USDC_ADDRESS;

  const { apy: morphoApy } = useMorphoApy(isMorpho ? morphoSource : undefined);
  const aeroApr = useAeroApr(lpCfg, isAeroLp); // live Aerodrome APR -> net compounded APY
  const liveApy = isMorpho ? morphoApy : isAeroLp ? (aeroApr ? aeroApr.netApy : null) : null;
  const displayApy = liveApy !== null ? liveApy : vault.netApy;

  // Decimal-aware display helpers
  const money = (raw: bigint | undefined) =>
    isUsd ? `$${fmtUnits(raw, dec, 2)}` : `${fmtUnits(raw, dec, 4)} ${vault.tokenSymbol}`;
  const bal = (raw: bigint | undefined) => fmtUnits(raw, dec, isUsd ? 2 : 4);

  // ── Morpho-wrapper vault (EarnUSDC / EarnETH): TVL from Morpho ──
  const { data: morphoShares } = useReadContract({
    address: morphoSource, abi: MORPHO_VAULT_ABI,
    functionName: "balanceOf", args: [wrapperAddress],
    query: { enabled: isMorpho },
  });
  const { data: usdcLiveTvl } = useReadContract({
    address: morphoSource, abi: MORPHO_VAULT_ABI,
    functionName: "convertToAssets",
    args: morphoShares ? [morphoShares] : undefined,
    query: { enabled: isMorpho && !!morphoShares },
  });

  // ── Morpho-wrapper vault: user position ──
  const { data: usdcUserShares } = useReadContract({
    address: wrapperAddress, abi: EARN_USDC_ABI,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address && isMorpho },
  });
  const { data: usdcTotalSupply } = useReadContract({
    address: wrapperAddress, abi: EARN_USDC_ABI,
    functionName: "totalSupply", query: { enabled: isMorpho },
  });

  // ── AERO LP vault: shares are LP-denominated, so USD values come from BasementAeroZap, not the vault.
  const { data: aeroUserShares } = useReadContract({
    address: lpVault, abi: AERO_LP_ABI,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address && isAeroLp },
  });
  const { data: aeroTotalSupply } = useReadContract({
    address: lpVault, abi: AERO_LP_ABI,
    functionName: "totalSupply", query: { enabled: isAeroLp },
  });
  // USD (USDC) value of all shares = TVL.
  const { data: aeroTvlValue } = useReadContract({
    address: AERO_ZAP_ADDRESS, abi: AERO_ZAP_ABI,
    functionName: "valueOfSharesInToken",
    args: aeroTotalSupply !== undefined ? [lpVault, aeroTotalSupply, lpDepositToken] : undefined,
    query: { enabled: isAeroLp && aeroTotalSupply !== undefined && aeroTotalSupply > 0n },
  });
  // USD (USDC) value of the user's shares = their position.
  const { data: aeroUserValue } = useReadContract({
    address: AERO_ZAP_ADDRESS, abi: AERO_ZAP_ABI,
    functionName: "valueOfSharesInToken",
    args: aeroUserShares !== undefined ? [lpVault, aeroUserShares, lpDepositToken] : undefined,
    query: { enabled: !!address && isAeroLp && !!aeroUserShares && aeroUserShares > 0n },
  });
  // User's LP-token position (asset units) — used to preview the amount of a raw-LP withdrawal.
  const { data: aeroUserLp } = useReadContract({
    address: lpVault, abi: AERO_LP_ABI,
    functionName: "convertToAssets",
    args: aeroUserShares !== undefined ? [aeroUserShares] : undefined,
    query: { enabled: isAeroLp && !!aeroUserShares && aeroUserShares > 0n },
  });
  // AERO LP harvest: pending rewards, the floor below which harvest no-ops, and the caller's fee bps.
  const { data: aeroPending, refetch: refetchPending } = useReadContract({
    address: lpStrategy, abi: AERO_STRATEGY_ABI,
    functionName: "rewardsAvailable", query: { enabled: isAeroLp },
  });
  const { data: aeroMinHarvest } = useReadContract({
    address: lpStrategy, abi: AERO_STRATEGY_ABI,
    functionName: "minHarvest", query: { enabled: isAeroLp },
  });
  const { data: aeroCallFee } = useReadContract({
    address: lpStrategy, abi: AERO_STRATEGY_ABI,
    functionName: "callFee", query: { enabled: isAeroLp },
  });
  const callerReward = aeroPending !== undefined && aeroCallFee !== undefined ? (aeroPending * aeroCallFee) / 10_000n : 0n;
  const canHarvest = aeroPending !== undefined && aeroMinHarvest !== undefined && aeroPending >= aeroMinHarvest && aeroPending > 0n;

  // AERO LP deposit cap (stored in SHARE units) → USD for display & guarding.
  const { data: aeroDepositCap } = useReadContract({
    address: lpVault, abi: AERO_LP_ABI, functionName: "depositCap",
    query: { enabled: isAeroLp },
  });
  const { data: aeroCapUsd } = useReadContract({
    address: AERO_ZAP_ADDRESS, abi: AERO_ZAP_ABI, functionName: "valueOfSharesInToken",
    args: aeroDepositCap !== undefined ? [lpVault, aeroDepositCap, lpDepositToken] : undefined,
    query: { enabled: isAeroLp && aeroDepositCap !== undefined && aeroDepositCap > 0n },
  });
  // ── Deposit cap for the Morpho-wrapper (EarnUSDC/ETH/BTC). depositCap/maxDeposit/convertToAssets
  //    share selectors across these vaults. Shares are asset-denominated → convertToAssets gives the
  //    cap in assets. ──
  const capVaultAddr = wrapperAddress;
  const { data: morphoCapShares } = useReadContract({
    address: capVaultAddr, abi: EARN_USDC_ABI, functionName: "depositCap",
    query: { enabled: isMorpho },
  });
  const morphoCapped = isMorpho && morphoCapShares !== undefined && morphoCapShares > 0n;
  const { data: morphoCapAssets } = useReadContract({
    address: capVaultAddr, abi: EARN_USDC_ABI, functionName: "convertToAssets",
    args: morphoCapShares !== undefined ? [morphoCapShares] : undefined,
    query: { enabled: morphoCapped },
  });
  const { data: morphoMaxDeposit } = useReadContract({
    address: capVaultAddr, abi: EARN_USDC_ABI, functionName: "maxDeposit",
    args: ["0x0000000000000000000000000000000000000000"],
    query: { enabled: morphoCapped },
  });

  // ── Deposit-cap USD price for the display asset (USDC = 1; WETH/cbBTC via Chainlink) ──
  const capPriceFeed = (isWeth || (isAeroLp && lpCfg?.depositSymbol === "WETH")) ? ETH_USD_FEED
    : isBtc ? BTC_USD_FEED : undefined;
  const { data: capPriceRaw } = useReadContract({
    address: capPriceFeed, abi: CHAINLINK_ABI, functionName: "latestRoundData",
    query: { enabled: !!capPriceFeed },
  });
  const capUsdPrice = capPriceFeed ? (capPriceRaw !== undefined ? Number(capPriceRaw[1]) / 1e8 : undefined) : 1;

  // ── Unified deposit cap (LP values shares via BasementAeroZap; Morpho/Core shares are asset-denominated) ──
  const capActive = isAeroLp ? (aeroDepositCap !== undefined && aeroDepositCap > 0n) : morphoCapped;
  const capUsd = isAeroLp ? (aeroCapUsd ?? 0n) : (morphoCapAssets ?? 0n);   // cap in deposit-token / asset units
  const capUsedVal = isAeroLp ? (aeroTvlValue ?? 0n) : (usdcLiveTvl ?? 0n);
  const capRemainingUsd = capUsd > capUsedVal ? capUsd - capUsedVal : 0n;
  const capFillPct = capUsd > 0n ? Math.min(100, Math.max(0, (Number(capUsedVal) / Number(capUsd)) * 100)) : 0;
  // Always display the cap in USD (convert the asset-denominated cap via the Chainlink price).
  const capUsdDollars = capUsdPrice !== undefined ? (Number(capUsd) / 10 ** dec) * capUsdPrice : undefined;
  const capUsdStr = capUsdDollars !== undefined ? `$${Math.round(capUsdDollars).toLocaleString()}` : "—";

  // ── Unified derived values ──
  const liveTvl       = isMorpho ? usdcLiveTvl    : aeroTvlValue;
  const userShares    = isMorpho ? usdcUserShares  : aeroUserShares;
  const totalSupply   = isMorpho ? usdcTotalSupply : isAeroLp ? aeroTotalSupply : undefined;

  const currentAssets: bigint = isMorpho
    ? (usdcLiveTvl !== undefined && usdcTotalSupply !== undefined && usdcTotalSupply > 0n && usdcUserShares !== undefined
        ? (usdcLiveTvl * usdcUserShares) / usdcTotalSupply
        : 0n)
    : (aeroUserValue ?? 0n);

  const tvlNum    = toUnits(liveTvl, dec);
  const estYearly = toUnits(currentAssets, dec) * (displayApy / 100);
  const tvlDisplay       = isUsd ? fmtUsd(tvlNum)    : `${fmtUnits(liveTvl, dec, 4)} ${vault.tokenSymbol}`;
  const estYearlyDisplay = isUsd ? fmtUsd(estYearly) : `${estYearly.toFixed(4)} ${vault.tokenSymbol}`;

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

  // Morpho vaults read totalAssets() over time directly. LP vaults value their LP holdings per block
  // (totalAssets is in LP units, so it's converted to the deposit token via the pool reserves).
  const chartContractAddress = isMorpho ? wrapperAddress : undefined;
  const chartAbi = EARN_USDC_ABI;

  useEffect(() => {
    if (!currentBlock || !publicClient || (!chartContractAddress && !(isAeroLp && lpCfg?.pool))) return;
    const { points, blocksPerPoint, labelFn } = RANGE_CONFIG[chartRange];
    const BATCH = 5;

    async function fetchHistory() {
      setChartLoading(true);
      setChartData([]);
      try {
        const blockNumbers = Array.from({ length: points }, (_, i) => {
          const stepsAgo = BigInt(points - 1 - i);
          const b = currentBlock! - stepsAgo * blocksPerPoint;
          return b > 0n ? b : 1n;
        });

        let tvls: (bigint | null)[];
        if (isAeroLp) {
          // LP vaults: value the vault's LP holdings in the deposit token at each historical block.
          tvls = await fetchAeroTvlHistory(publicClient!, lpVault, lpCfg!.pool, blockNumbers);
        } else {
          tvls = [];
          for (let i = 0; i < blockNumbers.length; i += BATCH) {
            const batch = blockNumbers.slice(i, i + BATCH);
            const results = await Promise.all(
              batch.map((blockNumber) =>
                publicClient!.readContract({
                  address: chartContractAddress as `0x${string}`,
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  abi: chartAbi as any,
                  functionName: "totalAssets",
                  blockNumber,
                }).catch(() => null)
              )
            );
            tvls.push(...(results as (bigint | null)[]));
          }
        }

        const nowMs = Date.now();
        const stepMs = Number(blocksPerPoint) * 2000;
        const data = tvls.map((raw, i) => {
          const stepsAgo = points - 1 - i;
          const d = new Date(nowMs - stepsAgo * stepMs);
          return {
            date: labelFn(d),
            value: raw !== null ? toUnits(raw, dec) : 0,
          };
        });
        setChartData(data);
      } finally {
        setChartLoading(false);
      }
    }

    fetchHistory();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentBlock, publicClient, chartRange]);

  useEffect(() => {
    if (!isLive) return;
    setApyChartData([]);
    const { labelFn } = RANGE_CONFIG[apyChartRange];
    if (isAeroLp) {
      // On-chain per-epoch (weekly) net APY from the gauge's rewardRateByEpoch — no external API.
      if (!publicClient || !lpCfg?.gauge || !lpCfg?.pool || !lpCfg?.strategy) { setApyChartLoading(false); return; }
      const epochs = apyChartRange === "All" ? 104 : apyChartRange === "1Y" ? 52 : apyChartRange === "1M" ? 8 : 6;
      setApyChartLoading(true);
      fetchAeroApyHistory(publicClient, { gauge: lpCfg.gauge, pool: lpCfg.pool, strategy: lpCfg.strategy }, epochs, Math.floor(Date.now() / 1000))
        .then((rows) => setApyChartData(rows.map((p) => ({ date: labelFn(new Date(p.ts * 1000)), value: p.apy }))))
        .catch(() => setApyChartData([]))
        .finally(() => setApyChartLoading(false));
      return;
    }
    setApyChartLoading(true);
    const endpoint = `/api/apy-history?range=${apyChartRange}&vault=${morphoSource}`;
    fetch(endpoint)
      .then((r) => r.json())
      .then((d) => {
        const pts = (d.data ?? []).map((p: { timestamp: number; apy: number }) => ({
          date: labelFn(new Date(p.timestamp * 1000)),
          value: Math.round(p.apy * 100) / 100,
        }));
        setApyChartData(pts);
      })
      .catch(() => setApyChartData([]))
      .finally(() => setApyChartLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apyChartRange, isLive]);

  // ── Toast ──
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error"; txHash?: string } | null>(null);
  function showToast(msg: string, type: "success" | "error", txHash?: string) {
    setToast({ msg, type, txHash });
    setTimeout(() => setToast(null), 5000);
  }

  // ── Deposit state ──
  const [depositAmount, setDepositAmount] = useState("");
  const [depositStep, setDepositStep] = useState<"idle" | "wrapping" | "approving" | "depositing">("idle");
  // Deposit runs from inside the review dialog; the page button only opens it.
  const [reviewing, setReviewing] = useState(false);
  const [approveTxHash, setApproveTxHash] = useState<`0x${string}` | undefined>();
  const [depositTxHash, setDepositTxHash] = useState<`0x${string}` | undefined>();
  // LP-vault deposit-asset options: native ETH, the pool token (zap), extra non-pool tokens like
  // USDC (zapInToken), or the raw LP token (direct).
  // Morpho-wrapper vaults (EarnUSDC/EarnETH/EarnBTC) accept ETH/WETH/USDC/cbBTC. The vault's OWN asset
  // (underlyingAddr) deposits directly; the others are swapped to it via MorphoZap. ETH is wrapped to
  // WETH first. Ordered asset-first per vault.
  const MORPHO_TOKENS = {
    eth:   { key: "eth",   symbol: "ETH",   token: WETH_ADDRESS, dec: 18, icon: "/tokens/eth.svg" },
    weth:  { key: "weth",  symbol: "WETH",  token: WETH_ADDRESS, dec: 18, icon: "/tokens/weth.png" },
    usdc:  { key: "usdc",  symbol: "USDC",  token: USDC_ADDRESS, dec: 6,  icon: "https://assets.coingecko.com/coins/images/6319/large/usdc.png" },
    cbbtc: { key: "cbbtc", symbol: "cbBTC", token: CBBTC_ADDRESS, dec: 8,  icon: "https://assets.coingecko.com/coins/images/40143/large/cbbtc.webp" },
  };
  const morphoDepositOptions = (!isMorpho ? []
    : isUsdc ? [MORPHO_TOKENS.usdc, MORPHO_TOKENS.eth, MORPHO_TOKENS.weth, MORPHO_TOKENS.cbbtc]
    : isWeth ? [MORPHO_TOKENS.eth, MORPHO_TOKENS.weth, MORPHO_TOKENS.usdc, MORPHO_TOKENS.cbbtc]
    : [MORPHO_TOKENS.cbbtc, MORPHO_TOKENS.eth, MORPHO_TOKENS.weth, MORPHO_TOKENS.usdc]
  ).map((o) => ({ ...o, method: (o.key === "eth" ? "morphoNative" : o.token === underlyingAddr ? "morphoDirect" : "morphoZap") as "morphoNative" | "morphoDirect" | "morphoZap" }));

  // LP-vault deposit-asset options: native ETH, the pool token (zap), extra non-pool tokens, or the raw LP token.
  const lpDepositOptions: { key: string; symbol: string; method: "native" | "zap" | "zapExternal" | "lp" | "morphoNative" | "morphoDirect" | "morphoZap"; token: string; dec: number; icon?: string; pricePool?: string }[] = isAeroLp ? [
    ...(lpAllowNative ? [{ key: "native", symbol: "ETH", method: "native" as const, token: lpDepositToken, dec }] : []),
    { key: "token", symbol: lpCfg!.depositSymbol, method: "zap" as const, token: lpCfg!.depositToken, dec },
    ...((lpCfg!.extraTokens ?? []).map(t => ({ key: t.symbol, symbol: t.symbol, method: "zapExternal" as const, token: t.address, dec: t.decimals, icon: t.icon, pricePool: t.pricePool }))),
    { key: "lp", symbol: "LP", method: "lp" as const, token: lpCfg!.pool, dec: 18 },
  ] : isMorpho ? morphoDepositOptions : [];
  const [depositMode, setDepositMode] = useState<string>("token");
  const selOpt = lpDepositOptions.find(o => o.key === depositMode) ?? lpDepositOptions.find(o => o.key === "token") ?? lpDepositOptions[0];
  const allowNative = isMorpho || (isAeroLp && lpAllowNative);
  const depositingLp = isAeroLp && selOpt?.method === "lp";
  const depositingExternal = isAeroLp && selOpt?.method === "zapExternal";
  const isNativeDeposit = isAeroLp ? selOpt?.method === "native" : isMorpho ? selOpt?.method === "morphoNative" : false;
  const depositTokenSymbol = (isAeroLp || isMorpho) ? (selOpt?.symbol ?? vault.tokenSymbol) : (isNativeDeposit ? "ETH" : vault.tokenSymbol);
  // The asset actually deposited (ETH → WETH). morphoZap = it differs from the vault's asset (needs a swap).
  const morphoEffectiveToken = (isNativeDeposit ? WETH_ADDRESS : selOpt?.token) as `0x${string}` | undefined;
  const depositingMorphoZap = isMorpho && !!morphoEffectiveToken && morphoEffectiveToken !== underlyingAddr;

  // Icon for an LP deposit option (native ETH, the raw LP token, an extra zap token, or the pool token).
  // The raw-LP option uses the FIRST pair token here and is paired with the second via icon2 below,
  // so the LP row reads as a pair and is visually distinct from the single pool-token row.
  const lpOptIcon = (opt: (typeof lpDepositOptions)[number]) =>
    opt.method === "native" ? "/tokens/eth.svg"
      : opt.method === "lp" ? lpCfg!.assets[0].src
      : opt.icon ?? (lpCfg!.assets.find((a) => a.alt === opt.symbol)?.src ?? vault.iconUrl);
  // One-line descriptor shown under each asset in the picker.
  const lpOptDesc = (opt: (typeof lpDepositOptions)[number]) =>
    opt.method === "native" ? "Native ETH — auto-wrapped to WETH"
      : opt.method === "lp" ? "LP token — deposited directly, no swap"
      : "Auto-zapped into the LP";
  // Icon(s) of the currently selected deposit asset (chip). A raw-LP deposit shows both pair tokens
  // overlapped (icon + icon2); every other asset is a single icon (icon2 undefined).
  const depositTokenIcon = isAeroLp
    ? (depositingLp ? lpCfg!.assets[0].src : isNativeDeposit ? "/tokens/eth.svg" : selOpt?.icon ?? (lpCfg!.assets.find((a) => a.alt === lpCfg!.depositSymbol)?.src ?? vault.iconUrl))
    : isMorpho ? (selOpt?.icon ?? vault.iconUrl)
    : (isNativeDeposit ? "/tokens/eth.svg" : vault.iconUrl);
  const depositTokenIcon2 = isAeroLp && depositingLp ? lpCfg!.assets[1].src : undefined;

  // Unified list of assets the user can pick from in the deposit token-selector dropdown.
  // LP vaults expose every zap/native/LP option; EarnETH exposes ETH vs WETH; single-asset vaults stay static.
  const depositChoices: { key: string; symbol: string; label: string; icon: string; icon2?: string; desc: string; active: boolean; select: () => void }[] =
    isAeroLp
      ? lpDepositOptions.map((opt) => ({
          key: opt.key,
          symbol: opt.symbol,
          // Dropdown label: the raw-LP row names the pair ("LP USDC/AERO"); other rows just use the symbol.
          label: opt.method === "lp" ? `LP ${lpCfg!.assets[0].alt}/${lpCfg!.assets[1].alt}` : opt.symbol,
          icon: lpOptIcon(opt),
          icon2: opt.method === "lp" ? lpCfg!.assets[1].src : undefined,
          desc: lpOptDesc(opt),
          active: depositMode === opt.key,
          select: () => { setDepositMode(opt.key); setDepositAmount(""); },
        }))
      : isMorpho
        ? lpDepositOptions.map((opt) => ({
            key: opt.key,
            symbol: opt.symbol,
            label: opt.symbol,
            icon: opt.icon ?? vault.iconUrl,
            desc: opt.method === "morphoDirect" ? "Deposited directly"
              : opt.method === "morphoNative" ? (isWeth ? "Native ETH — wrapped to WETH" : `Native ETH — swapped to ${vault.tokenSymbol}`)
              : `Swapped to ${vault.tokenSymbol}`,
            active: depositMode === opt.key,
            select: () => { setDepositMode(opt.key); setDepositAmount(""); },
          }))
        : [];

  // Deposit-asset picker (click the token chip to choose what to deposit).
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  const canPickAsset = depositChoices.length > 1;
  // Close the picker on outside click or Escape.
  useEffect(() => {
    if (!pickerOpen) return;
    const onDown = (e: PointerEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setPickerOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setPickerOpen(false); };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onDown); document.removeEventListener("keydown", onKey); };
  }, [pickerOpen]);
  // Close the picker when switching away from the deposit tab.
  useEffect(() => { setPickerOpen(false); }, [actionTab]);
  // Reset the deposit-asset selection when navigating between vaults (the [id] route reuses this
  // component), so a stale pick (e.g. ETH/USDC on WETH/cbBTC) doesn't carry into a vault without it.
  useEffect(() => { setDepositMode(isBtc ? "cbbtc" : isUsdc ? "usdc" : isWeth ? "eth" : "token"); setDepositAmount(""); setPickerOpen(false); }, [id, isBtc, isUsdc, isWeth]);

  // ── Withdraw-asset picker (LP vaults only): receive the deposit token via the zap, or the raw LP
  //    token via a direct ERC-4626 redeem (no swap, no zap approval). Mirrors the deposit picker. ──
  const [withdrawMode, setWithdrawMode] = useState<"token" | "lp">("token");
  const withdrawingLp = isAeroLp && withdrawMode === "lp";
  const lpDepositTokenIcon = isAeroLp ? (lpCfg!.assets.find((a) => a.alt === lpCfg!.depositSymbol)?.src ?? vault.iconUrl) : vault.iconUrl;
  const withdrawChoices: { key: "token" | "lp"; symbol: string; label: string; icon: string; icon2?: string; desc: string }[] = isAeroLp
    ? [
        { key: "token", symbol: lpCfg!.depositSymbol, label: lpCfg!.depositSymbol, icon: lpDepositTokenIcon, desc: `Swapped out of the LP into ${lpCfg!.depositSymbol}` },
        { key: "lp", symbol: "LP", label: `LP ${lpCfg!.assets[0].alt}/${lpCfg!.assets[1].alt}`, icon: lpCfg!.assets[0].src, icon2: lpCfg!.assets[1].src, desc: "LP token — withdrawn directly, no swap" },
      ]
    : [];
  const selWithdraw = withdrawChoices.find((c) => c.key === withdrawMode) ?? withdrawChoices[0];
  const canPickWithdraw = withdrawChoices.length > 1;
  const [withdrawPickerOpen, setWithdrawPickerOpen] = useState(false);
  const withdrawPickerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!withdrawPickerOpen) return;
    const onDown = (e: PointerEvent) => {
      if (withdrawPickerRef.current && !withdrawPickerRef.current.contains(e.target as Node)) setWithdrawPickerOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setWithdrawPickerOpen(false); };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onDown); document.removeEventListener("keydown", onKey); };
  }, [withdrawPickerOpen]);
  useEffect(() => { setWithdrawPickerOpen(false); }, [actionTab]);
  useEffect(() => { setWithdrawMode("token"); setWithdrawPickerOpen(false); }, [id]);

  const activeVaultAddress = isAeroLp ? lpVault : wrapperAddress;
  const activeVaultAbi     = isAeroLp ? AERO_LP_ABI : EARN_USDC_ABI;
  // The asset the user provides, its decimals, and who pulls it:
  //   • LP-direct  -> the LP token, approved to the VAULT (then vault.deposit)
  //   • token/zap  -> the deposit token (USDC/WETH/ETH), approved to the ZAP
  const depositTokenAddr = (isAeroLp ? (selOpt?.token ?? lpDepositToken) : isMorpho ? (selOpt?.token ?? underlyingAddr) : underlyingAddr) as `0x${string}`;
  const depositAssetDec  = isAeroLp ? (selOpt?.dec ?? dec) : isMorpho ? (selOpt?.dec ?? dec) : dec; // LP 18, USDC 6, WETH 18, cbBTC 8
  // Morpho-zap deposits (swap to the vault's asset) go through MorphoZap; the asset itself deposits straight to the vault.
  const depositSpender   = (depositingLp ? lpVault : isAeroLp ? AERO_ZAP_ADDRESS : depositingMorphoZap ? MORPHO_ZAP_ADDRESS : activeVaultAddress) as `0x${string}`;

  // For a zapInToken (non-pool) deposit (e.g. USDC), price 1 unit of the token in the hub (WETH) so
  // we can compute minShares. Stable read (1 token) — independent of the typed amount.
  const { data: extHubPrice } = useReadContract({
    address: selOpt?.pricePool as `0x${string}` | undefined,
    abi: [{ name: "getAmountOut", type: "function", stateMutability: "view", inputs: [{ name: "amountIn", type: "uint256" }, { name: "tokenIn", type: "address" }], outputs: [{ name: "", type: "uint256" }] }] as const,
    functionName: "getAmountOut",
    args: depositingExternal && selOpt ? [10n ** BigInt(selOpt.dec), selOpt.token as `0x${string}`] : undefined,
    query: { enabled: depositingExternal && !!selOpt?.pricePool },
  });

  // Vault shares per 1 whole unit of its asset (stable). The asset-out for the TYPED amount is quoted
  // fresh at submit (handleDeposit) so minShares captures real swap price-impact, not a linear estimate.
  const { data: morphoSharesPerAsset } = useReadContract({
    address: activeVaultAddress as `0x${string}`, abi: EARN_USDC_ABI, functionName: "convertToShares",
    args: [10n ** BigInt(dec)], // 1 whole unit of the vault's asset
    query: { enabled: isMorpho },
  });
  // Block a Morpho-zap deposit until the share-price read resolves, so a swap never ships with minShares=0.
  const morphoPriceReady = !depositingMorphoZap || (morphoSharesPerAsset !== undefined && morphoSharesPerAsset > 0n);

  // Balance of the deposit asset (LP, USDC, or WETH)
  const { data: usdcBalance } = useReadContract({
    address: depositTokenAddr, abi: ERC20_ABI,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address && isLive },
  });
  // Native ETH balance — for the "Use Native" option (EarnETH + WETH-deposit LP vaults)
  const { data: nativeBalance } = useBalance({
    address,
    query: { enabled: !!address && allowNative },
  });
  // Balance of whichever asset the user is depositing
  const activeBalance: bigint | undefined = isNativeDeposit ? nativeBalance?.value : usdcBalance;

  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: depositTokenAddr, abi: ERC20_ABI,
    functionName: "allowance",
    args: address ? [address, depositSpender] : undefined,
    query: { enabled: !!address && isLive },
  });
  // For the LP-direct cap check we read the vault's remaining LP room (maxDeposit).
  const { data: aeroMaxDeposit } = useReadContract({
    address: lpVault, abi: AERO_LP_ABI, functionName: "maxDeposit",
    args: [lpVault], query: { enabled: isAeroLp && capActive },
  });

  const depositAmountBigInt = parseAmount(depositAmount, depositAssetDec);
  const needsApproval = allowance !== undefined && depositAmountBigInt > 0n && allowance < depositAmountBigInt;
  // Block deposits over the cap: LP-direct compares LP room (maxDeposit); zap compares token value.
  // For the cap check, a non-pool (USDC) deposit must be valued in the hub token (WETH) like the cap.
  const depositHubValue = depositingExternal && extHubPrice && extHubPrice > 0n && selOpt
    ? depositAmountBigInt * extHubPrice / (10n ** BigInt(selOpt.dec))
    : depositAmountBigInt;
  const overCap = capActive && (
    isAeroLp
      ? (depositingLp
          ? (aeroMaxDeposit !== undefined && depositAmountBigInt > aeroMaxDeposit)
          : (aeroCapUsd !== undefined && depositHubValue > capRemainingUsd))
      // Morpho/Core: compare the deposit only when it's the native asset (same decimals); for
      // swapped/zap deposits the on-chain maxMint check enforces the cap instead.
      : (depositAssetDec === dec && morphoMaxDeposit !== undefined && depositAmountBigInt > morphoMaxDeposit)
  );

  // What the typed deposit is worth in the VAULT's asset, for the review's
  // projections. Direct deposits are already in asset units; Morpho-zap
  // deposits get quoted through the zap's own preview; Aero-zap deposits use
  // the hub-token estimate the cap check already trusts. Raw-LP deposits are
  // in LP units, which the token-denominated TVL cannot absorb — undefined
  // skips the projection rows rather than showing a wrong number.
  const { data: zapAssetOutPreview } = useReadContract({
    address: MORPHO_ZAP_ADDRESS, abi: MORPHO_ZAP_ABI, functionName: "previewAssetOut",
    args: [activeVaultAddress, depositTokenAddr, depositAmountBigInt],
    query: { enabled: depositingMorphoZap && depositAmountBigInt > 0n },
  });
  const depositAssetIn: bigint | undefined =
    depositAmountBigInt <= 0n ? undefined
    : depositingMorphoZap ? (zapAssetOutPreview as bigint | undefined)
    : depositingLp ? undefined
    : depositingExternal ? (depositHubValue > 0n ? depositHubValue : undefined)
    : depositAmountBigInt;
  // Zap paths are estimates (swap price-impact lands at submit), so they read as "~".
  const depositAssetInApprox = depositingMorphoZap || depositingExternal;

  // The review's position projection, "current → after", shown in the
  // summary box under the action's name. Only from figures that are live.
  const fmtAsset = (v: bigint) => (isUsd ? fmtUsd(toUnits(v, dec)) : `${fmtUnits(v, dec, 4)} ${vault.tokenSymbol}`);
  const clampAsset = (v: bigint) => (v < 0n ? 0n : v);
  const positionShift = (delta: bigint | undefined, sign: 1n | -1n, approx: boolean): string | undefined =>
    delta === undefined || delta === 0n || !isConnected
      ? undefined
      : `${fmtAsset(currentAssets)}${approx ? " → ~" : " → "}${fmtAsset(clampAsset(currentAssets + sign * delta))}`;

  // The signatures the review dialog will walk through, each stated as a
  // sentence with the contract it touches. The send target is depositSpender
  // on every path — zap deposits sign with the router, direct ones with the
  // vault itself.
  const depositRouterName = depositingMorphoZap ? "MorphoZap router" : (isAeroLp && !depositingLp) ? "BasementAeroZap router" : vault.name;
  const depositSignSteps = [
    ...(isNativeDeposit ? [{ id: "wrap" as const, title: `Wrap ${depositAmount || "0"} ETH to WETH`, address: WETH_ADDRESS }] : []),
    ...(needsApproval ? [{ id: "approve" as const, title: `Allow ${depositRouterName} to spend ${depositAmount || "0"} ${depositTokenSymbol}`, address: depositSpender }] : []),
    { id: "send" as const, title: `Deposit ${depositAmount || "0"} ${depositTokenSymbol} into ${vault.name}`, address: depositSpender },
  ];

  // Set the deposit input from a fraction of the balance, decimal-aware (LP token is 18-dp, so keep
  // full precision for Max to deposit the whole balance exactly).
  const pickDepositAmount = (frac: number) => {
    if (!activeBalance) return;
    // Max on an ERC-20 balance → full precision (deposit the whole balance, no dust). Native ETH keeps
    // a rounded amount so some ETH is left for gas. Percentages round for a clean input.
    if (frac >= 1 && !isNativeDeposit) {
      setDepositAmount(fmtUnits(activeBalance, depositAssetDec, depositAssetDec));
    } else if (depositingLp) {
      const raw = frac >= 1 ? activeBalance : (activeBalance * BigInt(Math.round(frac * 100))) / 100n;
      setDepositAmount(fmtUnits(raw, depositAssetDec, depositAssetDec));
    } else {
      setDepositAmount((toUnits(activeBalance, depositAssetDec) * frac).toFixed(isUsd ? 2 : 6));
    }
  };
  const depBalStr = activeBalance !== undefined ? fmtUnits(activeBalance, depositAssetDec, depositingLp ? 8 : isUsd ? 2 : 4) : "0";

  const { writeContractAsync } = useWriteContract();
  const { isLoading: isApproveLoading } = useWaitForTransactionReceipt({ hash: approveTxHash, query: { enabled: !!approveTxHash } });
  const { isLoading: isDepositLoading } = useWaitForTransactionReceipt({ hash: depositTxHash, query: { enabled: !!depositTxHash } });
  const isDepositProcessing = depositStep === "wrapping" || depositStep === "approving" || depositStep === "depositing" || isApproveLoading || isDepositLoading;

  async function handleDeposit() {
    if (!address || depositAmountBigInt <= 0n) return;
    try {
      // Native ETH: wrap to WETH first (vault pulls WETH), wait for it to confirm
      if (isNativeDeposit) {
        setDepositStep("wrapping");
        const wrapHash = await writeContractAsync({
          address: WETH_ADDRESS, abi: WETH_ABI,
          functionName: "deposit",
          value: depositAmountBigInt,
        });
        await publicClient!.waitForTransactionReceipt({ hash: wrapHash });
      }
      if (needsApproval) {
        setDepositStep("approving");
        const hash = await writeContractAsync({
          address: depositTokenAddr, abi: ERC20_ABI,
          functionName: "approve",
          args: [depositSpender, depositAmountBigInt],
        });
        setApproveTxHash(hash);
        await new Promise<void>((resolve) => {
          const interval = setInterval(async () => {
            const { data } = await refetchAllowance();
            if (data !== undefined && data >= depositAmountBigInt) { clearInterval(interval); resolve(); }
          }, 2000);
        });
      }
      setDepositStep("depositing");
      let hash: `0x${string}`;
      if (depositingLp) {
        // Raw LP straight into the ERC-4626 vault — no zap, no swap, no slippage.
        hash = await writeContractAsync({
          address: lpVault, abi: AERO_LP_ABI,
          functionName: "deposit",
          args: [depositAmountBigInt, address],
        });
      } else if (depositingExternal) {
        // Non-pool token (e.g. USDC): zapInToken swaps it into the hub then into LP.
        // minShares = expected shares − 5% (extra hop); value the deposit in the hub via extHubPrice.
        const oneUnit = 10n ** BigInt(selOpt!.dec);
        const hubEq = extHubPrice && extHubPrice > 0n ? (depositAmountBigInt * extHubPrice) / oneUnit : 0n;
        const minShares = (hubEq > 0n && aeroTotalSupply && aeroTvlValue && aeroTvlValue > 0n)
          ? (hubEq * aeroTotalSupply / aeroTvlValue) * 95n / 100n
          : 0n;
        hash = await writeContractAsync({
          address: AERO_ZAP_ADDRESS, abi: AERO_ZAP_ABI,
          functionName: "zapInToken",
          args: [lpVault, selOpt!.token as `0x${string}`, depositAmountBigInt, minShares, address],
        });
      } else if (isAeroLp) {
        // Zap deposit token -> LP -> vault shares. minShares = expected shares − 3% slippage.
        const minShares = (aeroTotalSupply && aeroTvlValue && aeroTvlValue > 0n)
          ? (depositAmountBigInt * aeroTotalSupply / aeroTvlValue) * 97n / 100n
          : 0n;
        hash = await writeContractAsync({
          address: AERO_ZAP_ADDRESS, abi: AERO_ZAP_ABI,
          functionName: "zapIn",
          args: [lpVault, lpDepositToken, depositAmountBigInt, minShares, address],
        });
      } else if (depositingMorphoZap) {
        // Morpho-wrapper vault: swap the deposit token (USDC/WETH/cbBTC; ETH already wrapped to WETH) to
        // the vault's asset, then deposit — via MorphoZap. Quote the REAL amount so the estimate captures
        // swap price-impact; minShares = expected shares − 3% (covers block-to-block drift only).
        const realAssetOut = (await publicClient!.readContract({
          address: MORPHO_ZAP_ADDRESS, abi: MORPHO_ZAP_ABI, functionName: "previewAssetOut",
          args: [activeVaultAddress, depositTokenAddr, depositAmountBigInt],
        })) as bigint;
        const expShares = (realAssetOut > 0n && morphoSharesPerAsset && morphoSharesPerAsset > 0n)
          ? realAssetOut * morphoSharesPerAsset / (10n ** BigInt(dec))
          : 0n;
        if (expShares === 0n) { setDepositStep("idle"); showToast("Couldn't price this deposit — try a different amount.", "error"); return; }
        const minShares = expShares * 97n / 100n;
        hash = await writeContractAsync({
          address: MORPHO_ZAP_ADDRESS, abi: MORPHO_ZAP_ABI,
          functionName: "zapIn",
          args: [activeVaultAddress, depositTokenAddr, depositAmountBigInt, minShares, address],
        });
      } else {
        hash = await writeContractAsync({
          address: activeVaultAddress, abi: activeVaultAbi,
          functionName: "deposit",
          args: [depositAmountBigInt, address],
        });
      }
      setDepositTxHash(hash);
      showToast(`${depositAmount} ${depositTokenSymbol} deposited successfully!`, "success", hash);
      setDepositAmount("");
      setDepositStep("idle");
      setReviewing(false);
    } catch (e: unknown) {
      setDepositStep("idle");
      const msg = e instanceof Error ? e.message : "";
      showToast(msg.includes("User rejected") ? "Transaction rejected." : "Transaction failed. Please try again.", "error");
    }
  }

  // ── Withdraw state ──
  const [withdrawTxHash, setWithdrawTxHash] = useState<`0x${string}` | undefined>();
  const [withdrawing, setWithdrawing] = useState(false);
  // Withdrawals run from inside the review dialog too; the step feeds its
  // checklist (approve only exists on the LP zap-out path).
  const [withdrawReviewing, setWithdrawReviewing] = useState(false);
  const [withdrawStep, setWithdrawStep] = useState<"idle" | "approving" | "withdrawing">("idle");
  const [withdrawAmount, setWithdrawAmount] = useState("");
  // Max is tracked explicitly, not inferred from the amount string: an 18-dec balance can't round-trip
  // through a float, so trusting the displayed amount would leave share dust on a "Max" withdrawal.
  const [withdrawIsMax, setWithdrawIsMax] = useState(false);
  const { isLoading: isWithdrawPending } = useWaitForTransactionReceipt({ hash: withdrawTxHash, query: { enabled: !!withdrawTxHash } });

  // Partial withdraw: the amount is in underlying-token units (same as the position display). Shares to
  // burn are proportional; Max (or entering ≥ the full balance) burns ALL shares — no dust left behind.
  const withdrawAmountBigInt = parseAmount(withdrawAmount, dec);
  const withdrawShares: bigint =
    !userShares || userShares === 0n || currentAssets === 0n || withdrawAmountBigInt <= 0n ? 0n
    : withdrawIsMax || withdrawAmountBigInt >= currentAssets ? userShares
    : (userShares * withdrawAmountBigInt) / currentAssets;
  const isFullWithdraw = withdrawShares > 0n && withdrawShares === userShares;
  // Estimated LP tokens received on a raw-LP withdrawal (user's LP position scaled by the share fraction).
  const withdrawLpOut: bigint =
    withdrawingLp && aeroUserLp && userShares && userShares > 0n && withdrawShares > 0n
      ? ((aeroUserLp as bigint) * withdrawShares) / userShares
      : 0n;
  const withdrawLpOutStr = withdrawLpOut > 0n ? (Number(withdrawLpOut) / 1e18).toLocaleString(undefined, { maximumSignificantDigits: 6 }) : "0";
  const setWithdrawValue = (v: string) => { setWithdrawAmount(v); setWithdrawIsMax(false); };
  const pickWithdrawAmount = (frac: number) => {
    if (!currentAssets || currentAssets === 0n) return;
    setWithdrawAmount((toUnits(currentAssets, dec) * Math.min(frac, 1)).toFixed(isUsd ? 2 : 6));
    setWithdrawIsMax(frac >= 1);
  };
  // Reset the withdraw amount when navigating between vaults (the [id] route reuses this component).
  useEffect(() => { setWithdrawAmount(""); setWithdrawIsMax(false); }, [id]);

  async function handleWithdraw() {
    if (!withdrawShares || withdrawShares === 0n || !address) return;
    setWithdrawing(true);
    try {
      let hash: `0x${string}`;
      if (isAeroLp && !withdrawingLp) {
        // Approve the zap to pull the shares being withdrawn (if not already), then zap out to the deposit token.
        const shareAllowance = (await publicClient!.readContract({
          address: lpVault, abi: AERO_LP_ABI,
          functionName: "allowance", args: [address, AERO_ZAP_ADDRESS],
        })) as bigint;
        if (shareAllowance < withdrawShares) {
          setWithdrawStep("approving");
          const approveHash = await writeContractAsync({
            address: lpVault, abi: AERO_LP_ABI,
            functionName: "approve", args: [AERO_ZAP_ADDRESS, withdrawShares],
          });
          await publicClient!.waitForTransactionReceipt({ hash: approveHash });
        }
        setWithdrawStep("withdrawing");
        // minOut = value being withdrawn − 3% slippage (full position when withdrawing all).
        const withdrawValue = isFullWithdraw ? currentAssets : withdrawAmountBigInt;
        const minOut = withdrawValue > 0n ? (withdrawValue * 97n) / 100n : 0n;
        hash = await writeContractAsync({
          address: AERO_ZAP_ADDRESS, abi: AERO_ZAP_ABI,
          functionName: "zapOut",
          args: [lpVault, withdrawShares, lpDepositToken, minOut, address],
        });
      } else {
        // Direct ERC-4626 redeem: burns the caller's own shares (no approval) and sends the vault's
        // asset straight to them — the underlying vault token for Earn, the raw LP token for an LP vault.
        setWithdrawStep("withdrawing");
        hash = await writeContractAsync({
          address: activeVaultAddress, abi: activeVaultAbi,
          functionName: "redeem",
          args: [withdrawShares, address, address],
        });
      }
      setWithdrawTxHash(hash);
      showToast("Withdrawal submitted!", "success", hash);
      setWithdrawAmount("");
      setWithdrawIsMax(false);
      setWithdrawReviewing(false);
    } catch {
      showToast("Transaction rejected.", "error");
    } finally {
      setWithdrawing(false);
      setWithdrawStep("idle");
    }
  }

  const isWithdrawProcessing = withdrawing || isWithdrawPending;

  // Whether the LP zap-out will need a share approval first — read upfront so
  // the review's checklist can show the step before anything is sent.
  const { data: lpShareAllowance } = useReadContract({
    address: lpVault, abi: AERO_LP_ABI,
    functionName: "allowance",
    args: address ? [address, AERO_ZAP_ADDRESS] : undefined,
    query: { enabled: isAeroLp && !!address },
  });
  const needsShareApproval =
    isAeroLp && !withdrawingLp && lpShareAllowance !== undefined && withdrawShares > 0n && lpShareAllowance < withdrawShares;

  // ── Governance reads for the details card ──
  const { data: vaultOwner } = useReadContract({
    address: vault.contractAddress as `0x${string}`, abi: GOV_ABI, functionName: "owner",
    query: { enabled: !!vault.contractAddress },
  });
  const { data: vaultTreasury } = useReadContract({
    address: vault.contractAddress as `0x${string}`, abi: GOV_ABI, functionName: "treasury",
    query: { enabled: !!vault.contractAddress },
  });
  const { data: safeThreshold } = useReadContract({
    address: vaultOwner, abi: SAFE_INTROSPECT_ABI, functionName: "getThreshold",
    query: { enabled: !!vaultOwner },
  });
  const { data: safeOwners } = useReadContract({
    address: vaultOwner, abi: SAFE_INTROSPECT_ABI, functionName: "getOwners",
    query: { enabled: !!vaultOwner },
  });
  const ownerIsSafe = safeThreshold !== undefined && safeOwners !== undefined;

  // ── Harvest state (AERO LP only — public, anyone can compound and earn the caller fee) ──
  const [harvestTxHash, setHarvestTxHash] = useState<`0x${string}` | undefined>();
  const [harvesting, setHarvesting] = useState(false);
  const { isLoading: isHarvestPending } = useWaitForTransactionReceipt({ hash: harvestTxHash });

  async function handleHarvest() {
    if (!address || !canHarvest || !lpStrategy) return;
    setHarvesting(true);
    try {
      const hash = await writeContractAsync({
        address: lpStrategy, abi: AERO_STRATEGY_ABI,
        functionName: "harvest", args: [],
      });
      setHarvestTxHash(hash);
      showToast("Harvest submitted!", "success", hash);
      setTimeout(() => refetchPending(), 4000);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "";
      showToast(msg.includes("User rejected") ? "Transaction rejected." : "Harvest failed. Please try again.", "error");
    } finally {
      setHarvesting(false);
    }
  }

  const isHarvestProcessing = harvesting || isHarvestPending;

  // ── Contracts section data ──
  const contractRows = isAeroLp
    ? [
        { label: "BasementAeroVault (ERC-4626)", address: vault.contractAddress! },
        { label: "BasementAeroStrategy",         address: lpStrategy! },
        { label: "BasementAeroZap (router)",     address: AERO_ZAP_ADDRESS },
        { label: `Aerodrome ${lpCfg!.assets[0].alt}/${lpCfg!.assets[1].alt} Pool`, address: lpCfg!.pool },
        { label: "Aerodrome Gauge",            address: lpCfg!.gauge },
        { label: "AERO",                       address: AERO_TOKEN_ADDRESS },
        { label: `Deposit Asset (${lpCfg!.depositSymbol})`, address: lpDepositToken },
      ]
    : [
        { label: `${vault.name} Vault`,                     address: vault.contractAddress! },
        { label: "Morpho Vault (underlying)",               address: morphoSource },
        { label: `Underlying Asset (${vault.tokenSymbol})`, address: underlyingAddr },
      ];

  // ── Vault details rows ──
  const vaultDetailRows = [
    { label: "Net APY",            value: vault.comingSoon ? "—" : displayApy > 0 ? `${displayApy.toFixed(2)}%` : "Live", gradient: true },
    ...(isAeroLp && aeroApr ? [
      { label: "↳ Aerodrome emissions (APR)", value: `${aeroApr.grossApr.toFixed(2)}%`, gradient: false, muted: true },
      { label: "↳ Performance fee",           value: `−${(aeroApr.feeBps / 100).toFixed(0)}%`, gradient: false, muted: true },
      { label: "↳ Auto-compounded",           value: "daily", gradient: false, muted: true },
    ] : []),
    { label: "Total Value Locked", value: vault.comingSoon ? "—" : tvlDisplay },
    { label: "Deposit Cap",        value: vault.comingSoon ? "—"
        : capActive && capUsd > 0n ? `${capUsdStr} · ${capFillPct.toFixed(0)}% filled`
        : (isMorpho || isAeroLp) ? "No limit"
        : "—" },
    { label: "Yield Source",       value: isAeroLp ? "Aerodrome AERO emissions" : "Morpho Lending" },
    { label: "Strategy",           value: isAeroLp ? `50/50 ${lpCfg!.assets[0].alt}/${lpCfg!.assets[1].alt} LP, auto-compounded` : "Passive lending" },
    { label: "Performance Fee",    value: isAeroLp ? "10% on harvested AERO" : "10% on yield (share dilution)" },
    { label: "Owner",              value: vaultOwner ? (
        <span className="inline-flex items-center gap-1.5">
          {ownerIsSafe && <><SafeIcon /><span>SAFE {`${safeThreshold}`} of {(safeOwners as readonly string[]).length} ·</span></>}
          <a href={`https://basescan.org/address/${vaultOwner}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 transition-opacity hover:opacity-70">
            {shortAddr(vaultOwner)}
            <ExternalLink size={11} style={{ color: "var(--text-muted)" }} />
          </a>
          <button onClick={() => copyGov(vaultOwner)} className="transition-opacity hover:opacity-70" title="Copy address" style={{ color: copiedGov === vaultOwner ? "#34D399" : "var(--text-muted)" }}>
            {copiedGov === vaultOwner ? <Check size={11} /> : <Copy size={11} />}
          </button>
        </span>
      ) : "—" },
    ...(vaultTreasury ? [{ label: "Fee Treasury", value: (
        <span className="inline-flex items-center gap-1.5">
          {vaultTreasury === vaultOwner && ownerIsSafe && <><SafeIcon /><span>SAFE ·</span></>}
          <a href={`https://basescan.org/address/${vaultTreasury}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 transition-opacity hover:opacity-70">
            {shortAddr(vaultTreasury)}
            <ExternalLink size={11} style={{ color: "var(--text-muted)" }} />
          </a>
          <button onClick={() => copyGov(vaultTreasury)} className="transition-opacity hover:opacity-70" title="Copy address" style={{ color: copiedGov === vaultTreasury ? "#34D399" : "var(--text-muted)" }}>
            {copiedGov === vaultTreasury ? <Check size={11} /> : <Copy size={11} />}
          </button>
        </span>
      ) }] : []),
    ...(isMorpho ? [{ label: "Upgradeability", value: "None — Morpho venue immutable" }] : []),
    { label: "Network",            value: "Base Mainnet" },
  ];

  return (
    <div className="relative min-h-screen flex flex-col">

      {/* Navbar */}
      <div className="w-full border-b" style={{ borderColor: "var(--border)" }}>
        <Navbar />
      </div>

      <main className="flex-1 flex flex-col items-center px-4 pt-6 pb-24 gap-8">
        <div className="flex flex-col gap-8 max-w-[1440px] w-full">

        {/* Back button */}
        <button
          onClick={() => window.history.back()}
          className="flex items-center gap-1.5 text-sm transition-opacity hover:opacity-70 w-fit"
          style={{ color: "var(--text-muted)" }}
        >
          <ArrowLeft size={16} />
          Back
        </button>

        {/* Header */}
        <div className="w-full flex items-start gap-4 min-w-0">
          <div className="w-12 h-12 rounded-full flex items-center justify-center overflow-hidden shadow-lg shrink-0" style={{ background: vault.iconBg }}>
            <Image src={vault.iconUrl} alt={vault.tokenSymbol} width={48} height={48} className="w-full h-full object-contain p-1.5" unoptimized />
          </div>
          <div className="flex flex-col gap-1 min-w-0">
            {/* Row 1: vault name — height matches logo so name centers with it */}
            <div className="flex items-center h-12">
              <h1 className="text-2xl md:text-3xl truncate" style={{ fontWeight: 300 }}>{vault.name}</h1>
            </div>
            {/* Row 2: contract address */}
            {vault.contractAddress && (
              <div className="flex items-center gap-1.5 min-w-0">
                <a
                  href={`https://basescan.org/address/${vault.contractAddress}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 text-xs font-mono truncate transition-opacity hover:opacity-70"
                  style={{ color: "var(--text-muted)" }}
                  title="View on Basescan"
                >
                  {vault.contractAddress.slice(0, 6)}...{vault.contractAddress.slice(-4)}
                  <ExternalLink size={12} />
                </a>
                <button
                  onClick={() => handleCopy(vault.contractAddress!)}
                  className="transition-opacity hover:opacity-70"
                  style={{ color: copied ? "#38d9a9" : "var(--text-muted)" }}
                  title="Copy address"
                >
                  {copied ? <Check size={12} /> : <Copy size={12} />}
                </button>
              </div>
            )}
          </div>
        </div>

        {!isConnected ? (
          <div className="flex flex-col items-center gap-6 pt-10 text-center">
            <div className="text-5xl">🔗</div>
            <h2 className="text-2xl font-bold">Connect your wallet</h2>
            <p className="max-w-sm text-sm" style={{ color: "var(--text-muted)" }}>Connect your wallet to view your position in this vault.</p>
            <ConnectButton label="Connect Wallet" />
          </div>
        ) : (
          <div className="flex flex-col gap-5 w-full">

            {/* Top section: summary cards + chart (left) | action card (right) */}
            <div className="grid grid-cols-1 md:grid-cols-[1fr_500px] gap-5 items-start">
              <div className="flex flex-col gap-5 min-w-0">

              {/* Summary cards */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="rounded-2xl p-5" style={{ background: "#212121" }}>
                  <div className="text-xs mb-2" style={{ color: "var(--text)" }}>TVL</div>
                  <div className="text-2xl font-bold" style={{ color: "#34D399" }}>{isLive ? money(liveTvl) : "—"}</div>
                </div>
                <div className="rounded-2xl p-5" style={{ background: "#212121" }}>
                  <div className="text-xs mb-2" style={{ color: "var(--text)" }}>Your Position</div>
                  <div className="text-2xl font-bold">
                    {currentAssets > 0n ? money(currentAssets) : "—"}
                  </div>
                </div>
                <div className="rounded-2xl p-5" style={{ background: "#212121" }}>
                  <div className="text-xs mb-2" style={{ color: "var(--text)" }}>Est. Yearly Yield</div>
                  <div className="text-2xl font-bold">
                    {currentAssets > 0n ? estYearlyDisplay : "—"}
                  </div>
                </div>
              </div>

              {/* Charts row */}
              <div>
              {/* Chart 1 */}
              <div className="rounded-2xl p-4 sm:p-5 w-full" style={{ background: "#1B1B1B" }}>
                <div className="flex items-center justify-between gap-2 mb-4 flex-wrap">
                  <div className="min-w-0">
                    <div className="text-xs font-semibold">TVL</div>
                    <div className="text-xl font-bold mt-0.5 truncate" style={{ color: "#34D399" }}>
                      {isLive && liveTvl !== undefined ? money(liveTvl) : "—"}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 flex-wrap">
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
                    {vault.comingSoon ? "Chart available once vault launches" : "No data available"}
                  </div>
                ) : (
                <ResponsiveContainer width="100%" height={200}>
                  <AreaChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                    <defs>
                      <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#34D399" stopOpacity={0.4} />
                        <stop offset="100%" stopColor="#34D399" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
                    <XAxis dataKey="date" hide={true} />
                    <YAxis tick={{ fill: "var(--text-muted)", fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v) => isUsd ? `$${v}` : `${v}`} />
                    <Tooltip
                      contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: "12px", fontSize: "12px", color: "var(--text)" }}
                      labelStyle={{ color: "var(--text-muted)", marginBottom: 4 }}
                      formatter={(v) => [isUsd ? `$${Number(v).toFixed(2)}` : `${Number(v).toFixed(4)} ${vault.tokenSymbol}`, "TVL"]}
                    />
                    <Area type="monotone" dataKey="value" stroke="#34D399" strokeWidth={3} fill="url(#areaGrad)" dot={false} activeDot={{ r: 5, fill: "#34D399", strokeWidth: 0 }} />
                  </AreaChart>
                </ResponsiveContainer>
                )}
              </div>
              </div>

              {/* Charts row 2 */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {/* Chart 3 — APY */}
              <div className="rounded-2xl p-4 sm:p-5 w-full" style={{ background: "#1B1B1B" }}>
                <div className="flex items-center justify-between gap-2 mb-4 flex-wrap">
                  <div className="min-w-0">
                    <div className="text-xs font-semibold">APY</div>
                    <div className="text-xl font-bold mt-0.5 truncate" style={{ color: "#34D399" }}>
                      {liveApy !== null ? `${liveApy.toFixed(2)}%` : "—"}
                    </div>
                  </div>
                  {isLive && (
                    <div className="flex items-center gap-1 flex-wrap">
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
                  )}
                </div>
                {apyChartData.length === 0 && !apyChartLoading ? (
                  <div className="flex items-center justify-center h-[200px] text-sm" style={{ color: "var(--text-muted)" }}>
                    No data available
                  </div>
                ) : (
                <ResponsiveContainer width="100%" height={200}>
                  <AreaChart data={apyChartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                    <defs>
                      <linearGradient id="apyGrad" x1="0" y1="0" x2="0" y2="1">
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
                    <Area type="monotone" dataKey="value" stroke="#34D399" strokeWidth={3} fill="url(#apyGrad)" dot={false} activeDot={{ r: 5, fill: "#34D399", strokeWidth: 0 }} />
                  </AreaChart>
                </ResponsiveContainer>
                )}
              </div>
              {/* Chart 4 — Strategy donut */}
              {(() => {
                const allocationData = isAeroLp
                  ? [{ name: "AERO", value: 50, color: "#34D399" }, { name: "USDC", value: 50, color: "#c2f1e0" }]
                  : [{ name: vault.tokenSymbol, value: 100, color: "#34D399" }];
                return (
                  <div className="rounded-2xl p-5 flex flex-col" style={{ background: "#1B1B1B" }}>
                    <div className="text-xs font-semibold mb-4">Strategy</div>
                    <div className="flex-1 flex flex-col items-center justify-center gap-4">
                      <PieChart width={140} height={140}>
                        <Pie data={allocationData} cx={65} cy={65} innerRadius={44} outerRadius={65} dataKey="value" strokeWidth={3} stroke="#1B1B1B">
                          {allocationData.map((entry, i) => (
                            <Cell key={i} fill={entry.color} />
                          ))}
                        </Pie>
                      </PieChart>
                      <div className="flex flex-col gap-2 w-full">
                        {allocationData.map((entry) => (
                          <div key={entry.name} className="flex items-center justify-between text-sm">
                            <div className="flex items-center gap-2">
                              <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: entry.color }} />
                              <span style={{ color: "var(--text-muted)" }}>{entry.name}</span>
                            </div>
                            <span className="font-medium">{entry.value}%</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })()}
              </div>

              {/* Vault Details */}
              <div className="rounded-2xl overflow-hidden" style={{ background: "#1B1B1B" }}>
                <div className="px-5 py-4 text-sm font-semibold" style={{ background: "#212121" }}>
                  Vault Details
                </div>
                <div className="flex flex-col gap-0">
                  {vaultDetailRows.map(({ label, value, gradient, muted }) => (
                    <div key={label} className="flex items-center justify-between gap-3 px-4 sm:px-5 py-3.5 text-sm" style={muted ? { opacity: 0.65 } : {}}>
                      <span className="min-w-0 break-words" style={{ color: "var(--text-muted)" }}>{label}</span>
                      <span className="font-medium text-right min-w-0 break-words" style={gradient ? { color: "#34D399" } : {}}>{value}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Contracts */}
              {vault.contractAddress && (
                <div className="rounded-2xl overflow-hidden" style={{ background: "#1B1B1B" }}>
                  <div className="px-5 py-4 text-sm font-semibold" style={{ background: "#212121" }}>
                    Contracts
                  </div>
                  {contractRows.map(({ label, address: addr }) => (
                    <div key={label} className="flex items-center justify-between gap-3 px-4 sm:px-5 py-3.5 text-sm">
                      <span className="min-w-0 break-words" style={{ color: "var(--text-muted)" }}>{label}</span>
                      <span className="flex items-center gap-1.5 shrink-0">
                        <a
                          href={`https://basescan.org/address/${addr}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1.5 font-mono transition-opacity hover:opacity-70"
                          style={{ color: "#34D399" }}
                        >
                          {addr.slice(0, 6)}...{addr.slice(-4)}
                          <ExternalLink size={11} />
                        </a>
                        <button
                          onClick={() => copyGov(addr)}
                          className="transition-opacity hover:opacity-70"
                          title="Copy address"
                          style={{ color: copiedGov === addr ? "#34D399" : "var(--text-muted)" }}
                        >
                          {copiedGov === addr ? <Check size={11} /> : <Copy size={11} />}
                        </button>
                      </span>
                    </div>
                  ))}
                </div>
              )}

              </div>

              {/* Right column: action card. No overflow-hidden here so the deposit-asset dropdown can
                  extend past the card; the tab bar below clips its own rounded top corners instead. */}
              <div className="rounded-2xl flex flex-col w-full min-w-0" style={{ background: "#1B1B1B" }}>

              {/* Tabs — AERO LP vaults add Harvest between Deposit and Withdraw */}
              <div className="flex rounded-tl-2xl rounded-tr-2xl overflow-hidden" style={{ borderBottom: "1px solid var(--border)", background: "#212121" }}>
                {(isAeroLp ? (["deposit", "harvest", "withdraw"] as const) : (["deposit", "withdraw"] as const)).map((t) => (
                  <button
                    key={t}
                    onClick={() => setActionTab(t)}
                    className="flex-1 py-3.5 text-sm font-semibold capitalize transition-colors"
                    style={
                      actionTab === t
                        ? { borderBottom: "2px solid #34D399", color: "var(--text)" }
                        : { color: "var(--text-muted)" }
                    }
                  >
                    {t.charAt(0).toUpperCase() + t.slice(1)}
                  </button>
                ))}
              </div>

              <div className="p-5 flex flex-col gap-4 flex-1 relative">

                {/* ── DEPOSIT TAB ── */}
                {actionTab === "deposit" && (
                  <>
                    {/* Focus scrim: blur the deposit form behind the open asset picker (dropdown is z-30) */}
                    {pickerOpen && canPickAsset && (
                      <div className="absolute inset-0 z-20 backdrop-blur-sm rounded-b-2xl" style={{ background: "rgba(0,0,0,0.15)" }} aria-hidden="true" />
                    )}
                    <div className="flex flex-col gap-3">
                        {/* DEPOSIT + arrow + RECEIVE */}
                        <div className="flex flex-col gap-2">
                        {/* DEPOSIT box */}
                        <div className="rounded-2xl p-4" style={{ background: "var(--bg2)", border: "1px solid var(--border)" }}>
                          <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
                            <span className="text-sm font-semibold" style={{ color: "var(--text-muted)" }}>DEPOSIT</span>
                            <div className="flex items-center gap-1.5 flex-wrap">
                              {[25, 50, 75].map((pct) => (
                                <button
                                  key={pct}
                                  disabled={isDepositProcessing}
                                  onClick={() => pickDepositAmount(pct / 100)}
                                  className="px-2.5 py-1 rounded-lg text-xs font-medium transition-opacity hover:opacity-70"
                                  style={{ background: "rgba(255,255,255,0.06)", color: "var(--text-muted)" }}
                                >
                                  {pct}%
                                </button>
                              ))}
                              <button
                                disabled={isDepositProcessing}
                                onClick={() => pickDepositAmount(1)}
                                className="px-2.5 py-1 rounded-lg text-xs font-medium transition-opacity hover:opacity-70"
                                style={{ background: "rgba(255,255,255,0.06)", color: "var(--text-muted)" }}
                              >
                                Max
                              </button>
                            </div>
                          </div>
                          <div className="relative" ref={pickerRef}>
                          <div className="flex items-center gap-3">
                            <input
                              type="number"
                              min="0"
                              placeholder="0"
                              value={depositAmount}
                              disabled={isDepositProcessing}
                              onChange={(e) => {
                                const v = e.target.value;
                                const re = new RegExp(`^\\d*\\.?\\d{0,${depositAssetDec}}$`);
                                if (v === "" || (re.test(v) && Number(v) <= 1_000_000)) setDepositAmount(v);
                              }}
                              className="flex-1 w-0 text-2xl bg-transparent outline-none"
                              style={{ color: "var(--text)", fontWeight: 300 }}
                            />
                            <button
                              type="button"
                              disabled={isDepositProcessing || !canPickAsset}
                              onClick={() => setPickerOpen((o) => !o)}
                              aria-haspopup="listbox"
                              aria-expanded={pickerOpen}
                              title={canPickAsset ? "Choose which token to deposit" : undefined}
                              className={`h-9 shrink-0 flex items-center gap-2 pl-3 pr-2.5 rounded-xl transition-opacity hover:opacity-80 disabled:cursor-default disabled:hover:opacity-100 ${pickerOpen && canPickAsset ? "relative z-30" : ""}`}
                              style={{ background: "rgba(255,255,255,0.06)" }}
                            >
                              {depositTokenIcon2 ? (
                                <span className="flex items-center">
                                  <Image src={depositTokenIcon} alt="" width={20} height={20} className="rounded-full object-contain" unoptimized />
                                  <Image src={depositTokenIcon2} alt={depositTokenSymbol} width={20} height={20} className="rounded-full object-contain -ml-2" style={{ boxShadow: "0 0 0 2px #141414" }} unoptimized />
                                </span>
                              ) : (
                                <Image src={depositTokenIcon} alt={depositTokenSymbol} width={20} height={20} className="rounded-full object-contain" unoptimized />
                              )}
                              <span className="font-semibold text-sm">{depositTokenSymbol}</span>
                              {canPickAsset && (
                                <ChevronDown size={14} style={{ color: "var(--text-muted)" }} className={`transition-transform ${pickerOpen ? "rotate-180" : ""}`} />
                              )}
                            </button>
                          </div>
                          {pickerOpen && canPickAsset && (
                            <div
                              role="listbox"
                              className="absolute left-0 right-0 top-full mt-2 z-30 rounded-2xl overflow-y-auto shadow-xl max-h-[70vh]"
                              style={{ background: "#1B1B1B", border: "1px solid var(--border)" }}
                            >
                              <div className="px-4 py-3 text-sm font-semibold tracking-wide" style={{ color: "var(--text)", borderBottom: "1px solid var(--border)" }}>
                                Select deposit asset
                              </div>
                              {depositChoices.map((c) => (
                                <button
                                  key={c.key}
                                  type="button"
                                  role="option"
                                  aria-selected={c.active}
                                  onClick={() => { c.select(); setPickerOpen(false); }}
                                  className="w-full flex items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-white/[0.06]"
                                  style={c.active ? { background: "rgba(52,211,153,0.10)" } : undefined}
                                >
                                  {/* fixed-width icon slot so the name/desc column starts at the same x on every row */}
                                  <span className="w-11 flex items-center shrink-0">
                                    <Image src={c.icon} alt="" width={26} height={26} className="rounded-full object-contain" unoptimized />
                                    {c.icon2 && (
                                      <Image src={c.icon2} alt="" width={26} height={26} className="rounded-full object-contain -ml-2.5" style={{ boxShadow: "0 0 0 2px #1B1B1B" }} unoptimized />
                                    )}
                                  </span>
                                  <div className="flex flex-col min-w-0 flex-1">
                                    <span className="font-semibold text-sm leading-tight" style={{ color: "var(--text)" }}>{c.label}</span>
                                    <span className="text-[11px] leading-snug mt-0.5" style={{ color: "var(--text-muted)" }}>{c.desc}</span>
                                  </div>
                                  {c.active && <Check size={16} style={{ color: "#34D399" }} className="shrink-0 ml-2" />}
                                </button>
                              ))}
                            </div>
                          )}
                          </div>
                          <div className="flex justify-end mt-1">
                            <span className="text-xs" style={{ color: "var(--text-muted)" }}>Balance: {depBalStr}</span>
                          </div>
                        </div>

                        {/* Arrow */}
                        <div className="flex justify-center -my-5 relative z-10">
                          <button onClick={() => setActionTab("withdraw")} className="w-9 h-9 rounded-xl flex items-center justify-center transition-opacity hover:opacity-70" style={{ background: "#1B1B1B", border: "1px solid var(--border)" }}>
                            <ArrowDown size={16} style={{ color: "var(--text-muted)" }} />
                          </button>
                        </div>

                        {/* RECEIVE box */}
                        <div className="rounded-2xl p-4" style={{ background: "var(--bg2)", border: "1px solid var(--border)" }}>
                          <div className="flex items-center justify-between mb-3">
                            <span className="text-sm font-semibold" style={{ color: "var(--text-muted)" }}>RECEIVE</span>
                            <span className="text-xs" style={{ color: "var(--text-muted)" }}>Yield-bearing · ERC-4626</span>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="flex-1 min-w-0 truncate text-2xl" style={{ fontWeight: 300 }}>{depositAmount || "0"}</span>
                            <div className="h-9 flex items-center gap-2 px-3 rounded-xl shrink-0" style={{ background: "rgba(255,255,255,0.06)" }}>
                              {vault.shareIcon && <Image src={vault.shareIcon} alt={vault.shareSymbol ?? vault.name} width={20} height={20} className="rounded-full object-contain" unoptimized />}
                              <span className="font-semibold text-sm">{vault.shareSymbol ?? vault.name}</span>
                            </div>
                          </div>
                          <div className="flex justify-end mt-1">
                            <span className="text-xs" style={{ color: "var(--text-muted)" }}>Balance: {bal(currentAssets)}</span>
                          </div>
                        </div>
                        </div>

                        {/* Est. yield preview (token-denominated; skipped for raw-LP deposits) */}
                        {depositAmount && Number(depositAmount) > 0 && displayApy > 0 && !depositingLp && (
                          <div className="rounded-xl px-4 py-3 text-xs flex items-center justify-between" style={{ background: "var(--bg2)", border: "1px solid var(--border)" }}>
                            <span style={{ color: "var(--text-muted)" }}>Est. yearly yield</span>
                            <span className="font-semibold" style={{ color: "#34D399" }}>+{isUsd ? `$${(Number(depositAmount) * displayApy / 100).toFixed(2)}` : `${(Number(depositAmount) * displayApy / 100).toFixed(4)} ${vault.tokenSymbol}`}</span>
                          </div>
                        )}

                        {/* Deposit button — opens the review; nothing is sent from here. */}
                        <button
                          disabled={!depositAmount || Number(depositAmount) <= 0 || isDepositProcessing || vault.comingSoon || overCap || !morphoPriceReady}
                          onClick={() => setReviewing(true)}
                          className={clsx(
                            "w-full py-3 rounded-xl font-medium text-sm transition-opacity",
                            depositAmount && Number(depositAmount) > 0 && !isDepositProcessing && !vault.comingSoon && !overCap && morphoPriceReady
                              ? "hover:opacity-80"
                              : "cursor-not-allowed opacity-40"
                          )}
                          style={{ background: "rgba(52,211,153,0.15)", color: "#ffffff", border: "1px solid rgba(52,211,153,0.3)" }}
                        >
                          {vault.comingSoon ? "Coming Soon"
                            : overCap ? "Exceeds vault cap"
                            : `Deposit ${depositAmount || "0"} ${depositTokenSymbol}`}
                        </button>

                        <TxReview
                          open={reviewing}
                          onClose={() => setReviewing(false)}
                          mode="deposit"
                          vaultName={vault.name}
                          icon={depositTokenIcon}
                          icon2={depositTokenIcon2}
                          amount={depositAmount}
                          tokenSymbol={depositTokenSymbol}
                          usdValue={isUsd && depositAmount ? `$${Number(depositAmount).toFixed(2)}` : undefined}
                          apy={!vault.comingSoon && displayApy > 0 ? `${displayApy.toFixed(2)}%` : undefined}
                          positionShift={positionShift(depositAssetIn, 1n, depositAssetInApprox)}
                          signSteps={depositSignSteps}
                          step={depositStep}
                          processing={isDepositProcessing}
                          onConfirm={handleDeposit}
                        />

                      </div>
                  </>
                )}

                {/* ── WITHDRAW TAB ── */}
                {actionTab === "withdraw" && (
                  <div className="flex flex-col gap-3">
                    <div className="flex flex-col gap-2">
                      {/* WITHDRAW box */}
                      <div className="rounded-2xl p-4" style={{ background: "var(--bg2)", border: "1px solid var(--border)" }}>
                        <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
                          <span className="text-sm font-semibold" style={{ color: "var(--text-muted)" }}>WITHDRAW</span>
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {[25, 50, 75].map((pct) => (
                              <button
                                key={pct}
                                disabled={isWithdrawProcessing}
                                onClick={() => pickWithdrawAmount(pct / 100)}
                                className="px-2.5 py-1 rounded-lg text-xs font-medium transition-opacity hover:opacity-70"
                                style={{ background: "rgba(255,255,255,0.06)", color: "var(--text-muted)" }}
                              >
                                {pct}%
                              </button>
                            ))}
                            <button
                              disabled={isWithdrawProcessing}
                              onClick={() => pickWithdrawAmount(1)}
                              className="px-2.5 py-1 rounded-lg text-xs font-medium transition-opacity hover:opacity-70"
                              style={{ background: "rgba(255,255,255,0.06)", color: "var(--text-muted)" }}
                            >
                              Max
                            </button>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <input
                            type="number"
                            min="0"
                            placeholder="0"
                            value={withdrawAmount}
                            disabled={isWithdrawProcessing}
                            onChange={(e) => {
                              const v = e.target.value;
                              const re = new RegExp(`^\\d*\\.?\\d{0,${dec}}$`);
                              if (v === "" || (re.test(v) && Number(v) <= 1_000_000)) setWithdrawValue(v);
                            }}
                            className="flex-1 w-0 text-2xl bg-transparent outline-none"
                            style={{ color: "var(--text)", fontWeight: 300 }}
                          />
                          <div className="h-9 flex items-center gap-2 px-3 rounded-xl shrink-0" style={{ background: "rgba(255,255,255,0.06)" }}>
                            {vault.shareIcon && <Image src={vault.shareIcon} alt={vault.shareSymbol ?? vault.name} width={20} height={20} className="rounded-full object-contain" unoptimized />}
                            <span className="font-semibold text-sm">{vault.shareSymbol ?? vault.name}</span>
                          </div>
                        </div>
                        <div className="flex justify-end mt-1">
                          <span className="text-xs" style={{ color: "var(--text-muted)" }}>Balance: {bal(currentAssets)}</span>
                        </div>
                      </div>

                      {/* Arrow */}
                      <div className="flex justify-center -my-5 relative z-10">
                        <button onClick={() => setActionTab("deposit")} className="w-9 h-9 rounded-xl flex items-center justify-center transition-opacity hover:opacity-70" style={{ background: "#1B1B1B", border: "1px solid var(--border)" }}>
                          <ArrowDown size={16} style={{ color: "var(--text-muted)" }} />
                        </button>
                      </div>

                      {/* RECEIVE box — for LP vaults the token chip is a picker: receive the deposit token
                          (zap out) or the raw LP token (direct redeem, no swap). */}
                      <div ref={withdrawPickerRef} className="relative rounded-2xl p-4" style={{ background: "var(--bg2)", border: "1px solid var(--border)" }}>
                        <div className="flex items-center justify-between mb-3">
                          <span className="text-sm font-semibold" style={{ color: "var(--text-muted)" }}>RECEIVE</span>
                          <span className="text-xs" style={{ color: "var(--text-muted)" }}>{withdrawingLp ? "No swap" : isUsdc ? "10% fee on yield" : "No fee"}</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="flex-1 min-w-0 truncate text-2xl" style={{ fontWeight: 300 }}>{withdrawingLp ? withdrawLpOutStr : (withdrawAmount || "0")}</span>
                          {isAeroLp && selWithdraw ? (
                            <button
                              type="button"
                              disabled={isWithdrawProcessing || !canPickWithdraw}
                              onClick={() => setWithdrawPickerOpen((o) => !o)}
                              aria-haspopup="listbox"
                              aria-expanded={withdrawPickerOpen}
                              title={canPickWithdraw ? "Choose what to receive" : undefined}
                              className={`h-9 shrink-0 flex items-center gap-2 pl-3 pr-2.5 rounded-xl transition-opacity hover:opacity-80 disabled:cursor-default disabled:hover:opacity-100 ${withdrawPickerOpen && canPickWithdraw ? "relative z-30" : ""}`}
                              style={{ background: "rgba(255,255,255,0.06)" }}
                            >
                              {selWithdraw.icon2 ? (
                                <span className="flex items-center">
                                  <Image src={selWithdraw.icon} alt="" width={20} height={20} className="rounded-full object-contain" unoptimized />
                                  <Image src={selWithdraw.icon2} alt={selWithdraw.symbol} width={20} height={20} className="rounded-full object-contain -ml-2" style={{ boxShadow: "0 0 0 2px #141414" }} unoptimized />
                                </span>
                              ) : (
                                <Image src={selWithdraw.icon} alt={selWithdraw.symbol} width={20} height={20} className="rounded-full object-contain" unoptimized />
                              )}
                              <span className="font-semibold text-sm">{selWithdraw.symbol}</span>
                              {canPickWithdraw && (
                                <ChevronDown size={14} style={{ color: "var(--text-muted)" }} className={`transition-transform ${withdrawPickerOpen ? "rotate-180" : ""}`} />
                              )}
                            </button>
                          ) : (
                            <div className="h-9 flex items-center gap-2 px-3 rounded-xl shrink-0" style={{ background: "rgba(255,255,255,0.06)" }}>
                              <Image src={vault.iconUrl} alt={vault.tokenSymbol} width={20} height={20} className="rounded-full object-contain" unoptimized />
                              <span className="font-semibold text-sm">{vault.tokenSymbol}</span>
                            </div>
                          )}
                        </div>
                        {!withdrawingLp && (
                          <div className="flex justify-end mt-1">
                            <span className="text-xs" style={{ color: "var(--text-muted)" }}>Balance: {bal(usdcBalance)}</span>
                          </div>
                        )}
                        {withdrawPickerOpen && canPickWithdraw && (
                          <div
                            role="listbox"
                            className="absolute left-0 right-0 top-full mt-2 z-30 rounded-2xl overflow-y-auto shadow-xl max-h-[70vh]"
                            style={{ background: "#1B1B1B", border: "1px solid var(--border)" }}
                          >
                            <div className="px-4 py-3 text-sm font-semibold tracking-wide" style={{ color: "var(--text)", borderBottom: "1px solid var(--border)" }}>
                              Receive as
                            </div>
                            {withdrawChoices.map((c) => (
                              <button
                                key={c.key}
                                type="button"
                                role="option"
                                aria-selected={withdrawMode === c.key}
                                onClick={() => { setWithdrawMode(c.key); setWithdrawPickerOpen(false); }}
                                className="w-full flex items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-white/[0.06]"
                                style={withdrawMode === c.key ? { background: "rgba(52,211,153,0.10)" } : undefined}
                              >
                                <span className="w-11 flex items-center shrink-0">
                                  <Image src={c.icon} alt="" width={26} height={26} className="rounded-full object-contain" unoptimized />
                                  {c.icon2 && (
                                    <Image src={c.icon2} alt="" width={26} height={26} className="rounded-full object-contain -ml-2.5" style={{ boxShadow: "0 0 0 2px #1B1B1B" }} unoptimized />
                                  )}
                                </span>
                                <div className="flex flex-col min-w-0 flex-1">
                                  <span className="font-semibold text-sm leading-tight" style={{ color: "var(--text)" }}>{c.label}</span>
                                  <span className="text-[11px] leading-snug mt-0.5" style={{ color: "var(--text-muted)" }}>{c.desc}</span>
                                </div>
                                {withdrawMode === c.key && <Check size={16} style={{ color: "#34D399" }} className="shrink-0 ml-2" />}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Withdraw button — opens the review; nothing is sent from here. */}
                    <button
                      onClick={() => setWithdrawReviewing(true)}
                      disabled={isWithdrawProcessing || withdrawShares === 0n || !isLive}
                      className={clsx(
                        "w-full py-3 rounded-xl font-medium text-sm transition-opacity",
                        !isWithdrawProcessing && withdrawShares > 0n && isLive
                          ? "hover:opacity-80"
                          : "opacity-40 cursor-not-allowed"
                      )}
                      style={{ background: "rgba(52,211,153,0.15)", color: "#ffffff", border: "1px solid rgba(52,211,153,0.3)" }}
                    >
                      {isFullWithdraw ? "Withdraw All" : "Withdraw"}
                    </button>

                    <TxReview
                      open={withdrawReviewing}
                      onClose={() => setWithdrawReviewing(false)}
                      mode="withdraw"
                      vaultName={vault.name}
                      icon={vault.shareIcon ?? vault.iconUrl}
                      amount={withdrawAmount}
                      tokenSymbol={vault.tokenSymbol}
                      receive={withdrawingLp
                        ? `~${withdrawLpOutStr} LP ${lpCfg!.assets[0].alt}/${lpCfg!.assets[1].alt}`
                        : `~${withdrawAmount || "0"} ${isAeroLp ? lpCfg!.depositSymbol : vault.tokenSymbol}`}
                      positionShift={positionShift(isFullWithdraw ? currentAssets : withdrawAmountBigInt, -1n, false)}
                      signSteps={[
                        ...(needsShareApproval
                          ? [{ id: "approve" as const, title: `Allow BasementAeroZap router to spend your ${vault.shareSymbol ?? vault.name} shares`, address: AERO_ZAP_ADDRESS }]
                          : []),
                        {
                          id: "send" as const,
                          title: withdrawingLp
                            ? `Redeem ${isFullWithdraw ? "all your shares" : "your shares"} for the ${lpCfg!.assets[0].alt}/${lpCfg!.assets[1].alt} LP token from ${vault.name}`
                            : `Withdraw ${isFullWithdraw ? `all your ${isAeroLp ? lpCfg!.depositSymbol : vault.tokenSymbol}` : `${withdrawAmount || "0"} ${isAeroLp ? lpCfg!.depositSymbol : vault.tokenSymbol}`} from ${vault.name}`,
                          address: (isAeroLp && !withdrawingLp) ? AERO_ZAP_ADDRESS : activeVaultAddress,
                        },
                      ]}
                      step={withdrawStep}
                      processing={isWithdrawProcessing}
                      onConfirm={handleWithdraw}
                    />

                  </div>
                )}

                {/* ── HARVEST TAB (AERO LP — auto-compound) ── */}
                {actionTab === "harvest" && (
                  <>
                    <div className="flex flex-col gap-2">
                      <div className="rounded-xl p-3 flex items-center justify-between" style={{ background: "var(--bg2)", border: "1px solid var(--border)" }}>
                        <span className="text-xs" style={{ color: "var(--text-muted)" }}>Pending Rewards</span>
                        <span className="text-sm font-semibold">{fmtUnits(aeroPending, 18, 6)} AERO</span>
                      </div>
                      <div className="rounded-xl p-3 flex items-center justify-between" style={{ background: "var(--bg2)", border: "1px solid var(--border)" }}>
                        <span className="text-xs" style={{ color: "var(--text-muted)" }}>Your reward (caller fee)</span>
                        <span className="text-sm font-semibold" style={{ color: "#34D399" }}>+{fmtUnits(callerReward, 18, 6)} AERO</span>
                      </div>
                    </div>

                    <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                      Harvesting claims AERO emissions and compounds them back into the staked LP for every depositor — raising each share&apos;s value (no new shares minted). Anyone can harvest; the caller earns a 1% fee in AERO.
                    </p>

                    <button
                      onClick={handleHarvest}
                      disabled={isHarvestProcessing || !canHarvest}
                      className={clsx(
                        "w-full py-3 rounded-xl font-medium text-sm transition-opacity",
                        !isHarvestProcessing && canHarvest ? "hover:opacity-80" : "opacity-40 cursor-not-allowed"
                      )}
                      style={{ background: "rgba(52,211,153,0.15)", color: "#ffffff", border: "1px solid rgba(52,211,153,0.3)" }}
                    >
                      {isHarvestProcessing ? "Harvesting…" : canHarvest ? "Harvest & Compound" : "Nothing to harvest yet"}
                    </button>
                  </>
                )}
              </div>
            </div>{/* end action card */}
            </div>{/* end grid */}


          </div>
        )}
        </div>
      </main>

      {/* Toast */}
      {toast && (
        <div
          className="fixed bottom-6 left-4 right-4 sm:left-auto sm:right-6 sm:min-w-[320px] z-50 flex flex-col overflow-hidden rounded-2xl shadow-xl text-sm font-medium"
          style={{
            background: "#212121",
            border: `1px solid ${toast.type === "success" ? "rgba(52,211,153,0.35)" : "rgba(248,113,113,0.35)"}`,
            color: toast.type === "success" ? "#34D399" : "#f87171",
            maxWidth: "420px",
          }}
        >
          {/* Clickable area → Basescan */}
          {toast.txHash ? (
            <a
              href={`https://basescan.org/tx/${toast.txHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 px-5 py-4 transition-opacity hover:opacity-80"
            >
              <span className="text-base">{toast.type === "success" ? "✓" : "✕"}</span>
              <span className="flex-1">{toast.msg}</span>
              <ExternalLink size={14} className="shrink-0 opacity-60" />
              <button
                onClick={(e) => { e.preventDefault(); setToast(null); }}
                className="opacity-50 hover:opacity-100 transition-opacity"
                style={{ color: "var(--text-muted)" }}
              >✕</button>
            </a>
          ) : (
            <div className="flex items-center gap-3 px-5 py-4">
              <span className="text-base">{toast.type === "success" ? "✓" : "✕"}</span>
              <span className="flex-1">{toast.msg}</span>
              <button onClick={() => setToast(null)} className="ml-2 opacity-50 hover:opacity-100 transition-opacity" style={{ color: "var(--text-muted)" }}>✕</button>
            </div>
          )}
          {/* Progress bar — shrinks right to left */}
          <div className="h-0.5 w-full" style={{ background: "rgba(255,255,255,0.06)" }}>
            <div
              key={toast.msg}
              className="h-full w-full"
              style={{
                background: "#34D399",
                transformOrigin: "right",
                animation: "toast-progress 5s linear forwards",
              }}
            />
          </div>
          <style>{`
            @keyframes toast-progress {
              from { transform: scaleX(1); }
              to   { transform: scaleX(0); }
            }
          `}</style>
        </div>
      )}

      {/* Footer */}
      <Footer />
    </div>
  );
}
