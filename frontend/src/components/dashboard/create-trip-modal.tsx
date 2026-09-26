"use client";

import { useState } from "react";
import { api, Trip } from "@/lib/api";
import { Button, Input, Modal, Textarea } from "@/components/ui/primitives";

const COVER_COLORS = ["#E4A33B", "#1F6B66", "#C0503A", "#3B5B92", "#7A5C99"];

export function CreateTripModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (trip: Trip) => void;
}) {
  const [name, setName] = useState("");
  const [destination, setDestination] = useState("");
  const [description, setDescription] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [color, setColor] = useState(COVER_COLORS[0]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const trip = await api.createTrip({
        name,
        destination: destination || null,
        description: description || null,
        start_date: startDate || null,
        end_date: endDate || null,
        cover_color: color,
      } as never);
      onCreated(trip);
      setName("");
      setDestination("");
      setDescription("");
      setStartDate("");
      setEndDate("");
      onClose();
    } catch {
      setError("Couldn't create the trip. Try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Start a new trip">
      <form onSubmit={onSubmit} className="space-y-4">
        <Input label="Trip name" required value={name} onChange={(e) => setName(e.target.value)} placeholder="Lisbon in June" />
        <Input
          label="Destination"
          value={destination}
          onChange={(e) => setDestination(e.target.value)}
          placeholder="Lisbon, Portugal"
        />
        <Textarea
          label="Description"
          rows={2}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="A week of pastéis de nata and questionable trams."
        />
        <div className="grid grid-cols-2 gap-3">
          <Input label="Start date" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          <Input label="End date" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </div>
        <div>
          <span className="mb-1.5 block text-sm font-medium text-ink/70">Cover color</span>
          <div className="flex gap-2">
            {COVER_COLORS.map((c) => (
              <button
                type="button"
                key={c}
                onClick={() => setColor(c)}
                className="h-8 w-8 rounded-full transition-transform"
                style={{
                  backgroundColor: c,
                  outline: color === c ? "2px solid #16241D" : "none",
                  outlineOffset: "2px",
                  transform: color === c ? "scale(1.05)" : "scale(1)",
                }}
                aria-label={`Choose ${c}`}
              />
            ))}
          </div>
        </div>
        {error && <p className="rounded-lg bg-rust-dim px-3 py-2 text-sm text-rust-deep">{error}</p>}
        <Button type="submit" className="w-full" disabled={loading}>
          {loading ? "Creating…" : "Create trip"}
        </Button>
      </form>
    </Modal>
  );
}
