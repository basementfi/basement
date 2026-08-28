"use client";

import Image from "next/image";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { VAULTS } from "@/lib/vaults";
import { useMorphoApy } from "@/lib/useMorphoApy";
import { useReadContract } from "wagmi";
import { EARN_USDC_ADDRESS, EARN_USDC_ABI, EARN_ETH_ADDRESS, MORPHO_VAULT_ADDRESS, MORPHO_WETH_VAULT_ADDRESS, MORPHO_VAULT_ABI } from "@/lib/contracts";
import { fmtUsd, fmtUnits } from "@/lib/format";

function LiveUsdcStats() {
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

  const tvlRaw = liveTvl !== undefined ? Number(liveTvl) / 1e6 : null;
  const tvlStr = tvlRaw !== null ? fmtUsd(tvlRaw) : "—";
  const apyStr = apy !== null ? `${apy.toFixed(2)}%` : "—";

  return <VaultStats tvl={tvlStr} apy={apyStr} />;
}

function LiveWethStats() {
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

  const tvlStr = liveTvl !== undefined ? `${fmtUnits(liveTvl, 18, 4)} WETH` : "—";
  // Morpho's blue-api does not index this vault; fall back to the static estimate when apy is null.
  const effApy = apy ?? VAULTS.find((v) => v.id === "weth")!.netApy;
  const apyStr = `${effApy.toFixed(2)}%`;

  return <VaultStats tvl={tvlStr} apy={apyStr} />;
}

function VaultStats({ tvl, apy }: { tvl: string; apy: string }) {
  return (
    <div className="flex flex-col w-full">
      {/* TVL row — desktop only; on mobile the featured card is just the white icon/name row + APY */}
      <div className="hidden sm:flex items-center text-base py-3 px-6">
        <span className="w-12" style={{ color: "var(--text-muted)" }}>TVL</span>
        <span className="flex-1 text-center font-semibold">{tvl}</span>
      </div>
      <div className="hidden sm:block w-full h-px" style={{ background: "var(--border)" }} />
      <div className="flex items-center justify-center sm:justify-start gap-1.5 text-base py-3 px-3 sm:px-6">
        <span className="sm:w-12" style={{ color: "var(--text-muted)" }}>APY</span>
        <span className="sm:flex-1 text-center font-semibold" style={{ color: "#34D399" }}>{apy}</span>
      </div>
    </div>
  );
}

export default function VaultList() {
  return (
    <div className="flex flex-col gap-4 w-full">
<div className="rounded-2xl p-4 sm:p-10" style={{ background: "linear-gradient(135deg, #34D399 0%, rgba(52,211,153,0.62) 7%, rgba(52,211,153,0.42) 14%, rgba(52,211,153,0.28) 21%, rgba(52,211,153,0.16) 30%, rgba(52,211,153,0.08) 38%, rgba(52,211,153,0.03) 45%, #0e0e0e 50%, #0e0e0e 51%, rgba(52,211,153,0.03) 65%, rgba(52,211,153,0.08) 70%, rgba(52,211,153,0.16) 77%, rgba(52,211,153,0.28) 84%, rgba(52,211,153,0.42) 90%, rgba(52,211,153,0.62) 96%, #34D399 100%)" }}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-10">
        {VAULTS.filter((v) => v.id === "usdc" || v.id === "weth").map((vault) => (
          <Link
            key={vault.id}
            href={vault.comingSoon ? "#" : `/vault/${vault.id}`}
            className={`relative flex flex-row items-stretch rounded-2xl overflow-hidden transition-opacity ${vault.comingSoon ? "opacity-50 cursor-not-allowed pointer-events-none" : "hover:opacity-90"}`}
            style={{ background: "rgba(255,255,255,0.07)", border: "1px solid var(--border)" }}
          >

            {/* Left: icon + pill */}
            <div className="relative flex items-center gap-2 sm:gap-3 rounded-2xl my-2 ml-2 mr-0 px-3 py-3 sm:px-8 sm:py-8 min-w-[56%] sm:min-w-[60%]" style={{ background: "#ffffff", border: "1px solid var(--border)" }}>
              <div className="w-11 h-11 sm:w-16 sm:h-16 rounded-full overflow-hidden shrink-0 flex items-center justify-center" style={{ background: vault.iconBg }}>
                <Image src={vault.iconUrl} alt={vault.tokenSymbol} width={64} height={64} className="w-full h-full object-contain p-1" unoptimized />
              </div>
              <div className="flex items-center gap-1.5 sm:gap-3 rounded-full px-3 py-1.5 sm:px-6 sm:py-3 min-w-0" style={{ background: "#0e0e0e", border: "1px solid rgba(255,255,255,0.08)" }}>
                <span className="font-semibold text-sm sm:text-base text-white truncate">{vault.name}</span>
                <ArrowRight size={18} className="text-white opacity-70 shrink-0" />
              </div>
            </div>

            {/* Right: stats */}
            <div className="relative flex-1 flex items-center justify-center min-w-0">
              {vault.id === "usdc" ? (
                <LiveUsdcStats />
              ) : vault.id === "weth" ? (
                <LiveWethStats />
              ) : (
                <VaultStats tvl="—" apy="—" />
              )}
            </div>
          </Link>
        ))}
      </div>
      </div>
    </div>
  );
}
