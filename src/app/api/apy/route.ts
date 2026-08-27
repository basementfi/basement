import { NextResponse } from "next/server";
import { MORPHO_VAULT_ADDRESS } from "@/lib/contracts";

const MORPHO_API = "https://blue-api.morpho.org/graphql";
const CHAIN_ID = 8453; // Base

export const revalidate = 300; // cache 5 minutes

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
  // Optional ?vault=<morpho vault address>; defaults to EarnUSDC's Morpho vault.
  const { searchParams } = new URL(req.url);
  const vaultParam = searchParams.get("vault");
  const VAULT_ADDRESS = /^0x[a-fA-F0-9]{40}$/.test(vaultParam ?? "") ? vaultParam : MORPHO_VAULT_ADDRESS;

  try {
    // 1) Try Morpho V1 (MetaMorpho) vaults.
    const v1 = await gql(`{
      vaultByAddress(address: "${VAULT_ADDRESS}", chainId: ${CHAIN_ID}) {
        state { avgNetApy(lookback: SIX_HOURS) }
      }
    }`);
    const v1Apy = v1?.data?.vaultByAddress?.state?.avgNetApy;
    if (typeof v1Apy === "number") return NextResponse.json({ apy: v1Apy * 100 });

    // 2) Fall back to Morpho V2 vaults (e.g. Gauntlet WETH Balanced), which the
    //    V1 query returns NOT_FOUND for.
    const v2 = await gql(`{
      vaultV2ByAddress(address: "${VAULT_ADDRESS}", chainId: ${CHAIN_ID}) {
        avgNetApy
      }
    }`);
    const v2Apy = v2?.data?.vaultV2ByAddress?.avgNetApy;
    if (typeof v2Apy === "number") return NextResponse.json({ apy: v2Apy * 100 });

    return NextResponse.json({ apy: null });
  } catch {
    return NextResponse.json({ apy: null });
  }
}
