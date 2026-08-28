"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { VAULTS, Vault } from "@/lib/vaults";
import { useMorphoApy } from "@/lib/useMorphoApy";
import { useAeroApr } from "@/lib/useAeroApr";
import { useReadContract } from "wagmi";
import { EARN_USDC_ADDRESS, EARN_USDC_ABI, EARN_ETH_ADDRESS, EARN_BTC_ADDRESS, MORPHO_CBBTC_VAULT_ADDRESS, MORPHO_VAULT_ADDRESS, MORPHO_WETH_VAULT_ADDRESS, MORPHO_VAULT_ABI, AERO_LP_ABI, AERO_ZAP_ADDRESS, AERO_ZAP_ABI, ETH_USD_FEED, BTC_USD_FEED, CHAINLINK_ABI } from "@/lib/contracts";
import { fmtUnits, fmtUsd } from "@/lib/format";

const CURATORS: Record<string, string> = {
  usdc: "Morpho",
  weth: "—",
  cbbtc: "—",
  "lp-aero-usdc": "—",
};

// Cap cell for vaults without a deposit cap.
function NoCapCell() {
  return <td className="py-6 pr-4 text-sm" style={{ color: "var(--text-muted)" }}>No cap</td>;
}

// USD price per whole token (USDC = 1; WETH/cbBTC via Chainlink). undefined while the feed loads.
function useUsdPrice(symbol: string): number | undefined {
  const feed = symbol === "WETH" ? ETH_USD_FEED : symbol === "cbBTC" ? BTC_USD_FEED : undefined;
  const { data } = useReadContract({ address: feed, abi: CHAINLINK_ABI, functionName: "latestRoundData", query: { enabled: !!feed } });
  if (!feed) return 1; // USDC / unknown → already USD
  return data !== undefined ? Number(data[1]) / 1e8 : undefined; // answer (8dp)
}

// Presentation-only cap bar (no <td>) — shared by the desktop CapBarCell and the mobile cards.
function CapBar({ capUsd, usedUsd }: { capUsd: number; usedUsd: number }) {
  const fillPct = capUsd > 0 ? Math.min(100, Math.max(0, (usedUsd / capUsd) * 100)) : 0;
  return (
    <div>
      <div className="text-sm font-medium">${Math.round(capUsd).toLocaleString()}</div>
      <div className="mt-1.5 h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.08)", width: 96 }}>
        <div className="h-full rounded-full" style={{ width: `${fillPct}%`, background: "#34D399" }} />
      </div>
      <div className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>{fillPct.toFixed(0)}% filled</div>
    </div>
  );
}

// Cap cell — USD amount + fill bar + "% filled" (matches the LP vault cap style).
function CapBarCell({ capUsd, usedUsd }: { capUsd: number; usedUsd: number }) {
  return (
    <td className="py-6 pr-4">
      <CapBar capUsd={capUsd} usedUsd={usedUsd} />
    </td>
  );
}

// Cap node for the Earn* / Core vaults — reads depositCap (shares) → USD via convertToAssets × price.
// Returns a render-agnostic descriptor so both the desktop <td> and the mobile card can present it.
// depositCap/convertToAssets/totalAssets share selectors across these vaults, so EARN_USDC_ABI works on all.
type CapInfo =
  | { kind: "none" }
  | { kind: "loading" }
  | { kind: "bar"; capUsd: number; usedUsd: number };

function useMorphoCap({ addr, dec, isUsd, symbol }: { addr: `0x${string}`; dec: number; isUsd: boolean; symbol: string }): CapInfo {
  const { data: cap } = useReadContract({ address: addr, abi: EARN_USDC_ABI, functionName: "depositCap" });
  const { data: capAssets } = useReadContract({
    address: addr, abi: EARN_USDC_ABI, functionName: "convertToAssets",
    args: cap !== undefined ? [cap] : undefined,
    query: { enabled: cap !== undefined && cap > 0n },
  });
  const { data: used } = useReadContract({ address: addr, abi: EARN_USDC_ABI, functionName: "totalAssets" });
  const price = useUsdPrice(isUsd ? "USDC" : symbol);
  if (cap === 0n) return { kind: "none" };
  if (capAssets === undefined || price === undefined) return { kind: "loading" };
  const capUsd = (Number(capAssets) / 10 ** dec) * price;
  const usedUsd = used !== undefined ? (Number(used) / 10 ** dec) * price : 0;
  return { kind: "bar", capUsd, usedUsd };
}

// Desktop cap <td> from a CapInfo descriptor.
function CapCell({ cap }: { cap: CapInfo }) {
  if (cap.kind === "none") return <NoCapCell />;
  if (cap.kind === "loading") return <td className="py-6 pr-4 text-sm" style={{ color: "var(--text-muted)" }}>—</td>;
  return <CapBarCell capUsd={cap.capUsd} usedUsd={cap.usedUsd} />;
}

// Mobile cap value from a CapInfo descriptor.
function CapValue({ cap }: { cap: CapInfo }) {
  if (cap.kind === "none") return <span className="text-sm" style={{ color: "var(--text-muted)" }}>No cap</span>;
  if (cap.kind === "loading") return <span className="text-sm" style={{ color: "var(--text-muted)" }}>—</span>;
  return <CapBar capUsd={cap.capUsd} usedUsd={cap.usedUsd} />;
}

// Leading icon(s) for the vault-name cell — one circle per token, overlapped, mirroring the Assets column.
// Vault-column icon(s): every token is a 32px disc (same size as the EarnUSDC icon), overlapped for
// pairs via a box-shadow ring (not an inset border, so the disc keeps its full size). The fixed-width
// slot makes the vault names line up across single- and pair-asset rows.
function VaultIcons({ tokens, fit }: { tokens: { src: string; alt: string; bg: string }[]; fit?: boolean }) {
  return (
    <div className="flex items-center shrink-0" style={fit ? undefined : { width: 56 }}>
      {tokens.map((t, i) => (
        <div
          key={t.alt}
          className="w-8 h-8 rounded-full overflow-hidden shrink-0 flex items-center justify-center"
          style={{ background: t.bg, marginLeft: i === 0 ? 0 : -10, boxShadow: i === 0 ? undefined : "0 0 0 2px #1B1B1B" }}
        >
          <Image src={t.src} alt={t.alt} width={32} height={32} className="w-full h-full object-contain p-0.5" unoptimized />
        </div>
      ))}
    </div>
  );
}

// Overlapped asset discs used in the Assets column / the mobile card's Assets row.
function AssetIcons({ tokens }: { tokens: { src: string; alt: string; bg: string }[] }) {
  return (
    <div className="flex items-center">
      {tokens.map((token, i) => (
        <div key={token.alt} className="w-7 h-7 rounded-full overflow-hidden border-2 shrink-0 flex items-center justify-center" style={{ background: token.bg, borderColor: "#1B1B1B", marginLeft: i === 0 ? 0 : "-7px" }}>
          <Image src={token.src} alt={token.alt} width={28} height={28} className="w-full h-full object-contain" unoptimized />
        </div>
      ))}
    </div>
  );
}

// Mobile-only vault card — same data as a table row, laid out as a tappable card (matches Status page style).
function VaultCard({
  iconTokens, name, badge, subtitle, tvlUsd, tvlNative, cap, apy, onClick, dimmed,
}: {
  iconTokens: { src: string; alt: string; bg: string }[];
  assetTokens: { src: string; alt: string; bg: string }[];
  name: string;
  badge?: { label: string; muted?: boolean };
  subtitle: string;
  tvlUsd: string;
  tvlNative?: string;
  cap: CapInfo | null;
  curator: string;
  apy: string;
  onClick?: () => void;
  dimmed?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl border p-4 w-full max-w-full ${onClick ? "cursor-pointer transition-opacity hover:opacity-80" : ""} ${dimmed ? "opacity-50" : ""}`}
      style={{ borderColor: "var(--border)", background: "var(--card)" }}
      onClick={onClick}
    >
      {/* Identity */}
      <div className="flex items-center gap-2.5 min-w-0">
        <VaultIcons tokens={iconTokens} fit />
        <div className="min-w-0">
          <div className="flex items-center gap-2 font-medium text-sm">
            <span className="truncate">{name}</span>
            {badge && (
              <span
                className="text-xs px-2 py-0.5 rounded-full shrink-0"
                style={badge.muted
                  ? { background: "rgba(255,255,255,0.08)", color: "var(--text-muted)" }
                  : { background: "rgba(52,211,153,0.1)", color: "#34D399" }}
              >
                {badge.label}
              </span>
            )}
          </div>
          <div className="text-xs truncate" style={{ color: "var(--text-muted)" }}>{subtitle}</div>
        </div>
      </div>

      {/* Metrics — single row, 3 columns: TVL, APY, Cap. Each cell: header + value below. */}
      <div className="mt-4 grid grid-cols-3 gap-3">
        <div className="flex flex-col gap-1 min-w-0">
          <span className="text-sm uppercase tracking-wider font-medium" style={{ color: "var(--text)" }}>TVL</span>
          <div className="text-sm font-medium truncate">{tvlUsd}</div>
          {tvlNative && <div className="text-xs truncate" style={{ color: "var(--text-muted)" }}>{tvlNative}</div>}
        </div>
        <div className="flex flex-col gap-1 min-w-0">
          <span className="text-sm uppercase tracking-wider font-medium" style={{ color: "var(--text)" }}>APY</span>
          <div className="text-sm font-medium" style={{ color: dimmed ? "var(--text-muted)" : "#34D399" }}>{apy}</div>
        </div>
        <div className="flex flex-col gap-1 min-w-0">
          <span className="text-sm uppercase tracking-wider font-medium" style={{ color: "var(--text)" }}>Cap</span>
          <div>{cap ? <CapValue cap={cap} /> : <span className="text-sm" style={{ color: "var(--text-muted)" }}>—</span>}</div>
        </div>
      </div>
    </div>
  );
}

// ── Per-vault data hooks (shared by the desktop <tr> and the mobile card) ──

function useUsdcData() {
  const { apy } = useMorphoApy();

  const { data: morphoShares } = useReadContract({
    address: MORPHO_VAULT_ADDRESS, abi: MORPHO_VAULT_ABI,
    functionName: "balanceOf", args: [EARN_USDC_ADDRESS],
  });
  const { data: liveTvl } = useReadContract({
    address: MORPHO_VAULT_ADDRESS, abi: MORPHO_VAULT_ABI,
    functionName: "convertToAssets",
    args: morphoShares ? [morphoShares] : undefined,
    query: { enabled: !!morphoShares },
  });

  const tvlUsd = liveTvl !== undefined ? fmtUsd(Number(liveTvl) / 1e6) : "—";
  const tvlAsset = liveTvl !== undefined ? `${fmtUnits(liveTvl, 6, 2)} USDC` : "—";

  const apyStr = apy !== null ? `${apy.toFixed(2)}%` : "—";
  const cap = useMorphoCap({ addr: EARN_USDC_ADDRESS, dec: 6, isUsd: true, symbol: "USDC" });
  const vault = VAULTS.find(v => v.id === "usdc")!;

  return { vault, tvlUsd, tvlAsset, apyStr, cap };
}

function UsdcRow() {
  const router = useRouter();
  const { vault, tvlUsd, tvlAsset, apyStr, cap } = useUsdcData();

  return (
    <tr className="border-b transition-opacity hover:opacity-80 cursor-pointer" style={{ borderColor: "var(--border)", background: "#1B1B1B" }} onClick={() => router.push("/vault/usdc")}>
      <td className="py-6 pr-2 pl-5">
        <div className="flex items-center gap-3">
          <VaultIcons tokens={[{ src: vault.iconUrl, alt: vault.tokenSymbol, bg: vault.iconBg }]} />
          <div>
            <div className="font-medium text-sm">{vault.name}</div>
            <div className="text-xs" style={{ color: "var(--text-muted)" }}>{vault.tokenSymbol}</div>
          </div>
        </div>
      </td>
      <td className="py-6 pr-4">
        <div className="text-sm font-medium">{tvlUsd}</div>
        <div className="text-xs" style={{ color: "var(--text-muted)" }}>{tvlAsset}</div>
      </td>
      <CapCell cap={cap} />
      <td className="py-6 pr-4">
        <div className="flex items-center">
          <div className="w-7 h-7 rounded-full overflow-hidden border-2 shrink-0 flex items-center justify-center" style={{ background: "#2775ca", borderColor: "#1B1B1B" }}>
            <Image src="https://assets.coingecko.com/coins/images/6319/large/usdc.png" alt="USDC" width={28} height={28} className="w-full h-full object-contain" unoptimized />
          </div>
        </div>
      </td>
      <td className="py-6 pr-4 text-sm">Gauntlet</td>
      <td className="py-6 pr-5 text-sm text-right" style={{ color: "#34D399" }}>{apyStr}</td>
    </tr>
  );
}

function UsdcCard() {
  const router = useRouter();
  const { vault, tvlUsd, tvlAsset, apyStr, cap } = useUsdcData();
  return (
    <VaultCard
      iconTokens={[{ src: vault.iconUrl, alt: vault.tokenSymbol, bg: vault.iconBg }]}
      assetTokens={[{ src: "https://assets.coingecko.com/coins/images/6319/large/usdc.png", alt: "USDC", bg: "#2775ca" }]}
      name={vault.name}
      subtitle={vault.tokenSymbol}
      tvlUsd={tvlUsd}
      tvlNative={tvlAsset}
      cap={cap}
      curator="Gauntlet"
      apy={apyStr}
      onClick={() => router.push("/vault/usdc")}
    />
  );
}

function useWethData() {
  const { apy } = useMorphoApy(MORPHO_WETH_VAULT_ADDRESS);

  const { data: morphoShares } = useReadContract({
    address: MORPHO_WETH_VAULT_ADDRESS, abi: MORPHO_VAULT_ABI,
    functionName: "balanceOf", args: [EARN_ETH_ADDRESS],
  });
  const { data: liveTvl } = useReadContract({
    address: MORPHO_WETH_VAULT_ADDRESS, abi: MORPHO_VAULT_ABI,
    functionName: "convertToAssets",
    args: morphoShares ? [morphoShares] : undefined,
    query: { enabled: !!morphoShares },
  });

  const tvlAsset = liveTvl !== undefined ? `${fmtUnits(liveTvl, 18, 4)} WETH` : "—";
  const tvlPrice = useUsdPrice("WETH");
  const tvlUsd = liveTvl !== undefined && tvlPrice !== undefined ? `$${Math.round((Number(liveTvl) / 1e18) * tvlPrice).toLocaleString()}` : "—";
  const vault = VAULTS.find(v => v.id === "weth")!;
  // Morpho's blue-api does not index this vault; fall back to the static estimate when apy is null.
  const apyStr = `${(apy ?? vault.netApy).toFixed(2)}%`;
  const cap = useMorphoCap({ addr: EARN_ETH_ADDRESS, dec: 18, isUsd: false, symbol: "WETH" });

  return { vault, tvlUsd, tvlAsset, apyStr, cap };
}

function WethRow() {
  const router = useRouter();
  const { vault, tvlUsd, tvlAsset, apyStr, cap } = useWethData();

  return (
    <tr className="border-b transition-opacity hover:opacity-80 cursor-pointer" style={{ borderColor: "var(--border)", background: "#1B1B1B" }} onClick={() => router.push("/vault/weth")}>
      <td className="py-6 pr-2 pl-5">
        <div className="flex items-center gap-3">
          <VaultIcons tokens={[{ src: vault.iconUrl, alt: vault.tokenSymbol, bg: vault.iconBg }]} />
          <div>
            <div className="flex items-center gap-2 font-medium text-sm">
              {vault.name}
              <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: "rgba(52,211,153,0.1)", color: "#34D399" }}>New</span>
            </div>
            <div className="text-xs" style={{ color: "var(--text-muted)" }}>{vault.tokenSymbol}</div>
          </div>
        </div>
      </td>
      <td className="py-6 pr-4">
        <div className="text-sm font-medium">{tvlUsd}</div>
        <div className="text-xs" style={{ color: "var(--text-muted)" }}>{tvlAsset}</div>
      </td>
      <CapCell cap={cap} />
      <td className="py-6 pr-4">
        <div className="flex items-center">
          <div className="w-7 h-7 rounded-full overflow-hidden border-2 shrink-0 flex items-center justify-center" style={{ background: vault.iconBg, borderColor: "#1B1B1B" }}>
            <Image src={vault.iconUrl} alt={vault.tokenSymbol} width={28} height={28} className="w-full h-full object-contain" unoptimized />
          </div>
        </div>
      </td>
      <td className="py-6 pr-4 text-sm">Gauntlet</td>
      <td className="py-6 pr-5 text-sm text-right" style={{ color: "#34D399" }}>{apyStr}</td>
    </tr>
  );
}

function WethCard() {
  const router = useRouter();
  const { vault, tvlUsd, tvlAsset, apyStr, cap } = useWethData();
  return (
    <VaultCard
      iconTokens={[{ src: vault.iconUrl, alt: vault.tokenSymbol, bg: vault.iconBg }]}
      assetTokens={[{ src: vault.iconUrl, alt: vault.tokenSymbol, bg: vault.iconBg }]}
      name={vault.name}
      badge={{ label: "New" }}
      subtitle={vault.tokenSymbol}
      tvlUsd={tvlUsd}
      tvlNative={tvlAsset}
      cap={cap}
      curator="Gauntlet"
      apy={apyStr}
      onClick={() => router.push("/vault/weth")}
    />
  );
}

function useEarnBtcData() {
  const { apy } = useMorphoApy(MORPHO_CBBTC_VAULT_ADDRESS);

  const { data: morphoShares } = useReadContract({
    address: MORPHO_CBBTC_VAULT_ADDRESS, abi: MORPHO_VAULT_ABI,
    functionName: "balanceOf", args: [EARN_BTC_ADDRESS],
  });
  const { data: liveTvl } = useReadContract({
    address: MORPHO_CBBTC_VAULT_ADDRESS, abi: MORPHO_VAULT_ABI,
    functionName: "convertToAssets",
    args: morphoShares ? [morphoShares] : undefined,
    query: { enabled: !!morphoShares },
  });

  const tvlAsset = liveTvl !== undefined ? `${fmtUnits(liveTvl, 8, 6)} cbBTC` : "—";
  const tvlPrice = useUsdPrice("cbBTC");
  const tvlUsd = liveTvl !== undefined && tvlPrice !== undefined ? `$${Math.round((Number(liveTvl) / 1e8) * tvlPrice).toLocaleString()}` : "—";
  const vault = VAULTS.find(v => v.id === "earnbtc")!;
  const apyStr = `${(apy ?? vault.netApy).toFixed(2)}%`;
  const cap = useMorphoCap({ addr: EARN_BTC_ADDRESS, dec: 8, isUsd: false, symbol: "cbBTC" });

  return { vault, tvlUsd, tvlAsset, apyStr, cap };
}

function EarnBtcRow() {
  const router = useRouter();
  const { vault, tvlUsd, tvlAsset, apyStr, cap } = useEarnBtcData();

  return (
    <tr className="border-b transition-opacity hover:opacity-80 cursor-pointer" style={{ borderColor: "var(--border)", background: "#1B1B1B" }} onClick={() => router.push("/vault/earnbtc")}>
      <td className="py-6 pr-2 pl-5">
        <div className="flex items-center gap-3">
          <VaultIcons tokens={[{ src: vault.iconUrl, alt: vault.tokenSymbol, bg: vault.iconBg }]} />
          <div>
            <div className="flex items-center gap-2 font-medium text-sm">
              {vault.name}
              <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: "rgba(52,211,153,0.1)", color: "#34D399" }}>New</span>
            </div>
            <div className="text-xs" style={{ color: "var(--text-muted)" }}>{vault.tokenSymbol}</div>
          </div>
        </div>
      </td>
      <td className="py-6 pr-4">
        <div className="text-sm font-medium">{tvlUsd}</div>
        <div className="text-xs" style={{ color: "var(--text-muted)" }}>{tvlAsset}</div>
      </td>
      <CapCell cap={cap} />
      <td className="py-6 pr-4">
        <div className="flex items-center">
          <div className="w-7 h-7 rounded-full overflow-hidden border-2 shrink-0 flex items-center justify-center" style={{ background: vault.iconBg, borderColor: "#1B1B1B" }}>
            <Image src={vault.iconUrl} alt={vault.tokenSymbol} width={28} height={28} className="w-full h-full object-contain" unoptimized />
          </div>
        </div>
      </td>
      <td className="py-6 pr-4 text-sm">Gauntlet</td>
      <td className="py-6 pr-5 text-sm text-right" style={{ color: "#34D399" }}>{apyStr}</td>
    </tr>
  );
}

function EarnBtcCard() {
  const router = useRouter();
  const { vault, tvlUsd, tvlAsset, apyStr, cap } = useEarnBtcData();
  return (
    <VaultCard
      iconTokens={[{ src: vault.iconUrl, alt: vault.tokenSymbol, bg: vault.iconBg }]}
      assetTokens={[{ src: vault.iconUrl, alt: vault.tokenSymbol, bg: vault.iconBg }]}
      name={vault.name}
      badge={{ label: "New" }}
      subtitle={vault.tokenSymbol}
      tvlUsd={tvlUsd}
      tvlNative={tvlAsset}
      cap={cap}
      curator="Gauntlet"
      apy={apyStr}
      onClick={() => router.push("/vault/earnbtc")}
    />
  );
}

function useAeroLpData(vault: Vault) {
  const lp = vault.lp!;
  const vaultAddr = vault.contractAddress as `0x${string}`;
  const quote = lp.depositToken as `0x${string}`; // value the LP in the deposit token (USDC or WETH)
  const dec = vault.decimals ?? 6;
  const isUsd = lp.depositSymbol === "USDC";

  // Vault shares are LP-denominated, so values come from BasementAeroZap.valueOfSharesInToken (in the deposit token).
  const { data: totalSupply } = useReadContract({ address: vaultAddr, abi: AERO_LP_ABI, functionName: "totalSupply" });
  const { data: tvl } = useReadContract({
    address: AERO_ZAP_ADDRESS, abi: AERO_ZAP_ABI, functionName: "valueOfSharesInToken",
    args: totalSupply !== undefined ? [vaultAddr, totalSupply, quote] : undefined,
    query: { enabled: totalSupply !== undefined && totalSupply > 0n },
  });
  const { data: depositCap } = useReadContract({ address: vaultAddr, abi: AERO_LP_ABI, functionName: "depositCap" });
  const { data: capVal } = useReadContract({
    address: AERO_ZAP_ADDRESS, abi: AERO_ZAP_ABI, functionName: "valueOfSharesInToken",
    args: depositCap !== undefined ? [vaultAddr, depositCap, quote] : undefined,
    query: { enabled: depositCap !== undefined && depositCap > 0n },
  });
  const apr = useAeroApr(lp);

  const apyStr = apr !== null ? `${apr.netApy.toFixed(2)}%` : vault.netApy > 0 ? `${vault.netApy.toFixed(2)}%` : "—";
  const pair = `${lp.assets[0].alt}/${lp.assets[1].alt}`;

  const capPrice = useUsdPrice(lp.depositSymbol);
  const capUsdVal = capVal !== undefined && capPrice !== undefined ? (Number(capVal) / 10 ** dec) * capPrice : undefined;
  const usedUsdVal = tvl !== undefined && capPrice !== undefined ? (Number(tvl) / 10 ** dec) * capPrice : 0;
  // TVL: $ main + native deposit-token amount below.
  const tvlUsdMain = tvl !== undefined && capPrice !== undefined ? `$${Math.round(usedUsdVal).toLocaleString()}` : "—";
  const tvlNative = tvl !== undefined ? `${fmtUnits(tvl, dec, isUsd ? 2 : 4)} ${lp.depositSymbol}` : "—";

  return { lp, pair, apyStr, capUsdVal, usedUsdVal, tvlUsdMain, tvlNative };
}

function AeroLpRow({ vault }: { vault: Vault }) {
  const router = useRouter();
  const { lp, pair, apyStr, capUsdVal, usedUsdVal, tvlUsdMain, tvlNative } = useAeroLpData(vault);

  return (
    <tr className="border-b transition-opacity hover:opacity-80 cursor-pointer" style={{ borderColor: "var(--border)", background: "#1B1B1B" }} onClick={() => router.push(`/vault/${vault.id}`)}>
      <td className="py-6 pr-2 pl-5">
        <div className="flex items-center gap-3">
          <VaultIcons tokens={lp.assets} />
          <div>
            <div className="flex items-center gap-2 font-medium text-sm">
              {vault.name}
              <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: "rgba(52,211,153,0.1)", color: "#34D399" }}>New</span>
            </div>
            <div className="text-xs" style={{ color: "var(--text-muted)" }}>{pair}</div>
          </div>
        </div>
      </td>
      <td className="py-6 pr-4">
        <div className="text-sm font-medium">{tvlUsdMain}</div>
        <div className="text-xs" style={{ color: "var(--text-muted)" }}>{tvlNative}</div>
      </td>
      {capUsdVal !== undefined ? (
        <CapBarCell capUsd={capUsdVal} usedUsd={usedUsdVal} />
      ) : (
        <td className="py-6 pr-4"><span className="text-sm" style={{ color: "var(--text-muted)" }}>—</span></td>
      )}
      <td className="py-6 pr-4">
        <AssetIcons tokens={lp.assets} />
      </td>
      <td className="py-6 pr-4 text-sm">Aerodrome</td>
      <td className="py-6 pr-5 text-sm text-right" style={{ color: "#34D399" }}>{apyStr}</td>
    </tr>
  );
}

function AeroLpCard({ vault }: { vault: Vault }) {
  const router = useRouter();
  const { lp, pair, apyStr, capUsdVal, usedUsdVal, tvlUsdMain, tvlNative } = useAeroLpData(vault);
  const cap: CapInfo = capUsdVal !== undefined ? { kind: "bar", capUsd: capUsdVal, usedUsd: usedUsdVal } : { kind: "loading" };
  return (
    <VaultCard
      iconTokens={lp.assets}
      assetTokens={lp.assets}
      name={vault.name}
      badge={{ label: "New" }}
      subtitle={pair}
      tvlUsd={tvlUsdMain}
      tvlNative={tvlNative}
      cap={cap}
      curator="Aerodrome"
      apy={apyStr}
      onClick={() => router.push(`/vault/${vault.id}`)}
    />
  );
}

export default function VaultTable() {
  return (
    <div className="w-full flex flex-col gap-3">
      <div className="flex justify-end">
        <input
          type="text"
          placeholder="Search vault or address"
          className="text-sm px-4 py-2 rounded-xl outline-none w-full sm:w-48"
          style={{ background: "#212121", border: "none", color: "var(--text)" }}
        />
      </div>

      {/* Desktop: table */}
      <div className="hidden md:block w-full overflow-x-auto rounded-2xl">
        <table className="w-full text-left table-fixed">
          <thead>
            <tr className="text-xs uppercase tracking-wider" style={{ color: "var(--text)", background: "#212121" }}>
              <th className="py-5 pr-2 pl-5 font-medium w-56">Vault</th>
              <th className="py-5 pr-4 font-medium w-36">TVL</th>
              <th className="py-5 pr-4 font-medium w-40">Cap</th>
              <th className="py-5 pr-4 font-medium w-32">Assets</th>
              <th className="py-5 pr-4 font-medium w-28">Curator</th>
              <th className="py-5 pr-5 font-medium text-right w-20">APY</th>
            </tr>
          </thead>
          <tbody>
            <UsdcRow />
            <WethRow />
            <EarnBtcRow />
            {VAULTS.filter(v => v.lp).map(v => <AeroLpRow key={v.id} vault={v} />)}
            {VAULTS.filter(v => v.comingSoon).map(vault => (
              <tr key={vault.id} className="border-b" style={{ borderColor: "var(--border)", background: "#1B1B1B" }}>
                <td className="py-6 pr-2 pl-5 opacity-50">
                  <div className="flex items-center gap-3">
                    <VaultIcons tokens={[{ src: vault.iconUrl, alt: vault.tokenSymbol, bg: vault.iconBg }]} />
                    <div>
                      <div className="flex items-center gap-2 font-medium text-sm">
                        {vault.name}
                        <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: "rgba(255,255,255,0.08)", color: "var(--text-muted)" }}>Coming Soon</span>
                      </div>
                      <div className="text-xs" style={{ color: "var(--text-muted)" }}>{vault.tokenSymbol}</div>
                    </div>
                  </div>
                </td>
                <td className="py-6 pr-4 text-sm opacity-50">—</td>
                <td className="py-6 pr-4 text-sm opacity-50">—</td>
                <td className="py-6 pr-4 text-sm opacity-50">—</td>
                <td className="py-6 pr-4 text-sm opacity-50">{CURATORS[vault.id]}</td>
                <td className="py-6 pr-5 text-sm text-right opacity-50" style={{ color: "var(--text-muted)" }}>—</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile: cards (same vault rows, mapped) */}
      <div className="md:hidden flex flex-col gap-3 w-full">
        <UsdcCard />
        <WethCard />
        <EarnBtcCard />
        {VAULTS.filter(v => v.lp).map(v => <AeroLpCard key={v.id} vault={v} />)}
        {VAULTS.filter(v => v.comingSoon).map(vault => (
          <VaultCard
            key={vault.id}
            iconTokens={[{ src: vault.iconUrl, alt: vault.tokenSymbol, bg: vault.iconBg }]}
            assetTokens={[{ src: vault.iconUrl, alt: vault.tokenSymbol, bg: vault.iconBg }]}
            name={vault.name}
            badge={{ label: "Coming Soon", muted: true }}
            subtitle={vault.tokenSymbol}
            tvlUsd="—"
            cap={null}
            curator={CURATORS[vault.id]}
            apy="—"
            dimmed
          />
        ))}
      </div>
    </div>
  );
}
