"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";

const FAQS = [
  {
    q: "What is Basement?",
    a: "Basement is the easiest way to earn yield on Base. Deposit a single asset into a vault and it's put to work automatically — Earn vaults supply to Morpho lending markets, and LP vaults provide auto-compounding liquidity on Aerodrome. Every vault is a standard ERC-4626 token, so your position stays liquid and composable while Basement handles the swaps, compounding, and fee collection.",
  },
  {
    q: "How are rewards distributed?",
    a: "Yield accrues directly into the value of your vault shares: as the vault earns, each share is worth more of the underlying asset. If you hold 10% of the vault, 10% of everything it earns is yours — realised whenever you withdraw. There's nothing to claim.",
  },
  {
    q: "Are there any fees?",
    a: "A 10% performance fee on earned yield only — never on your principal, and no deposit or withdrawal fees. (LP-vault harvests also pay a 1% fee to whoever triggers the harvest.) Beyond that you only pay standard Base network gas.",
  },
  {
    q: "Is there a lock-up period?",
    a: "No. You can deposit and withdraw at any time, and redemptions stay open even if deposits are paused. LP vaults also let you withdraw as a single token or as the raw LP position.",
  },
  {
    q: "Which wallets are supported?",
    a: "Coinbase Wallet, MetaMask, Rainbow Wallet, and any WalletConnect-compatible wallet. Make sure your wallet is connected to Base Mainnet.",
  },
  {
    q: "Who controls the funds — and is it audited?",
    a: "Basement is non-custodial: you always hold your ERC-4626 shares and can redeem them at any time. Every vault is owned by a Safe multisig (2-of-3) with two-step ownership, so no single key can move or trap funds. The contracts were reviewed with multi-agent adversarial audits before deployment — see the docs for addresses and details.",
  },
];

export default function FAQ() {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <div className="flex flex-col gap-6 max-w-2xl mx-auto w-full">
      <div className="flex flex-col gap-2 mb-2">
        <h2 className="text-3xl" style={{ fontWeight: 300 }}>FAQ</h2>
      </div>

      <div className="flex flex-col gap-3">
        {FAQS.map((faq, i) => (
          <div
            key={i}
            className="rounded-2xl overflow-hidden"
            style={{ background: "#212121" }}
            
          >
            <button
              onClick={() => setOpen(open === i ? null : i)}
              className="w-full flex items-center justify-between px-5 py-4 text-left"
            >
              <span className="min-w-0 font-medium text-sm">{faq.q}</span>
              <span className="ml-4 shrink-0" style={{ color: "var(--text-muted)" }}>
                {open === i ? <X size={16} /> : <Plus size={16} />}
              </span>
            </button>
            {open === i && (
              <div className="px-5 pb-4 text-sm leading-relaxed" style={{ color: "var(--text-muted)", borderTop: "1px solid var(--border)" }}>
                <div className="pt-3">{faq.a}</div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
