"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import { X, ExternalLink, Loader2 } from "lucide-react";
import clsx from "clsx";

/// The review dialog every vault action goes through, in two phases.
///
/// Review: the amount and its consequences, and a single "Continue to
/// confirm" button — no transaction talk yet.
///
/// Signing: what is being signed right now, stated as a sentence with the
/// contract it touches (address chip → Basescan), one progress line per
/// signature, and "Step i / n — Proceed in your wallet" below. The runners
/// (handleDeposit / handleWithdraw) chain every signature in one call; this
/// dialog reflects `step` as it advances. The parent closes it on success
/// and leaves it open on error, so a failed run can be retried in place.
export type SignStep = {
  id: "wrap" | "approve" | "send";
  /// The sentence for this signature, e.g. "Allow MorphoZap to spend 100 USDC".
  title: string;
  /// The contract this signature interacts with.
  address: string;
};

export default function TxReview({
  open,
  onClose,
  mode,
  vaultName,
  icon,
  icon2,
  amount,
  tokenSymbol,
  usdValue,
  apy,
  positionShift,
  receive,
  signSteps,
  step,
  processing,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  mode: "deposit" | "withdraw";
  vaultName: string;
  icon: string;
  icon2?: string;
  amount: string;
  tokenSymbol: string;
  usdValue?: string;
  apy?: string;
  /// "current → after" for the holder's position, shown under the verb's name.
  positionShift?: string;
  /// Withdraw only: what lands in the wallet.
  receive?: string;
  /// The signatures this action will ask for, in order.
  signSteps: SignStep[];
  step: "idle" | "wrapping" | "approving" | "depositing" | "withdrawing";
  processing: boolean;
  onConfirm: () => void;
}) {
  const [phase, setPhase] = useState<"review" | "signing">("review");
  // The signature list is frozen at confirm: the approval flag flips off
  // mid-run once the allowance lands, and the progress lines must not lose a
  // segment while the run is still going.
  const frozen = useRef<SignStep[]>([]);

  useEffect(() => {
    if (!open) setPhase("review");
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !processing && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose, processing]);

  if (!open || typeof document === "undefined") return null;

  const depositing = mode === "deposit";
  const verb = depositing ? "Deposit" : "Withdraw";

  const steps = phase === "signing" && frozen.current.length > 0 ? frozen.current : signSteps;
  const activeId: SignStep["id"] | null =
    step === "wrapping" ? "wrap"
    : step === "approving" ? "approve"
    : step === "depositing" || step === "withdrawing" ? "send"
    : null;
  const activeIdx = activeId === null ? -1 : steps.findIndex((s) => s.id === activeId);
  const current = activeIdx >= 0 ? steps[activeIdx] : undefined;
  // In the signing phase with nothing in flight, the last run ended without
  // closing the dialog — that is the retry state.
  const failed = phase === "signing" && !processing && activeId === null;

  const begin = () => {
    frozen.current = signSteps;
    setPhase("signing");
    onConfirm();
  };

  const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`Review ${mode} for ${vaultName}`}
    >
      {/* The page stays visible but out of focus — the decision in front,
          its context behind. */}
      <div
        className="absolute inset-0"
        style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(8px)" }}
        onClick={() => !processing && onClose()}
      />

      <div className="glass relative w-full max-w-[540px] rounded-3xl p-6 flex flex-col gap-5 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <div className="font-bold text-lg">Review</div>
          <button
            onClick={onClose}
            disabled={processing}
            aria-label="Close"
            className="w-8 h-8 rounded-full flex items-center justify-center transition-opacity hover:opacity-70 disabled:opacity-30"
            style={{ background: "var(--bg2)", border: "1px solid var(--border)", color: "var(--text-muted)" }}
          >
            <X size={14} />
          </button>
        </div>

        {/* What is moving, into or out of which vault. */}
        <div className="rounded-2xl p-4" style={{ background: "var(--bg2)", border: "1px solid var(--border)" }}>
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold truncate">{vaultName}</span>
          </div>

          <div className="mt-4 text-xs" style={{ color: "var(--text-muted)" }}>{verb}</div>
          {/* Light weight on the figures — the app's numbers speak in
              Coinbase Sans Light. Amount, symbol and the USD pill all carry
              the amount's size, with the asset's icon closing the row. */}
          <div className="mt-1 flex items-baseline gap-2.5 flex-wrap min-w-0">
            <span className="text-3xl break-all min-w-0" style={{ fontWeight: 300 }}>{amount || "0"}</span>
            <span className="text-3xl" style={{ color: "var(--text-muted)", fontWeight: 300 }}>{tokenSymbol}</span>
            {usdValue && (
              <span className="inline-flex h-7 items-center self-center rounded-full px-3 text-sm" style={{ background: "rgba(255,255,255,0.08)", color: "var(--text-muted)", fontWeight: 300 }}>{usdValue}</span>
            )}
            <div className="flex items-center self-center ml-auto shrink-0">
              <Image src={icon} alt="" width={28} height={28} className="w-7 h-7 rounded-full object-contain" unoptimized />
              {icon2 && (
                <Image src={icon2} alt="" width={28} height={28} className="w-7 h-7 rounded-full object-contain -ml-2" unoptimized />
              )}
            </div>
          </div>

          {(apy || positionShift || receive) && (
            <div className="mt-4 pt-3 flex flex-col gap-2 border-t" style={{ borderColor: "var(--border)" }}>
              {receive && (
                <div className="flex items-center justify-between text-xs">
                  <span style={{ color: "var(--text-muted)" }}>You receive</span>
                  <span>{receive}</span>
                </div>
              )}
              {apy && (
                <div className="flex items-center justify-between text-xs">
                  <span style={{ color: "var(--text-muted)" }}>APY</span>
                  <span style={{ color: "#34D399" }}>{apy}</span>
                </div>
              )}
              {positionShift && (
                <div className="flex items-center justify-between text-xs">
                  <span style={{ color: "var(--text-muted)" }}>{verb}</span>
                  <span>{positionShift}</span>
                </div>
              )}
            </div>
          )}
        </div>

        {phase === "review" ? (
          /* Nothing about transactions yet — one door forward. */
          <button
            onClick={begin}
            className="w-full py-3 rounded-xl font-medium text-sm transition-opacity hover:opacity-80"
            style={{ background: "rgba(52,211,153,0.15)", color: "#ffffff", border: "1px solid rgba(52,211,153,0.3)" }}
          >
            Continue to confirm
          </button>
        ) : (
          <div className="flex flex-col gap-4">
            {/* What this signature does, and the contract it touches. */}
            <div className="flex items-start justify-between gap-3 min-h-[40px]">
              <div className="min-w-0">
                <div className="text-sm">
                  {failed ? "Transaction failed or was rejected" : current?.title ?? steps[0]?.title}
                </div>
                {!failed && (current ?? steps[0]) && (
                  <a
                    href={`https://basescan.org/address/${(current ?? steps[0]).address}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-2 inline-flex items-center gap-1.5 text-xs transition-opacity hover:opacity-70"
                    style={{ color: "var(--text-muted)" }}
                  >
                    {shortAddr((current ?? steps[0]).address)}
                    <ExternalLink size={11} />
                  </a>
                )}
              </div>
              {processing && <Loader2 size={18} className="animate-spin shrink-0 mt-1" style={{ color: "#34D399" }} />}
            </div>

            {/* One line per signature; the active one carries the accent. */}
            <div className="flex items-center gap-2">
              {steps.map((s, i) => (
                <div
                  key={s.id}
                  className="h-[3px] flex-1 rounded-full transition-colors"
                  style={{
                    background:
                      failed ? "rgba(248,113,113,0.5)"
                      : activeIdx >= i ? "#34D399"
                      : "rgba(255,255,255,0.15)",
                  }}
                />
              ))}
            </div>

            <div className="text-xs" style={{ color: "var(--text-muted)" }}>
              {failed
                ? "Nothing was sent, or the transaction did not go through."
                : `Step ${Math.max(1, activeIdx + 1)} / ${steps.length} — Proceed in your wallet`}
            </div>

            {failed && (
              <button
                onClick={begin}
                className="w-full py-3 rounded-xl font-medium text-sm transition-opacity hover:opacity-80"
                style={{ background: "rgba(52,211,153,0.15)", color: "#ffffff", border: "1px solid rgba(52,211,153,0.3)" }}
              >
                Try again
              </button>
            )}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
