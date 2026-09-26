import Link from "next/link";

const SPLIT_MODES = [
  { name: "Equal", detail: "Divide the bill evenly across everyone on the trip." },
  { name: "Percentage", detail: "Assign each person a share that adds to 100%." },
  { name: "Custom", detail: "Type the exact amount each person owes." },
  { name: "Selected", detail: "Only charge the people who were actually there." },
];

const HOW_IT_WORKS = [
  {
    n: 1,
    title: "Create the trip",
    detail: "Invite the group by email. Everyone lands on the same itinerary and the same ledger — no separate spreadsheets floating around.",
  },
  {
    n: 2,
    title: "Log as you go",
    detail: "Snap the receipt, split it however it actually happened, and keep planning. Every change shows up for the group in real time.",
  },
  {
    n: 3,
    title: "Settle up once",
    detail: "Triply works out the smallest set of payments to zero everyone out, and keeps a record of who paid what that no one can quietly edit.",
  },
];

export default function Home() {
  return (
    <main className="min-h-screen">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-6 py-7">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 -rotate-6 items-center justify-center rounded-md bg-ink text-paper">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path d="M3 12l7-9v6h11l-7 9v-6H3z" fill="currentColor" />
            </svg>
          </div>
          <span className="font-display text-xl font-medium">Triply</span>
        </div>
        <nav className="flex items-center gap-3">
          <Link href="/login" className="rounded-full px-4 py-2 text-sm font-medium text-ink/70 hover:text-ink">
            Log in
          </Link>
          <Link
            href="/register"
            className="rounded-full bg-ink px-4 py-2 text-sm font-medium text-paper hover:bg-ink-700"
          >
            Start a trip
          </Link>
        </nav>
      </header>

      <section className="mx-auto grid max-w-5xl gap-12 px-6 pb-20 pt-10 md:grid-cols-[1.1fr,0.9fr] md:items-center">
        <div>
          <p className="mb-5 font-mono text-xs tracking-wide text-ink/50">
            group trips · shared expenses · one ledger
          </p>
          <h1 className="font-display text-[2.75rem] leading-[1.08] text-ink sm:text-6xl">
            Plan the trip.
            <br />
            Skip the awkward math.
          </h1>
          <p className="mt-6 max-w-md text-lg leading-relaxed text-ink/65">
            Triply keeps the itinerary, the receipts, and who-owes-who in one
            place, so the only thing left to argue about is the window seat.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-4">
            <Link
              href="/register"
              className="rounded-full bg-ink px-6 py-3 text-[15px] font-medium text-paper hover:bg-ink-700"
            >
              Create your first trip
            </Link>
            <Link href="/login" className="text-[15px] font-medium text-ink/70 underline underline-offset-4 hover:text-ink">
              I already have an account
            </Link>
          </div>
        </div>

        <div className="relative mx-auto w-full max-w-sm animate-rise-in">
          <div className="ticket-notch rounded-stub border border-ink/10 bg-white/70 p-6 shadow-card">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-mono text-[11px] text-ink/45">TRIP</p>
                <p className="font-display text-xl">Lisbon, June</p>
              </div>
              <span className="-rotate-6 rounded border-2 border-teal px-2 py-1 font-mono text-[10px] font-semibold text-teal">
                CONFIRMED
              </span>
            </div>
            <div className="perforated my-5" />
            <div className="space-y-3">
              {[
                { who: "Priya paid", what: "Alfama walking tour", amt: "€64.00" },
                { who: "You paid", what: "Dinner at Time Out Market", amt: "€138.50" },
                { who: "Marco paid", what: "Tuk-tuk to Belém", amt: "€22.00" },
              ].map((row) => (
                <div key={row.what} className="flex items-center justify-between text-sm">
                  <div>
                    <p className="text-ink/85">{row.what}</p>
                    <p className="text-xs text-ink/45">{row.who}</p>
                  </div>
                  <p className="font-mono text-ink/70">{row.amt}</p>
                </div>
              ))}
            </div>
            <div className="perforated my-5" />
            <div className="flex items-center justify-between">
              <p className="text-sm text-ink/60">You&apos;re owed</p>
              <p className="font-display text-2xl text-teal-deep">€41.75</p>
            </div>
          </div>
        </div>
      </section>

      <section className="border-y border-ink/10 bg-paper-dim/60 py-16">
        <div className="mx-auto max-w-5xl px-6">
          <h2 className="font-display text-2xl text-ink">Four ways to split a bill, because trips aren&apos;t tidy</h2>
          <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {SPLIT_MODES.map((mode) => (
              <div key={mode.name} className="rounded-xl border border-ink/10 bg-paper p-5">
                <p className="font-display text-lg text-ink">{mode.name}</p>
                <p className="mt-2 text-sm leading-relaxed text-ink/60">{mode.detail}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-6 py-16">
        <h2 className="font-display text-2xl text-ink">How it works</h2>
        <div className="relative mt-10 grid gap-8 sm:grid-cols-3">
          <div className="hidden sm:block absolute left-0 right-0 top-5 border-t-[1.5px] border-dashed border-ink/15" />
          {HOW_IT_WORKS.map((step) => (
            <div key={step.n} className="relative">
              <div className="relative flex h-10 w-10 items-center justify-center rounded-full border-2 border-ink bg-paper font-mono text-sm text-ink">
                {step.n}
              </div>
              <p className="mt-4 font-display text-lg text-ink">{step.title}</p>
              <p className="mt-1.5 text-sm leading-relaxed text-ink/60">{step.detail}</p>
            </div>
          ))}
        </div>
      </section>

      <footer className="mx-auto max-w-5xl px-6 pb-10 text-xs text-ink/40">
        Triply — a collaborative trip &amp; expense demo built with Axum, PostgreSQL, and Next.js.
      </footer>
    </main>
  );
}
