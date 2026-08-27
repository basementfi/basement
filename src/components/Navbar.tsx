"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import { usePathname } from "next/navigation";
import Link from "next/link";
import clsx from "clsx";
import { useProtocolTvlUsd } from "@/lib/useProtocolTvl";

const TABS = [
  { label: "Core Vaults", href: "/" },
  { label: "Dashboard", href: "/dashboard" },
  { label: "Status", href: "/status" },
] as const;

export default function Navbar() {
  const pathname = usePathname();

  const activeTab =
    pathname === "/" || pathname.startsWith("/vault/") ? "Core Vaults" :
    pathname === "/dashboard" ? "Dashboard" :
    pathname === "/status" ? "Status" :
    null;

  // Aggregate TVL across all active vaults, valued in USD (matches the Status page).
  const totalTvlUsd = useProtocolTvlUsd();
  const tvl = totalTvlUsd > 0 ? `$${Math.round(totalTvlUsd).toLocaleString()}` : null;

  const tabs = (
    <>
      {TABS.map(({ label, href }) => (
        <Link
          key={label}
          href={href}
          className={clsx(
            "relative flex items-center justify-center py-3 md:py-0 text-sm font-medium transition-opacity",
            activeTab === label ? "text-white" : "hover:opacity-80"
          )}
          style={activeTab !== label ? { color: "var(--text-muted)" } : {}}
        >
          {label}
          {activeTab === label && (
            <span className="absolute bottom-0 left-0 right-0 h-[2px] rounded-full" style={{ background: "#34D399" }} />
          )}
        </Link>
      ))}
    </>
  );

  return (
    <nav className="w-full px-4">
      <div className="relative flex flex-col md:flex-row md:items-stretch md:justify-between max-w-[1440px] mx-auto w-full">
      {/* Row 1 (mobile): logo + wallet. On md+ this is just the start of the single-row layout. */}
      <div className="flex items-center justify-between w-full md:contents">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2 py-3 md:py-4 transition-opacity hover:opacity-80">
          <div className="w-8 h-8 md:w-9 md:h-9 rounded-xl flex items-center justify-center shrink-0" style={{ border: "1px solid rgba(255,255,255,0.5)", boxShadow: "0 2px 8px rgba(52,211,153,0.2)" }}>
            <svg width="22" height="22" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M 3 26 C 8 26, 12 10, 18 8 L 29 8" stroke="#34D399" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M 26 5.5 L 29 8 L 26 10.5" stroke="#34D399" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <span className="text-lg md:text-xl tracking-tight" style={{ fontWeight: 300 }}>Basement</span>
        </Link>

        {/* Tabs (md+ only) — centred on the bar itself rather than laid out
            between their neighbours, so they cannot drift sideways as the
            TVL figure changes width. */}
        <div className="hidden md:absolute md:left-1/2 md:top-0 md:bottom-0 md:-translate-x-1/2 md:flex items-stretch gap-6">
          {tabs}
        </div>

        {/* Right: TVL + wallet */}
        <div className="flex items-center gap-2 md:gap-3 py-3 md:py-4 min-w-0">
          {tvl && (
            <span className="hidden md:inline text-sm" style={{ color: "var(--text-muted)" }}>
              TVL: <span style={{ color: "var(--text)" }}>{tvl}</span>
            </span>
          )}
          <div className="hidden md:block w-px h-7 self-center" style={{ background: "var(--border)" }} />
          <div className="wallet-btn">
            <ConnectButton accountStatus="full" chainStatus="icon" showBalance={false} />
          </div>
        </div>
      </div>

      {/* Row 2 (mobile only): tabs, evenly spaced. Border is full-bleed (-mx-4) while tabs stay padded (px-4). */}
      <div className="flex md:hidden items-stretch justify-around border-t -mx-4 px-4" style={{ borderColor: "var(--border)" }}>
        {tabs}
      </div>
      </div>
    </nav>
  );
}
