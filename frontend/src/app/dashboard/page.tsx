"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRequireAuth } from "@/lib/use-require-auth";
import { api, Trip } from "@/lib/api";
import { Topbar } from "@/components/ui/topbar";
import { Button } from "@/components/ui/primitives";
import { dateLabel } from "@/lib/format";
import { CreateTripModal } from "@/components/dashboard/create-trip-modal";

export default function DashboardPage() {
  const { user, loading } = useRequireAuth();
  const [trips, setTrips] = useState<Trip[] | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  useEffect(() => {
    if (!user) return;
    api.listTrips().then(setTrips).catch(() => setTrips([]));
  }, [user]);

  if (loading || !user) {
    return <div className="flex min-h-screen items-center justify-center text-ink/40">Loading…</div>;
  }

  return (
    <main className="min-h-screen">
      <Topbar />
      <div className="mx-auto max-w-6xl px-6 py-10">
        <div className="flex items-end justify-between">
          <div>
            <p className="font-mono text-xs text-ink/45">{trips?.length ?? 0} trip{trips?.length === 1 ? "" : "s"}</p>
            <h1 className="mt-1 font-display text-3xl text-ink">
              {greeting()}, {user.name.split(" ")[0]}
            </h1>
          </div>
          <Button onClick={() => setModalOpen(true)}>+ New trip</Button>
        </div>

        {trips === null ? (
          <div className="mt-16 text-center text-ink/40">Loading trips…</div>
        ) : trips.length === 0 ? (
          <EmptyState onCreate={() => setModalOpen(true)} />
        ) : (
          <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {trips.map((trip) => (
              <TripCard key={trip.id} trip={trip} />
            ))}
          </div>
        )}
      </div>

      <CreateTripModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onCreated={(trip) => setTrips((prev) => [trip, ...(prev ?? [])])}
      />
    </main>
  );
}

function greeting() {
  const h = new Date().getHours();
  if (h < 5) return "Still up";
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

function TripCard({ trip }: { trip: Trip }) {
  return (
    <Link
      href={`/trips/${trip.id}`}
      className="group ticket-notch relative block overflow-hidden rounded-stub border border-ink/10 bg-white/60 p-5 shadow-stub transition-all hover:-translate-y-0.5 hover:shadow-card"
    >
      <div
        className="absolute inset-x-0 top-0 h-1.5"
        style={{ backgroundColor: trip.cover_color }}
      />
      <p className="font-mono text-[10px] tracking-wide text-ink/40">
        {trip.destination?.toUpperCase() || "TRIP"}
      </p>
      <h3 className="mt-1 font-display text-xl text-ink group-hover:underline decoration-1 underline-offset-4">
        {trip.name}
      </h3>
      {trip.description && (
        <p className="mt-2 line-clamp-2 text-sm text-ink/55">{trip.description}</p>
      )}
      <div className="perforated my-4" />
      <div className="flex items-center justify-between text-xs text-ink/45">
        <span>
          {trip.start_date ? dateLabel(trip.start_date) : "No dates yet"}
          {trip.end_date ? ` – ${dateLabel(trip.end_date)}` : ""}
        </span>
        <span className="font-mono">{trip.currency}</span>
      </div>
    </Link>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="mt-16 rounded-stub border border-dashed border-ink/20 py-20 text-center">
      <p className="font-display text-2xl text-ink">No trips yet</p>
      <p className="mx-auto mt-2 max-w-sm text-sm text-ink/55">
        Create one to start building an itinerary and tracking who paid for what.
      </p>
      <Button className="mt-6" onClick={onCreate}>
        + Create your first trip
      </Button>
    </div>
  );
}
