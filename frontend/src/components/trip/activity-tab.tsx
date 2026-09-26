"use client";

import { useEffect, useState } from "react";
import { api, ActivityLogEntry } from "@/lib/api";
import { Badge } from "@/components/ui/primitives";
import { ACTION_LABELS, relativeTime } from "@/lib/format";

export function ActivityTab({
  tripId,
  entries,
  memberNames,
}: {
  tripId: string;
  entries: ActivityLogEntry[];
  memberNames: Map<string, string>;
}) {
  const [verification, setVerification] = useState<
    { valid: boolean; entries_checked: number; first_broken_seq: number | null } | null
  >(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    verify();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripId, entries.length]);

  async function verify() {
    setChecking(true);
    try {
      const result = await api.verifyActivity(tripId);
      setVerification(result);
    } catch {
      setVerification(null);
    } finally {
      setChecking(false);
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-xl text-ink">Activity log</h2>
        <div className="flex items-center gap-2">
          {checking ? (
            <Badge>Verifying chain…</Badge>
          ) : verification ? (
            <Badge tone={verification.valid ? "teal" : "rust"}>
              {verification.valid
                ? `✓ Hash chain verified (${verification.entries_checked} events)`
                : `⚠ Tampering detected at event #${verification.first_broken_seq}`}
            </Badge>
          ) : null}
        </div>
      </div>
      <p className="mt-1.5 text-xs text-ink/45">
        Every event below is chained with HMAC-SHA256 to the one before it — editing history
        without the server&apos;s secret key breaks the chain.
      </p>

      <div className="mt-6 space-y-0">
        {entries.length === 0 ? (
          <p className="py-8 text-center text-sm text-ink/45">No activity yet.</p>
        ) : (
          entries.map((entry) => (
            <div key={entry.id} className="flex items-start gap-4 border-b border-ink/10 py-3.5 last:border-none">
              <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-amber" />
              <div className="min-w-0 flex-1">
                <p className="text-sm text-ink/80">
                  <span className="font-medium text-ink">
                    {entry.actor_id ? memberNames.get(entry.actor_id) || "Someone" : "System"}
                  </span>{" "}
                  {ACTION_LABELS[entry.action] || entry.action}
                </p>
                <p className="mt-0.5 font-mono text-[11px] text-ink/35">
                  #{entry.seq} · hash {entry.hash.slice(0, 10)}… · {relativeTime(entry.created_at)}
                </p>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
