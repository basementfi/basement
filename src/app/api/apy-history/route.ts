import { NextResponse } from "next/server";
import { MORPHO_VAULT_ADDRESS } from "@/lib/contracts";

const MORPHO_API = "https://blue-api.morpho.org/graphql";
const CHAIN_ID = 8453;

export const revalidate = 300;

async function gql(query: string) {
  const res = await fetch(MORPHO_API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
    next: { revalidate: 300 },
  });
  return res.json();
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const range = searchParams.get("range") ?? "1M";
  // Optional ?vault=<morpho vault address>; defaults to EarnUSDC's Morpho vault.
  const vaultParam = searchParams.get("vault");
  const VAULT_ADDRESS = /^0x[a-fA-F0-9]{40}$/.test(vaultParam ?? "") ? vaultParam : MORPHO_VAULT_ADDRESS;

  const now = Math.floor(Date.now() / 1000);
  const rangeSeconds: Record<string, number> = {
    "1D": 86400,
    "1W": 604800,
    "1M": 2592000,
    "1Y": 31536000,
    "All": 31536000 * 3,
  };
  const interval: Record<string, string> = {
    "1D": "HOUR",
    "1W": "DAY",
    "1M": "DAY",
    "1Y": "WEEK",
    "All": "WEEK",
  };

  const startTimestamp = now - (rangeSeconds[range] ?? rangeSeconds["1M"]);
  const iv = interval[range] ?? "DAY";

  try {
    // 1) Morpho V1 (MetaMorpho)
    const v1 = await gql(`{
      vaultByAddress(address: "${VAULT_ADDRESS}", chainId: ${CHAIN_ID}) {
        historicalState {
          netApy(options: { startTimestamp: ${startTimestamp}, interval: ${iv} }) { x y }
        }
      }
    }`);
    let points = v1?.data?.vaultByAddress?.historicalState?.netApy ?? [];

    // 2) Morpho V2 fallback
    if (!points.length) {
      const v2 = await gql(`{
        vaultV2ByAddress(address: "${VAULT_ADDRESS}", chainId: ${CHAIN_ID}) {
          historicalState {
            avgNetApy(options: { startTimestamp: ${startTimestamp}, interval: ${iv} }, lookbackHours: 24) { x y }
          }
        }
      }`);
      points = v2?.data?.vaultV2ByAddress?.historicalState?.avgNetApy ?? [];
    }

    const result = points.map((p: { x: number; y: number }) => ({
      timestamp: p.x,
      apy: p.y * 100,
    }));

    return NextResponse.json({ data: result });
  } catch {
    return NextResponse.json({ data: [] });
  }
}
