#!/usr/bin/env node
/**
 * Minimal API latency benchmark. Run `seed.mjs` first so there's a
 * meaningful amount of data (hundreds of expenses) to read back.
 *
 * Measures p50/p95/p99 for the read paths that matter most in the UI
 * (expense list, balances, metrics) under light concurrency.
 *
 * Usage:
 *   API_URL=http://localhost:8080 node bench/latency-bench.mjs
 */

// See the matching comment in seed.mjs: strips a trailing slash so
// `${API_URL}${path}` never produces a double-slash 404.
const API_URL = (process.env.API_URL || "http://localhost:8080").replace(/\/+$/, "");
const REQUESTS_PER_ENDPOINT = 100;
const CONCURRENCY = 10;

function percentile(sorted, p) {
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

async function timed(fn) {
  const start = performance.now();
  await fn();
  return performance.now() - start;
}

async function runBatch(label, fn, count, concurrency) {
  const durations = [];
  let inFlight = 0;
  let started = 0;

  await new Promise((resolve, reject) => {
    function launch() {
      if (started >= count && inFlight === 0) return resolve();
      while (inFlight < concurrency && started < count) {
        started++;
        inFlight++;
        timed(fn)
          .then((d) => durations.push(d))
          .catch(reject)
          .finally(() => {
            inFlight--;
            launch();
          });
      }
    }
    launch();
  });

  durations.sort((a, b) => a - b);
  const p50 = percentile(durations, 50);
  const p95 = percentile(durations, 95);
  const p99 = percentile(durations, 99);
  console.log(
    `  ${label.padEnd(28)} p50=${p50.toFixed(1)}ms  p95=${p95.toFixed(1)}ms  p99=${p99.toFixed(1)}ms  (n=${durations.length})`
  );
  return { label, p50, p95, p99 };
}

async function api(path, token, opts = {}) {
  const res = await fetch(`${API_URL}${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return res.json();
}

async function main() {
  console.log(`Benchmarking ${API_URL} (run bench/seed.mjs first for realistic data volume) ...`);

  const email = "priya@triply.demo"; // seeded by seed.mjs
  let token;
  try {
    ({ token } = await api("/auth/login", null, {
      method: "POST",
      body: JSON.stringify({ email, password: "password123" }),
    }));
  } catch {
    console.error("Couldn't log in as a seeded user. Run `node bench/seed.mjs` first.");
    process.exit(1);
  }

  const trips = await api("/trips", token);
  if (trips.length === 0) {
    console.error("No trips found. Run `node bench/seed.mjs` first.");
    process.exit(1);
  }
  const tripId = trips[0].id;

  const results = [];
  results.push(
    await runBatch("GET /trips", () => api("/trips", token), REQUESTS_PER_ENDPOINT, CONCURRENCY)
  );
  results.push(
    await runBatch(
      "GET /trips/:id/expenses",
      () => api(`/trips/${tripId}/expenses`, token),
      REQUESTS_PER_ENDPOINT,
      CONCURRENCY
    )
  );
  results.push(
    await runBatch(
      "GET /trips/:id/balances",
      () => api(`/trips/${tripId}/balances`, token),
      REQUESTS_PER_ENDPOINT,
      CONCURRENCY
    )
  );
  results.push(
    await runBatch(
      "GET /trips/:id/metrics",
      () => api(`/trips/${tripId}/metrics`, token),
      REQUESTS_PER_ENDPOINT,
      CONCURRENCY
    )
  );
  results.push(
    await runBatch(
      "GET /trips/:id/activity",
      () => api(`/trips/${tripId}/activity`, token),
      REQUESTS_PER_ENDPOINT,
      CONCURRENCY
    )
  );

  const overallP50 = results.reduce((s, r) => s + r.p50, 0) / results.length;
  console.log(`\nOverall median across endpoints: ${overallP50.toFixed(1)}ms`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
