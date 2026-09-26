# Triply

Collaborative trip planning and shared-expense management. Plan an itinerary
together, log expenses as you go, split them four different ways, and see a
live, tamper-evident record of who owes whom.

**Live demo:** [triply-gamma-nine.vercel.app](https://triply-gamma-nine.vercel.app) ·

**Stack:** Rust (Axum) · PostgreSQL · Next.js / TypeScript · Tailwind · Docker

```
┌─────────────┐      REST + WS      ┌──────────────┐      SQL       ┌────────────┐
│  Next.js UI │ ──────────────────▶ │ Axum backend │ ─────────────▶ │ PostgreSQL │
│  (TS/React) │ ◀────────────────── │   (Rust)     │ ◀───────────── │            │
└─────────────┘                     └──────┬───────┘                └────────────┘
                                           │ presigned PUT
                                           ▼
                                     ┌─────────────┐
                                     │   AWS S3    │  (receipt images, optional)
                                     └─────────────┘
```

## Highlights

- **Four expense-splitting modes** — equal, percentage, custom, and
  selected-members — computed server-side with exact-cent rounding so splits
  always sum to the original amount (`backend/src/splits.rs`, unit tested).
- **Idempotent writes** — every expense/settlement POST requires an
  `Idempotency-Key` header. Retried requests (double-tap, flaky network,
  proxy retry) replay the original response instead of creating a duplicate
  row, enforced inside the same DB transaction as the write
  (`backend/src/idempotency.rs`).
- **Tamper-evident activity log** — every expense, settlement, and
  membership change is appended to `activity_log` as a link in an
  HMAC-SHA256 hash chain. The `/trips/:id/activity/verify` endpoint
  recomputes the whole chain from genesis and reports the first broken link,
  if any (`backend/src/hashchain.rs`).
- **Role-based access control** — owner / admin / member roles gate
  destructive and administrative actions per trip (`backend/src/authz.rs`).
- **Live updates** — a lightweight WebSocket channel broadcasts
  create/delete events per trip so every open tab refreshes without polling.
- **No compile-time DB dependency** — every query uses sqlx's runtime API
  (`sqlx::query`/`query_as` + `.bind(...)`) rather than the `query!`/
  `query_as!` macros, so `cargo build`/`docker build` never need a live
  Postgres connection or a committed `.sqlx` offline cache. A DB connection
  is only required when the binary actually runs.
- **Receipt uploads without an AWS SDK** — a ~100-line hand-rolled SigV4
  presigner (`backend/src/s3_presign.rs`) generates presigned S3 PUT URLs
  using only `hmac`/`sha2`, instead of pulling in `aws-sdk-s3`/`aws-config`,
  which bump their MSRV aggressively and were pulling in Rust-edition-2024
  transitive deps that broke reproducible builds. When no AWS credentials
  are configured, uploads fall back automatically to local disk storage
  (`backend/src/local_uploads.rs`) served back over plain HTTP — enough to
  click through the whole receipt-upload flow with zero cloud setup. This
  fallback is a dev/testing convenience only (no signature check on the
  upload URL, just an unguessable path); set real `AWS_S3_BUCKET` +
  credentials for anything beyond your own machine.
- **Auto-settle suggestions** — a greedy min-transaction algorithm turns a
  tangle of individual debts into the smallest set of "who pays whom"
  transfers (`backend/src/balances.rs`, unit tested).

## Project layout

```
backend/     Rust/Axum API — models, handlers, migrations, unit tests
frontend/    Next.js app — dashboard, trip workspace, expense modal, charts
bench/       Seed script, idempotency retry tests, latency benchmark
docker-compose.yml
```

## Running it

```bash
git clone https://github.com/Awaghela/Triply.git
cd Triply
```

### Quickest path: Docker Compose

```bash
cp backend/.env.example backend/.env   # edit secrets if you like
docker compose up --build
```

- Frontend: http://localhost:3000
- Backend: http://localhost:8080
- Postgres: localhost:5432 (user/pass/db: `triply`)

Migrations run automatically on backend startup.

### Local development (no Docker)

**Backend** — requires a reasonably current stable Rust (1.75+ comfortably
covers everything here; if in doubt, `rustup update stable`).

```bash
cd backend
cp .env.example .env
# start a local Postgres however you like, then:
docker run -d --name triply-pg -e POSTGRES_USER=triply -e POSTGRES_PASSWORD=triply \
  -e POSTGRES_DB=triply -p 5432:5432 postgres:16-alpine

cargo install sqlx-cli --no-default-features --features postgres,rustls
cargo sqlx database create
cargo sqlx migrate run

cargo run
```

> This project uses sqlx's **runtime** query API (`sqlx::query`/`query_as`
> with `.bind(...)`), not the `query!`/`query_as!` macros — so building it
> never needs a live database connection or an offline query cache. A
> connection is only needed once the binary actually _runs_ (to execute
> migrations and serve requests).

Run the unit tests (split calculation, hash chain, settlement suggestions —
no DB required):

```bash
cargo test
```

**Frontend**

```bash
cd frontend
cp .env.local.example .env.local
npm install
npm run dev
```

## Seeding data, retry tests, and benchmarks

With the backend running (`docker compose up` or `cargo run`):

```bash
cd bench

# 20 trips, 12 users, 500+ expenses across all four split modes
node seed.mjs
```

The seed script also creates a dedicated `demo@triply.demo` / `password123`
account and adds it as a member of **every** seeded trip — log in as that
one to see the whole dataset from a single dashboard (the 12 regular seeded
users each only belong to a random 3–6 of the 20 trips, which is more
realistic but not what you want when demoing "500+ expenses, 20+ trips").

```bash
# 5 scenarios × concurrent/sequential/mismatched-body retries
# (50+ individual retry requests) — asserts zero duplicate writes
node retry-test.mjs

# p50/p95/p99 latency across the main read endpoints
node latency-bench.mjs
```

`retry-test.mjs` is the automated version of "prevented duplicate writes
across 50+ retry tests" — it exercises concurrent identical retries,
sequential retries, and the reused-key-different-body error case, and fails
the process (non-zero exit) if any scenario leaves more than one row
persisted.

## API overview

All endpoints except `/auth/*` and `/health` require `Authorization: Bearer
<jwt>`. Full request/response shapes are in `backend/src/models.rs` and the
handler modules under `backend/src/handlers/`.

| Method   | Path                                | Notes                                                           |
| -------- | ----------------------------------- | --------------------------------------------------------------- |
| POST     | `/auth/register` / `/auth/login`    | Returns `{ token, user }`                                       |
| GET      | `/trips`                            | Trips the caller belongs to                                     |
| POST     | `/trips`                            | Creates a trip; caller becomes owner                            |
| GET/POST | `/trips/:id/members`                | List / invite (by email)                                        |
| DELETE   | `/trips/:id/members/:userId`        | Admin/owner only                                                |
| GET/POST | `/trips/:id/itinerary`              | Day-by-day stops                                                |
| GET/POST | `/trips/:id/expenses`               | **Requires `Idempotency-Key`**                                  |
| DELETE   | `/trips/:id/expenses/:id`           | Soft delete                                                     |
| GET      | `/trips/:id/balances`               | Net balances + suggested transfers                              |
| GET/POST | `/trips/:id/settlements`            | **Requires `Idempotency-Key`**                                  |
| GET      | `/trips/:id/activity`               | Hash-chained event log                                          |
| GET      | `/trips/:id/activity/verify`        | Recomputes & verifies the chain                                 |
| GET      | `/trips/:id/metrics`                | Totals, by-category, by-day                                     |
| POST     | `/trips/:id/receipts/presign`       | Upload target for a receipt photo (S3 or local disk, see below) |
| PUT      | `/local-uploads/:trip_id/:filename` | Local-mode upload target (only used when S3 isn't configured)   |
| GET      | `/uploads/...`                      | Serves local-mode receipt photos back                           |
| GET      | `/ws?trip_id=...`                   | Live event stream                                               |

## Design notes

The UI leans on a "travel document" visual language instead of a generic
SaaS dashboard — ticket-stub cards with perforated dividers, a ledger-style
expense list, Fraunces for display type paired with Inter for UI text, and
an ink/paper/amber/teal palette. See `frontend/tailwind.config.ts` and
`frontend/src/app/globals.css`.

## Security notes for production use

- Set real, random values for `JWT_SECRET` and `ACTIVITY_HMAC_SECRET`
  (`openssl rand -hex 32`) — the repo defaults are for local dev only.
- `CorsLayer::permissive()` in `main.rs` is intentionally wide open for the
  demo; restrict it to your frontend's origin before deploying.
- The HMAC secret for the activity log must stay server-side only; anyone
  who obtains it can forge a valid-looking chain.
