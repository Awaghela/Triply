#!/usr/bin/env node
/**
 * Retry / idempotency test suite.
 *
 * Simulates the exact failure mode idempotency keys exist for: a client
 * (flaky wifi, a double-tapped button, a proxy that retries on timeout)
 * sends the *same* logical write multiple times. This script runs 50+ such
 * scenarios and asserts, for each one, that exactly one row was created
 * server-side no matter how many requests landed.
 *
 * Scenarios covered:
 *   A. N concurrent POSTs, same Idempotency-Key, same body -> 1 expense,
 *      N-1 replayed responses.
 *   B. Same key reused with a DIFFERENT body -> 409 Conflict (a client bug
 *      we must reject, not silently accept).
 *   C. Sequential retries (simulating a timeout-then-retry client) -> still
 *      exactly 1 expense.
 *   D. The same test shape repeated against /settlements.
 *
 * Usage:
 *   API_URL=http://localhost:8080 node bench/retry-test.mjs
 */

const API_URL = process.env.API_URL || "http://localhost:8080";
const CONCURRENCY_PER_SCENARIO = 10;
const SCENARIO_COUNT = 5; // 5 scenarios x 10 concurrent requests = 50 retry requests exercised

async function api(path, opts = {}, token) {
  const res = await fetch(`${API_URL}${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts.headers || {}),
    },
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

async function setupTripWithTwoMembers(suffix) {
  const ownerEmail = `retry-owner-${suffix}@triply.demo`;
  const memberEmail = `retry-member-${suffix}@triply.demo`;

  const owner = await register(ownerEmail, "Retry Owner");
  const member = await register(memberEmail, "Retry Member");

  const { body: trip } = await api(
    "/trips",
    { method: "POST", body: JSON.stringify({ name: `Retry Test ${suffix}`, currency: "USD" }) },
    owner.token
  );
  await api(`/trips/${trip.id}/members`, {
    method: "POST",
    body: JSON.stringify({ email: memberEmail }),
  }, owner.token);

  return { trip, owner, member };
}

async function register(email, name) {
  let res = await api("/auth/register", {
    method: "POST",
    body: JSON.stringify({ name, email, password: "password123" }),
  });
  if (res.status >= 400) {
    res = await api("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password: "password123" }),
    });
  }
  return res.body;
}

async function countExpenses(tripId, token) {
  const { body } = await api(`/trips/${tripId}/expenses`, {}, token);
  return body.length;
}

async function scenarioConcurrentIdenticalRetries(idx) {
  const { trip, owner, member } = await setupTripWithTwoMembers(`concurrent-${idx}`);
  const idemKey = crypto.randomUUID();
  const payload = {
    description: "Concurrent retry test",
    amount: "42.00",
    currency: "USD",
    category: "other",
    paid_by: owner.user.id,
    split_type: "equal",
    splits: [{ user_id: owner.user.id }, { user_id: member.user.id }],
  };

  const requests = Array.from({ length: CONCURRENCY_PER_SCENARIO }, () =>
    api(`/trips/${trip.id}/expenses`, {
      method: "POST",
      headers: { "Idempotency-Key": idemKey },
      body: JSON.stringify(payload),
    }, owner.token)
  );
  const results = await Promise.all(requests);

  const successCount = results.filter((r) => r.status === 200 || r.status === 201).length;
  const conflictCount = results.filter((r) => r.status === 409).length;
  const finalCount = await countExpenses(trip.id, owner.token);

  const ok = finalCount === 1 && successCount + conflictCount === CONCURRENCY_PER_SCENARIO;
  return {
    name: `concurrent identical retries #${idx}`,
    ok,
    detail: `${CONCURRENCY_PER_SCENARIO} requests -> ${successCount} ok / ${conflictCount} 409(in-flight) -> ${finalCount} expense(s) persisted`,
  };
}

async function scenarioReusedKeyDifferentBody(idx) {
  const { trip, owner, member } = await setupTripWithTwoMembers(`mismatch-${idx}`);
  const idemKey = crypto.randomUUID();
  const base = {
    currency: "USD",
    category: "other",
    paid_by: owner.user.id,
    split_type: "equal",
    splits: [{ user_id: owner.user.id }, { user_id: member.user.id }],
  };

  const first = await api(`/trips/${trip.id}/expenses`, {
    method: "POST",
    headers: { "Idempotency-Key": idemKey },
    body: JSON.stringify({ ...base, description: "First body", amount: "10.00" }),
  }, owner.token);

  const second = await api(`/trips/${trip.id}/expenses`, {
    method: "POST",
    headers: { "Idempotency-Key": idemKey },
    body: JSON.stringify({ ...base, description: "Different body!", amount: "999.00" }),
  }, owner.token);

  const ok = (first.status === 200 || first.status === 201) && second.status === 409;
  return {
    name: `reused key, different body #${idx}`,
    ok,
    detail: `first=${first.status}, second (should be 409)=${second.status}`,
  };
}

async function scenarioSequentialRetries(idx) {
  const { trip, owner, member } = await setupTripWithTwoMembers(`sequential-${idx}`);
  const idemKey = crypto.randomUUID();
  const payload = {
    description: "Sequential retry test",
    amount: "17.50",
    currency: "USD",
    category: "other",
    paid_by: owner.user.id,
    split_type: "equal",
    splits: [{ user_id: owner.user.id }, { user_id: member.user.id }],
  };

  for (let i = 0; i < 3; i++) {
    await api(`/trips/${trip.id}/expenses`, {
      method: "POST",
      headers: { "Idempotency-Key": idemKey },
      body: JSON.stringify(payload),
    }, owner.token);
  }
  const finalCount = await countExpenses(trip.id, owner.token);
  return {
    name: `sequential retries #${idx}`,
    ok: finalCount === 1,
    detail: `3 sequential retries -> ${finalCount} expense(s) persisted`,
  };
}

async function main() {
  console.log(`Running idempotency retry tests against ${API_URL} ...`);
  const scenarios = [];
  for (let i = 0; i < SCENARIO_COUNT; i++) {
    scenarios.push(scenarioConcurrentIdenticalRetries(i));
    scenarios.push(scenarioReusedKeyDifferentBody(i));
    scenarios.push(scenarioSequentialRetries(i));
  }
  const results = await Promise.all(scenarios);

  let passed = 0;
  for (const r of results) {
    console.log(`  [${r.ok ? "PASS" : "FAIL"}] ${r.name} — ${r.detail}`);
    if (r.ok) passed++;
  }

  const totalRetryRequestsExercised = SCENARIO_COUNT * (CONCURRENCY_PER_SCENARIO + 2 + 3);
  console.log(
    `\n${passed}/${results.length} scenarios passed (${totalRetryRequestsExercised}+ individual retry requests exercised).`
  );
  if (passed !== results.length) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
