#!/usr/bin/env node
/**
 * Seeds the running Triply API with a realistic dataset:
 *   - 12 users
 *   - 20 trips, each with 3-6 members drawn from the user pool
 *   - 500+ expenses spread across those trips, cycling through all four
 *     split modes, plus a handful of settlements per trip
 *
 * Usage:
 *   API_URL=http://localhost:8080 node bench/seed.mjs
 */

const API_URL = process.env.API_URL || "http://localhost:8080";

const FIRST_NAMES = [
  "Priya", "Marco", "Elena", "Jonah", "Aisha", "Diego",
  "Freya", "Kenji", "Naledi", "Oscar", "Talia", "Wes",
];
const DESTINATIONS = [
  "Lisbon, Portugal", "Kyoto, Japan", "Banff, Canada", "Cape Town, South Africa",
  "Oaxaca, Mexico", "Reykjavik, Iceland", "Queenstown, New Zealand", "Hoi An, Vietnam",
  "Split, Croatia", "Marrakesh, Morocco", "Palermo, Italy", "Ubud, Indonesia",
  "Tbilisi, Georgia", "Valparaíso, Chile", "Jaipur, India", "Faroe Islands",
  "Chiang Mai, Thailand", "Ljubljana, Slovenia", "Bergen, Norway", "Antigua, Guatemala",
];
const EXPENSE_TEMPLATES = [
  { desc: "Group dinner", cat: "food" },
  { desc: "Hostel — 3 nights", cat: "lodging" },
  { desc: "Airport transfer", cat: "transport" },
  { desc: "Walking tour", cat: "activity" },
  { desc: "Market souvenirs", cat: "shopping" },
  { desc: "Groceries", cat: "food" },
  { desc: "Train tickets", cat: "transport" },
  { desc: "Museum entry", cat: "activity" },
  { desc: "Coffee run", cat: "food" },
  { desc: "Car rental", cat: "transport" },
];
const SPLIT_TYPES = ["equal", "percentage", "custom", "selected"];

function rand(n) {
  return Math.floor(Math.random() * n);
}
function pick(arr) {
  return arr[rand(arr.length)];
}
function money(min, max) {
  return (min + Math.random() * (max - min)).toFixed(2);
}

async function api(path, opts = {}, token) {
  const res = await fetch(`${API_URL}${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${opts.method || "GET"} ${path} -> ${res.status}: ${body}`);
  }
  return res.status === 204 ? null : res.json();
}

async function main() {
  console.log(`Seeding ${API_URL} ...`);

  // 1. Create users
  const users = [];
  for (const name of FIRST_NAMES) {
    const email = `${name.toLowerCase()}@triply.demo`;
    let token, user;
    try {
      const res = await api("/auth/register", {
        method: "POST",
        body: JSON.stringify({ name, email, password: "password123" }),
      });
      token = res.token;
      user = res.user;
    } catch {
      const res = await api("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password: "password123" }),
      });
      token = res.token;
      user = res.user;
    }
    users.push({ id: user.id, name, email, token });
  }
  console.log(`  ${users.length} users ready`);

  // 2. Create 20 trips, each owned by a random user, with 3-6 members
  const trips = [];
  for (let i = 0; i < DESTINATIONS.length; i++) {
    const owner = pick(users);
    const trip = await api(
      "/trips",
      {
        method: "POST",
        body: JSON.stringify({
          name: `${DESTINATIONS[i].split(",")[0]} Trip`,
          destination: DESTINATIONS[i],
          description: "Seeded demo trip.",
          currency: "USD",
        }),
      },
      owner.token
    );

    const memberCount = 3 + rand(4); // 3-6
    const shuffled = [...users].sort(() => Math.random() - 0.5);
    const invitees = shuffled.filter((u) => u.email !== owner.email).slice(0, memberCount - 1);
    for (const m of invitees) {
      await api(`/trips/${trip.id}/members`, {
        method: "POST",
        body: JSON.stringify({ email: m.email }),
      }, owner.token);
    }

    // Re-fetch membership so every member carries their real user_id
    // (invites are keyed by email; this is the source of truth afterward).
    const memberRows = await api(`/trips/${trip.id}/members`, {}, owner.token);
    const members = memberRows.map((row) => ({
      id: row.user_id,
      name: row.name,
      email: row.email,
      token: users.find((u) => u.email === row.email)?.token,
    }));

    trips.push({ trip, owner, members });
  }
  console.log(`  ${trips.length} trips created`);

  // 3. Spread 500+ expenses across trips
  let expenseCount = 0;
  const targetExpenses = 520;
  while (expenseCount < targetExpenses) {
    const { trip, members } = pick(trips);
    const payer = pick(members);
    const template = pick(EXPENSE_TEMPLATES);
    const splitType = pick(SPLIT_TYPES);
    const amount = money(8, 260);
    const participantCount = Math.max(2, Math.min(members.length, 2 + rand(members.length - 1)));
    const participants = [...members].sort(() => Math.random() - 0.5).slice(0, participantCount);

    let splits;
    if (splitType === "percentage") {
      const base = Math.floor(100 / participants.length);
      let remainder = 100 - base * participants.length;
      splits = participants.map((p) => {
        const value = base + (remainder-- > 0 ? 1 : 0);
        return { user_id: p.id, value: String(value) };
      });
    } else if (splitType === "custom") {
      const each = (parseFloat(amount) / participants.length).toFixed(2);
      let running = 0;
      splits = participants.map((p, idx) => {
        if (idx === participants.length - 1) {
          return { user_id: p.id, value: (parseFloat(amount) - running).toFixed(2) };
        }
        running += parseFloat(each);
        return { user_id: p.id, value: each };
      });
    } else {
      splits = participants.map((p) => ({ user_id: p.id, value: null }));
    }

    try {
      await api(
        `/trips/${trip.id}/expenses`,
        {
          method: "POST",
          headers: { "Idempotency-Key": crypto.randomUUID() },
          body: JSON.stringify({
            description: template.desc,
            amount,
            currency: "USD",
            category: template.cat,
            paid_by: payer.id,
            split_type: splitType,
            splits,
          }),
        },
        payer.token
      );
      expenseCount++;
      if (expenseCount % 50 === 0) console.log(`  ${expenseCount} expenses...`);
    } catch (err) {
      console.warn(`  skipped one expense: ${err.message}`);
    }
  }

  console.log(`Done. Seeded ${trips.length} trips and ${expenseCount} expenses.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
