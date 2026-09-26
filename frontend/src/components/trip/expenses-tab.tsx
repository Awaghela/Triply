"use client";

import { useState } from "react";
import { api, Expense, Trip, TripMember } from "@/lib/api";
import { Avatar, Badge, Button } from "@/components/ui/primitives";
import { CATEGORY_ICONS, dateLabel, money } from "@/lib/format";
import { ExpenseModal } from "@/components/expense/expense-modal";

const SPLIT_LABELS: Record<string, string> = {
  equal: "Split equally",
  percentage: "Split by percentage",
  custom: "Custom split",
  selected: "Split among selected",
};

export function ExpensesTab({
  trip,
  members,
  expenses,
  currentUserId,
  onChanged,
}: {
  trip: Trip;
  members: TripMember[];
  expenses: Expense[];
  currentUserId: string;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const memberMap = new Map(members.map((m) => [m.user_id, m]));

  async function remove(id: string) {
    await api.deleteExpense(trip.id, id);
    onChanged();
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <h2 className="font-display text-xl text-ink">Expenses</h2>
        <Button onClick={() => setOpen(true)}>+ Log expense</Button>
      </div>

      {expenses.length === 0 ? (
        <div className="mt-8 rounded-stub border border-dashed border-ink/20 py-16 text-center">
          <p className="text-ink/55">Nothing logged yet — add the first expense.</p>
        </div>
      ) : (
        <div className="mt-6 overflow-hidden rounded-xl border border-ink/10 bg-white/50">
          {expenses.map((exp) => {
            const payer = memberMap.get(exp.paid_by);
            const isOpen = expanded === exp.id;
            return (
              <div key={exp.id} className="ledger-row hairline">
                <button
                  onClick={() => setExpanded(isOpen ? null : exp.id)}
                  className="flex w-full items-center gap-4 px-4 py-3.5 text-left hover:bg-ink/[0.03]"
                >
                  <span className="text-lg">{CATEGORY_ICONS[exp.category] || "📎"}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink">{exp.description}</p>
                    <p className="text-xs text-ink/45">
                      {payer?.name || "Someone"} paid · {dateLabel(exp.created_at)}
                    </p>
                  </div>
                  <Badge tone="amber">{SPLIT_LABELS[exp.split_type]}</Badge>
                  <span className="w-24 text-right font-mono text-sm text-ink">
                    {money(exp.amount, exp.currency)}
                  </span>
                </button>

                {isOpen && (
                  <div className="border-t border-ink/10 bg-paper-dim/50 px-4 py-4">
                    <p className="mb-2 text-xs font-medium uppercase tracking-wide text-ink/40">
                      Who owes what
                    </p>
                    <div className="space-y-2">
                      {exp.splits.map((s) => {
                        const m = memberMap.get(s.user_id);
                        if (!m) return null;
                        return (
                          <div key={s.id} className="flex items-center justify-between text-sm">
                            <div className="flex items-center gap-2">
                              <Avatar name={m.name} color={m.avatar_color} size="sm" />
                              <span className="text-ink/75">
                                {m.user_id === currentUserId ? `${m.name} (you)` : m.name}
                              </span>
                            </div>
                            <span className="font-mono text-ink/70">
                              {money(s.amount, exp.currency)}
                              {s.percentage && (
                                <span className="ml-1 text-ink/40">({parseFloat(s.percentage).toFixed(1)}%)</span>
                              )}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                    {exp.notes && <p className="mt-3 text-sm italic text-ink/55">&ldquo;{exp.notes}&rdquo;</p>}
                    {exp.receipt_url && (
                      <a
                        href={exp.receipt_url}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-3 flex items-center gap-2 text-xs font-medium text-ink/60 hover:text-ink"
                      >
                        <img
                          src={exp.receipt_url}
                          alt="Receipt"
                          className="h-8 w-8 rounded object-cover"
                        />
                        View receipt
                      </a>
                    )}
                    <button
                      onClick={() => remove(exp.id)}
                      className="mt-3 text-xs font-medium text-rust-deep hover:underline"
                    >
                      Delete expense
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <ExpenseModal
        open={open}
        onClose={() => setOpen(false)}
        trip={trip}
        members={members}
        currentUserId={currentUserId}
        onCreated={onChanged}
      />
    </div>
  );
}
