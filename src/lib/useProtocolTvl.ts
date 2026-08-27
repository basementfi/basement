"use client";

import { useReadContract } from "wagmi";
import { VAULTS } from "@/lib/vaults";
import {
  EARN_USDC_ADDRESS, EARN_ETH_ADDRESS, EARN_BTC_ADDRESS,
  MORPHO_VAULT_ADDRESS, MORPHO_WETH_VAULT_ADDRESS, MORPHO_CBBTC_VAULT_ADDRESS,
  MORPHO_VAULT_ABI, AERO_LP_ABI, AERO_ZAP_ADDRESS, AERO_ZAP_ABI,
  ETH_USD_FEED, BTC_USD_FEED, CHAINLINK_ABI,
} from "@/lib/contracts";

// Protocol-wide TVL for one Morpho-wrapper vault: the underlying value EarnX holds in its
// Morpho vault. Same reads as the per-vault cards, so react-query dedupes them.
function useMorphoVaultTvl(earnAddr: `0x${string}`, morphoAddr: `0x${string}`) {
  const { data: morphoShares } = useReadContract({ address: morphoAddr, abi: MORPHO_VAULT_ABI, functionName: "balanceOf", args: [earnAddr] });
  const { data: liveTvl } = useReadContract({ address: morphoAddr, abi: MORPHO_VAULT_ABI, functionName: "convertToAssets", args: morphoShares ? [morphoShares] : undefined, query: { enabled: !!morphoShares } });
  return liveTvl as bigint | undefined;
}

// Protocol-wide TVL for one Aerodrome LP vault, in the deposit token's units (via BasementAeroZap).
function useLpVaultTvl(vault: typeof VAULTS[number]) {
  const lp = vault.lp!;
  const vaultAddr = vault.contractAddress as `0x${string}`;
  const { data: totalSupply } = useReadContract({ address: vaultAddr, abi: AERO_LP_ABI, functionName: "totalSupply" });
  const { data: tvl } = useReadContract({ address: AERO_ZAP_ADDRESS, abi: AERO_ZAP_ABI, functionName: "valueOfSharesInToken", args: totalSupply !== undefined ? [vaultAddr, totalSupply, lp.depositToken as `0x${string}`] : undefined, query: { enabled: totalSupply !== undefined && totalSupply > 0n } });
  return tvl as bigint | undefined;
}

/// Aggregate TVL across ALL active vaults, valued in USD (Chainlink for WETH/cbBTC legs).
/// Mirrors the Status page's LiveTvlSummary so the header and Status agree. Components that
/// haven't loaded contribute 0, so the value fills in as reads resolve.
export function useProtocolTvlUsd(): number {
  const { data: ethFeed } = useReadContract({ address: ETH_USD_FEED, abi: CHAINLINK_ABI, functionName: "latestRoundData" });
  const { data: btcFeed } = useReadContract({ address: BTC_USD_FEED, abi: CHAINLINK_ABI, functionName: "latestRoundData" });
  const ethPrice = ethFeed !== undefined ? Number(ethFeed[1]) / 1e8 : undefined;
  const btcPrice = btcFeed !== undefined ? Number(btcFeed[1]) / 1e8 : undefined;

  const usdcTvl = useMorphoVaultTvl(EARN_USDC_ADDRESS, MORPHO_VAULT_ADDRESS);
  const wethTvl = useMorphoVaultTvl(EARN_ETH_ADDRESS, MORPHO_WETH_VAULT_ADDRESS);
  const earnBtcTvl = useMorphoVaultTvl(EARN_BTC_ADDRESS, MORPHO_CBBTC_VAULT_ADDRESS);

  const lpAeroVault = VAULTS.find((v) => v.id === "lp-aero-usdc")!;
  const lpWethVault = VAULTS.find((v) => v.id === "lp-weth-cbbtc")!;
  const lpAeroTvl = useLpVaultTvl(lpAeroVault); // USDC-denominated (6dp)
  const lpWethTvl = useLpVaultTvl(lpWethVault); // WETH-denominated (18dp)

  return (
    (usdcTvl !== undefined ? Number(usdcTvl) / 1e6 : 0) +
    (wethTvl !== undefined && ethPrice !== undefined ? (Number(wethTvl) / 1e18) * ethPrice : 0) +
    (earnBtcTvl !== undefined && btcPrice !== undefined ? (Number(earnBtcTvl) / 1e8) * btcPrice : 0) +
    (lpAeroTvl !== undefined ? Number(lpAeroTvl) / 1e6 : 0) +
    (lpWethTvl !== undefined && ethPrice !== undefined ? (Number(lpWethTvl) / 1e18) * ethPrice : 0)
  );
}
