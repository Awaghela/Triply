"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useRequireAuth } from "@/lib/use-require-auth";
import {
  api,
  BalanceEntry,
  Expense,
  ItineraryItem,
  SuggestedTransfer,
  Trip,
  TripMember,
  ActivityLogEntry,
  TripMetrics,
} from "@/lib/api";
import { Topbar } from "@/components/ui/topbar";
import { useTripSocket } from "@/lib/use-trip-socket";
import { dateLabel } from "@/lib/format";
import { MembersPanel } from "@/components/trip/members-panel";
import { ItineraryTab } from "@/components/trip/itinerary-tab";
import { ExpensesTab } from "@/components/trip/expenses-tab";
import { BalancesTab } from "@/components/trip/balances-tab";
import { ActivityTab } from "@/components/trip/activity-tab";
import { MetricsTab } from "@/components/trip/metrics-tab";

type TabKey = "itinerary" | "expenses" | "balances" | "activity" | "metrics";

const TABS: { key: TabKey; label: string }[] = [
  { key: "itinerary", label: "Itinerary" },
  { key: "expenses", label: "Expenses" },
  { key: "balances", label: "Balances" },
  { key: "activity", label: "Activity" },
  { key: "metrics", label: "Metrics" },
];

export default function TripPage() {
  const { tripId } = useParams<{ tripId: string }>();
  const { user, loading: authLoading } = useRequireAuth();

  const [trip, setTrip] = useState<Trip | null>(null);
  const [members, setMembers] = useState<TripMember[]>([]);
  const [itinerary, setItinerary] = useState<ItineraryItem[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [balances, setBalances] = useState<BalanceEntry[]>([]);
  const [transfers, setTransfers] = useState<SuggestedTransfer[]>([]);
  const [activity, setActivity] = useState<ActivityLogEntry[]>([]);
  const [metrics, setMetrics] = useState<TripMetrics | null>(null);
  const [tab, setTab] = useState<TabKey>("itinerary");
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    if (!tripId) return;
    const [tripData, memberData, itineraryData, expenseData, balanceData, activityData, metricsData] =
      await Promise.all([
        api.getTrip(tripId),
        api.listMembers(tripId),
        api.listItinerary(tripId),
        api.listExpenses(tripId),
        api.getBalances(tripId),
        api.listActivity(tripId),
        api.getMetrics(tripId),
      ]);
    setTrip(tripData);
    setMembers(memberData);
    setItinerary(itineraryData);
    setExpenses(expenseData);
    setBalances(balanceData.balances);
    setTransfers(balanceData.suggested_transfers);
    setActivity(activityData);
    setMetrics(metricsData);
    setLoaded(true);
  }, [tripId]);

  useEffect(() => {
    if (user) refresh().catch(() => setLoaded(true));
  }, [user, refresh]);

  // Live updates: any create/delete from any member refreshes this view.
  useTripSocket(tripId, () => {
    refresh().catch(() => {});
  });

  if (authLoading || !user || !loaded || !trip) {
    return <div className="flex min-h-screen items-center justify-center text-ink/40">Loading trip…</div>;
  }

  const memberNames = new Map(members.map((m) => [m.user_id, m.name]));

  return (
    <main className="min-h-screen">
      <Topbar tripName={trip.name} />

      <div className="border-b border-ink/10" style={{ backgroundColor: `${trip.cover_color}14` }}>
        <div className="mx-auto max-w-6xl px-6 py-8">
          <p className="font-mono text-xs text-ink/45">
            {trip.destination?.toUpperCase() || "TRIP"}
          </p>
          <h1 className="mt-1 font-display text-3xl text-ink">{trip.name}</h1>
          {(trip.start_date || trip.description) && (
            <p className="mt-2 text-sm text-ink/60">
              {trip.start_date && (
                <span className="font-mono">
                  {dateLabel(trip.start_date)}
                  {trip.end_date ? ` – ${dateLabel(trip.end_date)}` : ""} ·{" "}
                </span>
              )}
              {trip.description}
            </p>
          )}
          <div className="mt-5">
            <MembersPanel tripId={trip.id} members={members} onChanged={refresh} />
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-6">
        <div className="flex gap-1 overflow-x-auto border-b border-ink/10 py-3">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`whitespace-nowrap rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                tab === t.key ? "bg-ink text-paper" : "text-ink/55 hover:bg-ink/5 hover:text-ink"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="py-8">
          {tab === "itinerary" && (
            <ItineraryTab tripId={trip.id} items={itinerary} onChanged={refresh} />
          )}
          {tab === "expenses" && (
            <ExpensesTab
              trip={trip}
              members={members}
              expenses={expenses}
              currentUserId={user.id}
              onChanged={refresh}
            />
          )}
          {tab === "balances" && (
            <BalancesTab
              trip={trip}
              balances={balances}
              transfers={transfers}
              currentUserId={user.id}
              onChanged={refresh}
            />
          )}
          {tab === "activity" && (
            <ActivityTab tripId={trip.id} entries={activity} memberNames={memberNames} />
          )}
          {tab === "metrics" && metrics && <MetricsTab metrics={metrics} currency={trip.currency} />}
        </div>
      </div>
    </main>
  );
}
