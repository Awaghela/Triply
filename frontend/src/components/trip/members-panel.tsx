"use client";

import { useState } from "react";
import { api, TripMember } from "@/lib/api";
import { Avatar, Badge, Button, Input, Modal } from "@/components/ui/primitives";

export function MembersPanel({
  tripId,
  members,
  onChanged,
}: {
  tripId: string;
  members: TripMember[];
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-xl border border-ink/10 bg-white/50 p-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-ink/70">
          {members.length} member{members.length === 1 ? "" : "s"}
        </p>
        <button onClick={() => setOpen(true)} className="text-xs font-medium text-ink/60 hover:text-ink">
          + Invite
        </button>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {members.map((m) => (
          <div key={m.id} className="flex items-center gap-1.5 rounded-full bg-ink/5 py-1 pl-1 pr-2.5">
            <Avatar name={m.name} color={m.avatar_color} size="sm" />
            <span className="text-xs text-ink/70">{m.name}</span>
            {m.role !== "member" && (
              <Badge tone={m.role === "owner" ? "amber" : "teal"}>{m.role}</Badge>
            )}
          </div>
        ))}
      </div>

      <InviteModal tripId={tripId} open={open} onClose={() => setOpen(false)} onInvited={onChanged} />
    </div>
  );
}

function InviteModal({
  tripId,
  open,
  onClose,
  onInvited,
}: {
  tripId: string;
  open: boolean;
  onClose: () => void;
  onInvited: () => void;
}) {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setStatus(null);
    try {
      const result = (await api.inviteMember(tripId, email)) as { status: string };
      setStatus(
        result.status === "added"
          ? `${email} was added to the trip.`
          : `${email} doesn't have an account yet — they'll join once they sign up with this email.`
      );
      onInvited();
      setEmail("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't send the invite.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Invite someone">
      <form onSubmit={onSubmit} className="space-y-4">
        <Input
          label="Email address"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="friend@example.com"
        />
        {status && <p className="rounded-lg bg-teal-dim px-3 py-2 text-sm text-teal-deep">{status}</p>}
        {error && <p className="rounded-lg bg-rust-dim px-3 py-2 text-sm text-rust-deep">{error}</p>}
        <Button type="submit" className="w-full" disabled={loading}>
          {loading ? "Sending…" : "Send invite"}
        </Button>
      </form>
    </Modal>
  );
}
