"use client";

import { useState } from "react";
import { api, BalanceEntry, SuggestedTransfer, Trip } from "@/lib/api";
import { Avatar, Button, Modal } from "@/components/ui/primitives";
import { money } from "@/lib/format";

export function BalancesTab({
  trip,
  balances,
  transfers,
  currentUserId,
  onChanged,
}: {
  trip: Trip;
  balances: BalanceEntry[];
  transfers: SuggestedTransfer[];
  currentUserId: string;
  onChanged: () => void;
}) {
  const [settling, setSettling] = useState<SuggestedTransfer | null>(null);
  const allSettled = balances.every((b) => Math.abs(parseFloat(b.net)) < 0.005);

  return (
    <div>
      <h2 className="font-display text-xl text-ink">Balances</h2>

      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        {balances.map((b) => {
          const net = parseFloat(b.net);
          const isYou = b.user_id === currentUserId;
          return (
            <div
              key={b.user_id}
              className="flex items-center justify-between rounded-xl border border-ink/10 bg-white/50 px-4 py-3.5"
            >
              <div className="flex items-center gap-3">
                <Avatar name={b.name} color={b.avatar_color} />
                <span className="text-sm font-medium text-ink">
                  {isYou ? `${b.name} (you)` : b.name}
                </span>
              </div>
              <div className="text-right">
                <p
                  className={`font-mono text-sm font-semibold ${
                    net > 0.005 ? "text-teal-deep" : net < -0.005 ? "text-rust-deep" : "text-ink/40"
                  }`}
                >
                  {net > 0.005 ? "+" : ""}
                  {money(net, trip.currency)}
                </p>
                <p className="text-[11px] text-ink/40">
                  {net > 0.005 ? "is owed" : net < -0.005 ? "owes" : "settled up"}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-10">
        <h3 className="font-display text-lg text-ink">Suggested settle-up</h3>
        {allSettled ? (
          <p className="mt-3 text-sm text-ink/55">Everyone&apos;s square. Nothing to settle.</p>
        ) : (
          <div className="mt-4 space-y-2.5">
            {transfers.map((t, i) => (
              <div
                key={i}
                className="flex items-center justify-between rounded-xl border border-ink/10 bg-white/50 px-4 py-3"
              >
                <p className="text-sm text-ink/80">
                  <span className="font-medium">{t.from_name}</span> pays{" "}
                  <span className="font-medium">{t.to_name}</span>
                </p>
                <div className="flex items-center gap-3">
                  <span className="font-mono text-sm text-ink">{money(t.amount, trip.currency)}</span>
                  <Button variant="secondary" onClick={() => setSettling(t)} className="!px-3 !py-1.5 text-xs">
                    Record
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {settling && (
        <SettleModal
          trip={trip}
          transfer={settling}
          onClose={() => setSettling(null)}
          onSettled={() => {
            setSettling(null);
            onChanged();
          }}
        />
      )}
    </div>
  );
}

function SettleModal({
  trip,
  transfer,
  onClose,
  onSettled,
}: {
  trip: Trip;
  transfer: SuggestedTransfer;
  onClose: () => void;
  onSettled: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setLoading(true);
    setError(null);
    try {
      await api.createSettlement(trip.id, {
        from_user: transfer.from_user,
        to_user: transfer.to_user,
        amount: transfer.amount,
        note: "Recorded from suggested settle-up",
      });
      onSettled();
    } catch {
      setError("Couldn't record the settlement. Try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="Record settlement">
      <p className="text-sm text-ink/70">
        Mark that <span className="font-medium text-ink">{transfer.from_name}</span> paid{" "}
        <span className="font-medium text-ink">{transfer.to_name}</span>{" "}
        <span className="font-mono font-medium text-ink">{money(transfer.amount, trip.currency)}</span>{" "}
        outside the app (cash, bank transfer, etc). This just updates the ledger.
      </p>
      {error && <p className="mt-3 rounded-lg bg-rust-dim px-3 py-2 text-sm text-rust-deep">{error}</p>}
      <div className="mt-6 flex gap-3">
        <Button variant="secondary" onClick={onClose} className="flex-1">
          Cancel
        </Button>
        <Button onClick={confirm} disabled={loading} className="flex-1">
          {loading ? "Recording…" : "Confirm settled"}
        </Button>
      </div>
    </Modal>
  );
}
