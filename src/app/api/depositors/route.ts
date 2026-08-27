import { NextResponse } from "next/server";
import { EARN_USDC_ADDRESS, MORPHO_VAULT_ADDRESS } from "@/lib/contracts";

const ALCHEMY_URL = `https://base-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_KEY}`;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
// Compared against lowercased `from` addresses below, so normalise the checksummed constants.
const EXCLUDED = new Set([
  ZERO_ADDRESS,
  EARN_USDC_ADDRESS.toLowerCase(),
  MORPHO_VAULT_ADDRESS.toLowerCase(),
]);

export async function GET() {
  const unique = new Set<string>();
  let pageKey: string | undefined;

  try {
    do {
      const body: Record<string, unknown> = {
        jsonrpc: "2.0",
        id: 1,
        method: "alchemy_getAssetTransfers",
        params: [{
          fromBlock: "0x0",
          toBlock: "latest",
          toAddress: EARN_USDC_ADDRESS,
          category: ["erc20"],
          withMetadata: false,
          excludeZeroValue: true,
          maxCount: "0x3e8",
          ...(pageKey ? { pageKey } : {}),
        }],
      };

      const res = await fetch(ALCHEMY_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      const result = data?.result;
      if (!result) break;

      for (const tx of result.transfers ?? []) {
        const from = tx.from?.toLowerCase();
        const asset = tx.asset;
        // Only count real USDC deposits from user wallets
        if (from && asset === "USDC" && !EXCLUDED.has(from)) {
          unique.add(from);
        }
      }

      pageKey = result.pageKey;
    } while (pageKey);
  } catch {
    return NextResponse.json({ count: 0 });
  }

  return NextResponse.json({ count: unique.size });
}
