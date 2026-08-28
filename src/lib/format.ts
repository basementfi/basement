export function fmt6(raw: bigint | undefined, decimals = 2): string {
  const v = raw == null ? 0 : Number(raw) / 1e6;
  return v.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

/// Decimal-aware amount formatter with thousands separators — e.g. 1,000.00.
/// `tokenDecimals` is the token's on-chain decimals (6 for USDC, 18 for WETH);
/// `displayDecimals` is how many to show.
export function fmtUnits(raw: bigint | undefined, tokenDecimals: number, displayDecimals = 2): string {
  const v = raw == null ? 0 : Number(raw) / 10 ** tokenDecimals;
  return v.toLocaleString(undefined, { minimumFractionDigits: displayDecimals, maximumFractionDigits: displayDecimals });
}

/// Numeric value of a raw token amount (e.g. 1_500000 @ 6 decimals -> 1.5).
export function toUnits(raw: bigint | undefined, tokenDecimals: number): number {
  if (raw === undefined || raw === null) return 0;
  return Number(raw) / 10 ** tokenDecimals;
}

/// Parse a human-typed amount string into base units, without float rounding
/// (parseFloat * 1e18 loses precision for 18-decimal tokens).
export function parseAmount(value: string, tokenDecimals: number): bigint {
  if (!value) return 0n;
  const [whole = "", frac = ""] = value.split(".");
  const cleanWhole = whole.replace(/[^0-9]/g, "") || "0";
  const cleanFrac = (frac.replace(/[^0-9]/g, "") + "0".repeat(tokenDecimals)).slice(0, tokenDecimals);
  return BigInt(cleanWhole) * 10n ** BigInt(tokenDecimals) + BigInt(cleanFrac || "0");
}

export function formatUsdc(raw: bigint | undefined): string {
  if (raw === undefined) return "0.00";
  return (Number(raw) / 1e6).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 });
}

/// Full USD format with thousands separators and 2 decimals — e.g. $1,000.00, $1,234,567.89.
/// (No K/M abbreviation.)
export function fmtUsd(n: number): string {
  return `$${(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
