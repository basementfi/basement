"use client";

import { useState, useEffect } from "react";

/// Live net APY for a Morpho vault. Pass the underlying Morpho vault address to
/// fetch a specific vault's APY; omit it to use the default (EarnUSDC's vault).
export function useMorphoApy(morphoVault?: string): { apy: number | null; loading: boolean } {
  const [apy, setApy] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const url = morphoVault ? `/api/apy?vault=${morphoVault}` : "/api/apy";
    fetch(url)
      .then((r) => r.json())
      .then((d) => { if (!cancelled) setApy(d.apy ?? null); })
      .catch(() => { if (!cancelled) setApy(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [morphoVault]);

  return { apy, loading };
}
