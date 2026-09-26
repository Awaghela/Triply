"use client";

import { useMemo, useState } from "react";
import { api, SplitType, Trip, TripMember } from "@/lib/api";
import { Avatar, Button, Input, Modal, Select, Textarea } from "@/components/ui/primitives";
import { CATEGORY_ICONS } from "@/lib/format";

const SPLIT_TABS: { value: SplitType; label: string; hint: string }[] = [
  { value: "equal", label: "Equal", hint: "Split evenly across everyone selected." },
  { value: "percentage", label: "Percentage", hint: "Give each person a share that adds to 100%." },
  { value: "custom", label: "Custom", hint: "Type the exact amount each person owes." },
  { value: "selected", label: "Selected", hint: "Equal split, but only among people who were there." },
];

const CATEGORIES = ["food", "lodging", "transport", "activity", "shopping", "other"];

export function ExpenseModal({
  open,
  onClose,
  trip,
  members,
  currentUserId,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  trip: Trip;
  members: TripMember[];
  currentUserId: string;
  onCreated: () => void;
}) {
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("food");
  const [paidBy, setPaidBy] = useState(currentUserId);
  const [splitType, setSplitType] = useState<SplitType>("equal");
  const [participants, setParticipants] = useState<Set<string>>(
    new Set(members.map((m) => m.user_id))
  );
  const [percentages, setPercentages] = useState<Record<string, string>>({});
  const [customAmounts, setCustomAmounts] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [receiptPreview, setReceiptPreview] = useState<string | null>(null);
  const [receiptUrl, setReceiptUrl] = useState<string | null>(null);
  const [receiptUploading, setReceiptUploading] = useState(false);
  const [receiptError, setReceiptError] = useState<string | null>(null);

  const amountNum = parseFloat(amount) || 0;
  const activeParticipants = members.filter((m) => participants.has(m.user_id));

  const preview = useMemo(() => {
    if (!amountNum || activeParticipants.length === 0) return [];
    if (splitType === "equal" || splitType === "selected") {
      const each = amountNum / activeParticipants.length;
      return activeParticipants.map((m) => ({ member: m, amount: each }));
    }
    if (splitType === "percentage") {
      return activeParticipants.map((m) => {
        const pct = parseFloat(percentages[m.user_id] || "0");
        return { member: m, amount: (amountNum * pct) / 100, pct };
      });
    }
    return activeParticipants.map((m) => ({
      member: m,
      amount: parseFloat(customAmounts[m.user_id] || "0"),
    }));
  }, [amountNum, activeParticipants, splitType, percentages, customAmounts]);

  const percentageTotal = activeParticipants.reduce(
    (sum, m) => sum + (parseFloat(percentages[m.user_id] || "0") || 0),
    0
  );
  const customTotal = activeParticipants.reduce(
    (sum, m) => sum + (parseFloat(customAmounts[m.user_id] || "0") || 0),
    0
  );

  function toggleParticipant(userId: string) {
    setParticipants((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  }

  async function onPickReceipt(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // let picking the same file again re-trigger onChange
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setReceiptError("Please pick an image file.");
      return;
    }

    setReceiptError(null);
    setReceiptPreview(URL.createObjectURL(file));
    setReceiptUrl(null);
    setReceiptUploading(true);
    try {
      const url = await api.uploadReceipt(trip.id, file);
      setReceiptUrl(url);
    } catch {
      setReceiptError("Couldn't upload the photo. Try again.");
      clearReceipt();
    } finally {
      setReceiptUploading(false);
    }
  }

  function clearReceipt() {
    if (receiptPreview) URL.revokeObjectURL(receiptPreview);
    setReceiptPreview(null);
    setReceiptUrl(null);
    setReceiptError(null);
  }

  function validationError(): string | null {
    if (!description.trim()) return "Give the expense a description.";
    if (!amountNum || amountNum <= 0) return "Enter an amount greater than zero.";
    if (activeParticipants.length === 0) return "Select at least one participant.";
    if (receiptUploading) return "The receipt photo is still uploading — hang on a second.";
    if (splitType === "percentage" && Math.abs(percentageTotal - 100) > 0.01)
      return `Percentages must add up to 100% (currently ${percentageTotal.toFixed(1)}%).`;
    if (splitType === "custom" && Math.abs(customTotal - amountNum) > 0.005)
      return `Custom amounts must add up to ${amountNum.toFixed(2)} (currently ${customTotal.toFixed(2)}).`;
    return null;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const validation = validationError();
    if (validation) {
      setError(validation);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const splits = activeParticipants.map((m) => {
        if (splitType === "percentage") return { user_id: m.user_id, value: percentages[m.user_id] || "0" };
        if (splitType === "custom") return { user_id: m.user_id, value: customAmounts[m.user_id] || "0" };
        return { user_id: m.user_id, value: null };
      });

      await api.createExpense(trip.id, {
        description: description.trim(),
        amount: amountNum.toFixed(2),
        currency: trip.currency,
        category,
        paid_by: paidBy,
        split_type: splitType,
        splits,
        notes: notes.trim() || null,
        receipt_url: receiptUrl,
      });

      onCreated();
      resetForm();
      onClose();
    } catch {
      setError("Couldn't save the expense. Check the split and try again.");
    } finally {
      setLoading(false);
    }
  }

  function resetForm() {
    setDescription("");
    setAmount("");
    setCategory("food");
    setSplitType("equal");
    setPercentages({});
    setCustomAmounts({});
    setNotes("");
    clearReceipt();
  }

  return (
    <Modal open={open} onClose={onClose} title="Log an expense" wide>
      <form onSubmit={onSubmit} className="space-y-5">
        <div className="grid grid-cols-[1fr,140px] gap-3">
          <Input
            label="What was it for?"
            required
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Dinner at Time Out Market"
          />
          <Input
            label={`Amount (${trip.currency})`}
            required
            type="number"
            min="0.01"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Select label="Category" value={category} onChange={(e) => setCategory(e.target.value)}>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_ICONS[c]} {c[0].toUpperCase() + c.slice(1)}
              </option>
            ))}
          </Select>
          <Select label="Paid by" value={paidBy} onChange={(e) => setPaidBy(e.target.value)}>
            {members.map((m) => (
              <option key={m.user_id} value={m.user_id}>
                {m.user_id === currentUserId ? `${m.name} (you)` : m.name}
              </option>
            ))}
          </Select>
        </div>

        <div>
          <span className="mb-1.5 block text-sm font-medium text-ink/70">Split</span>
          <div className="flex flex-wrap gap-1.5 rounded-full bg-ink/5 p-1">
            {SPLIT_TABS.map((tab) => (
              <button
                type="button"
                key={tab.value}
                onClick={() => setSplitType(tab.value)}
                className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${
                  splitType === tab.value ? "bg-ink text-paper" : "text-ink/60 hover:text-ink"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-xs text-ink/45">
            {SPLIT_TABS.find((t) => t.value === splitType)?.hint}
          </p>
        </div>

        <div className="rounded-xl border border-ink/10 bg-white/50 p-4">
          <div className="space-y-2.5">
            {members.map((m) => {
              const included = participants.has(m.user_id);
              const showToggle = splitType === "selected";
              const row = preview.find((p) => p.member.user_id === m.user_id);
              return (
                <div
                  key={m.user_id}
                  className={`flex items-center gap-3 rounded-lg px-2 py-1.5 transition-opacity ${
                    !included ? "opacity-40" : ""
                  }`}
                >
                  {showToggle && (
                    <input
                      type="checkbox"
                      checked={included}
                      onChange={() => toggleParticipant(m.user_id)}
                      className="h-4 w-4 accent-ink"
                    />
                  )}
                  <Avatar name={m.name} color={m.avatar_color} size="sm" />
                  <span className="flex-1 text-sm text-ink/80">
                    {m.user_id === currentUserId ? `${m.name} (you)` : m.name}
                  </span>

                  {splitType === "percentage" && included && (
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        min="0"
                        max="100"
                        step="0.1"
                        value={percentages[m.user_id] || ""}
                        onChange={(e) =>
                          setPercentages((p) => ({ ...p, [m.user_id]: e.target.value }))
                        }
                        className="w-16 rounded-md border border-ink/15 bg-white px-2 py-1 text-right text-sm"
                        placeholder="0"
                      />
                      <span className="text-xs text-ink/45">%</span>
                    </div>
                  )}

                  {splitType === "custom" && included && (
                    <div className="flex items-center gap-1">
                      <span className="text-xs text-ink/45">{trip.currency}</span>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={customAmounts[m.user_id] || ""}
                        onChange={(e) =>
                          setCustomAmounts((c) => ({ ...c, [m.user_id]: e.target.value }))
                        }
                        className="w-20 rounded-md border border-ink/15 bg-white px-2 py-1 text-right text-sm"
                        placeholder="0.00"
                      />
                    </div>
                  )}

                  {(splitType === "equal" || splitType === "selected") && included && (
                    <span className="font-mono text-sm text-ink/60">
                      {row ? row.amount.toFixed(2) : "0.00"}
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          {splitType === "percentage" && (
            <p
              className={`mt-3 text-right text-xs font-medium ${
                Math.abs(percentageTotal - 100) < 0.01 ? "text-teal-deep" : "text-rust-deep"
              }`}
            >
              {percentageTotal.toFixed(1)}% of 100%
            </p>
          )}
          {splitType === "custom" && (
            <p
              className={`mt-3 text-right text-xs font-medium ${
                Math.abs(customTotal - amountNum) < 0.005 ? "text-teal-deep" : "text-rust-deep"
              }`}
            >
              {trip.currency} {customTotal.toFixed(2)} of {amountNum.toFixed(2)}
            </p>
          )}
        </div>

        <div>
          <span className="mb-1.5 block text-sm font-medium text-ink/70">Receipt (optional)</span>
          {receiptPreview ? (
            <div className="flex items-center gap-3 rounded-xl border border-ink/10 bg-white/50 p-3">
              <img
                src={receiptPreview}
                alt="Receipt preview"
                className="h-16 w-16 rounded-lg object-cover"
              />
              <div className="min-w-0 flex-1">
                {receiptUploading ? (
                  <p className="text-sm text-ink/60">Uploading…</p>
                ) : receiptUrl ? (
                  <p className="text-sm text-teal-deep">Attached</p>
                ) : (
                  <p className="text-sm text-rust-deep">Upload failed</p>
                )}
              </div>
              <button
                type="button"
                onClick={clearReceipt}
                className="rounded-full px-3 py-1.5 text-xs font-medium text-ink/50 hover:bg-ink/5 hover:text-ink"
              >
                Remove
              </button>
            </div>
          ) : (
            <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-ink/25 bg-white/30 py-4 text-sm text-ink/55 hover:border-ink/40 hover:text-ink/75">
              <span>+ Add a receipt photo</span>
              <input type="file" accept="image/*" className="hidden" onChange={onPickReceipt} />
            </label>
          )}
          {receiptError && <p className="mt-1.5 text-xs text-rust-deep">{receiptError}</p>}
        </div>

        <Textarea
          label="Notes (optional)"
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Split the pastéis de nata evenly, obviously."
        />

        {error && <p className="rounded-lg bg-rust-dim px-3 py-2 text-sm text-rust-deep">{error}</p>}

        <div className="flex gap-3">
          <Button type="button" variant="secondary" onClick={onClose} className="flex-1">
            Cancel
          </Button>
          <Button type="submit" className="flex-1" disabled={loading}>
            {loading ? "Saving…" : "Save expense"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
