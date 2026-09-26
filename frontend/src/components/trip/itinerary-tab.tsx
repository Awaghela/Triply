"use client";

import { useMemo, useState } from "react";
import { api, ItineraryItem } from "@/lib/api";
import { Button, Input, Modal, Select, Textarea } from "@/components/ui/primitives";
import { CATEGORY_ICONS } from "@/lib/format";

export function ItineraryTab({
  tripId,
  items,
  onChanged,
}: {
  tripId: string;
  items: ItineraryItem[];
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const byDay = useMemo(() => {
    const map = new Map<number, ItineraryItem[]>();
    for (const item of items) {
      if (!map.has(item.day_number)) map.set(item.day_number, []);
      map.get(item.day_number)!.push(item);
    }
    return Array.from(map.entries()).sort((a, b) => a[0] - b[0]);
  }, [items]);

  async function remove(itemId: string) {
    await api.deleteItineraryItem(tripId, itemId);
    onChanged();
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <h2 className="font-display text-xl text-ink">Itinerary</h2>
        <Button onClick={() => setOpen(true)}>+ Add stop</Button>
      </div>

      {items.length === 0 ? (
        <div className="mt-8 rounded-stub border border-dashed border-ink/20 py-16 text-center">
          <p className="text-ink/55">No plans yet — add the first stop.</p>
        </div>
      ) : (
        <div className="mt-6 space-y-8">
          {byDay.map(([day, dayItems]) => (
            <div key={day}>
              <div className="mb-3 flex items-center gap-3">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-ink font-mono text-xs text-paper">
                  {day}
                </span>
                <span className="text-sm font-medium text-ink/60">Day {day}</span>
              </div>
              <div className="ml-3.5 space-y-0 border-l-2 border-dashed border-ink/15 pl-6">
                {dayItems.map((item) => (
                  <div key={item.id} className="relative pb-6 last:pb-0">
                    <span className="absolute -left-[31px] top-1 h-3 w-3 rounded-full border-2 border-paper bg-amber" />
                    <div className="flex items-start justify-between gap-4 rounded-lg px-1 py-1 hover:bg-ink/[0.03]">
                      <div>
                        <p className="flex items-center gap-2 text-sm font-medium text-ink">
                          <span>{CATEGORY_ICONS[item.category] || "📎"}</span>
                          {item.title}
                        </p>
                        {item.location && <p className="mt-0.5 text-xs text-ink/50">{item.location}</p>}
                        {item.description && (
                          <p className="mt-1 text-sm text-ink/60">{item.description}</p>
                        )}
                        {item.start_time && (
                          <p className="mt-1 font-mono text-xs text-ink/40">
                            {new Date(item.start_time).toLocaleTimeString([], {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </p>
                        )}
                      </div>
                      <button
                        onClick={() => remove(item.id)}
                        className="shrink-0 rounded-full px-2 py-1 text-xs text-ink/30 hover:bg-rust-dim hover:text-rust-deep"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <AddStopModal
        open={open}
        onClose={() => setOpen(false)}
        tripId={tripId}
        onCreated={onChanged}
      />
    </div>
  );
}

function AddStopModal({
  open,
  onClose,
  tripId,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  tripId: string;
  onCreated: () => void;
}) {
  const [title, setTitle] = useState("");
  const [dayNumber, setDayNumber] = useState("1");
  const [location, setLocation] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("activity");
  const [time, setTime] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await api.createItineraryItem(tripId, {
        title,
        day_number: parseInt(dayNumber, 10) || 1,
        location: location || null,
        description: description || null,
        category,
        start_time: time ? new Date(time).toISOString() : null,
      });
      onCreated();
      setTitle("");
      setLocation("");
      setDescription("");
      setTime("");
      onClose();
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Add a stop">
      <form onSubmit={onSubmit} className="space-y-4">
        <Input label="Title" required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Alfama walking tour" />
        <div className="grid grid-cols-2 gap-3">
          <Input label="Day #" type="number" min="1" required value={dayNumber} onChange={(e) => setDayNumber(e.target.value)} />
          <Select label="Category" value={category} onChange={(e) => setCategory(e.target.value)}>
            {["activity", "food", "transport", "lodging", "shopping", "other"].map((c) => (
              <option key={c} value={c}>{CATEGORY_ICONS[c]} {c}</option>
            ))}
          </Select>
        </div>
        <Input label="Location" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Alfama, Lisbon" />
        <Input label="Time" type="datetime-local" value={time} onChange={(e) => setTime(e.target.value)} />
        <Textarea label="Notes" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
        <Button type="submit" className="w-full" disabled={loading}>
          {loading ? "Adding…" : "Add to itinerary"}
        </Button>
      </form>
    </Modal>
  );
}
