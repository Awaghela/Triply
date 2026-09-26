// Trailing-slash-safe: every call site below does `${API_URL}${path}` with
// `path` already starting with "/", so a trailing slash on the configured
// URL (an easy mistake if it was copied from a browser address bar) would
// otherwise produce a double slash the backend's router treats as an
// unmatched path (404) on every single request.
const API_URL = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080").replace(/\/+$/, "");

export class ApiClientError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem("triply_token");
}

export function setToken(token: string | null) {
  if (typeof window === "undefined") return;
  if (token) window.localStorage.setItem("triply_token", token);
  else window.localStorage.removeItem("triply_token");
}

async function request<T>(
  path: string,
  opts: RequestInit & { idempotent?: boolean } = {}
): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(opts.headers as Record<string, string>),
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  // Any request that creates a resource carries a fresh idempotency key by
  // default, so an accidental double-submit (double click, retried fetch on
  // flaky connections) never creates a duplicate expense or settlement.
  if (opts.idempotent && !headers["Idempotency-Key"]) {
    headers["Idempotency-Key"] = crypto.randomUUID();
  }

  const res = await fetch(`${API_URL}${path}`, { ...opts, headers });

  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = await res.json();
      message = body.error || message;
    } catch {
      // ignore
    }
    throw new ApiClientError(res.status, message);
  }

  if (res.status === 204) return undefined as T;
  return res.json();
}

export interface PublicUser {
  id: string;
  name: string;
  email: string;
  avatar_color: string;
}

export interface Trip {
  id: string;
  name: string;
  description: string | null;
  destination: string | null;
  cover_color: string;
  start_date: string | null;
  end_date: string | null;
  currency: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface TripMember {
  id: string;
  trip_id: string;
  user_id: string;
  role: "owner" | "admin" | "member";
  joined_at: string;
  name: string;
  email: string;
  avatar_color: string;
}

export interface ItineraryItem {
  id: string;
  trip_id: string;
  day_number: number;
  title: string;
  description: string | null;
  location: string | null;
  start_time: string | null;
  end_time: string | null;
  category: string;
  created_by: string;
  created_at: string;
}

export type SplitType = "equal" | "percentage" | "custom" | "selected";

export interface ExpenseSplit {
  id: string;
  expense_id: string;
  user_id: string;
  amount: string;
  percentage: string | null;
}

export interface Expense {
  id: string;
  trip_id: string;
  description: string;
  amount: string;
  currency: string;
  category: string;
  paid_by: string;
  split_type: SplitType;
  receipt_url: string | null;
  notes: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  splits: ExpenseSplit[];
}

export interface BalanceEntry {
  user_id: string;
  name: string;
  avatar_color: string;
  net: string;
}

export interface SuggestedTransfer {
  from_user: string;
  from_name: string;
  to_user: string;
  to_name: string;
  amount: string;
}

export interface Settlement {
  id: string;
  trip_id: string;
  from_user: string;
  to_user: string;
  amount: string;
  note: string | null;
  settled_at: string;
  created_by: string;
}

export interface ActivityLogEntry {
  id: string;
  trip_id: string;
  actor_id: string | null;
  action: string;
  metadata: Record<string, unknown>;
  seq: number;
  prev_hash: string;
  hash: string;
  created_at: string;
}

export interface TripMetrics {
  total_expenses: number;
  total_amount: string;
  member_count: number;
  avg_expense: string;
  by_category: { category: string; total: string; count: number }[];
  by_day: { date: string; total: string }[];
}

export const api = {
  register: (name: string, email: string, password: string) =>
    request<{ token: string; user: PublicUser }>("/auth/register", {
      method: "POST",
      body: JSON.stringify({ name, email, password }),
    }),
  login: (email: string, password: string) =>
    request<{ token: string; user: PublicUser }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
  me: () => request<PublicUser>("/auth/me"),

  listTrips: () => request<Trip[]>("/trips"),
  createTrip: (payload: Partial<Trip> & { name: string }) =>
    request<Trip>("/trips", { method: "POST", body: JSON.stringify(payload) }),
  getTrip: (tripId: string) => request<Trip>(`/trips/${tripId}`),

  listMembers: (tripId: string) => request<TripMember[]>(`/trips/${tripId}/members`),
  inviteMember: (tripId: string, email: string, role?: string) =>
    request(`/trips/${tripId}/members`, {
      method: "POST",
      body: JSON.stringify({ email, role }),
    }),
  removeMember: (tripId: string, userId: string) =>
    request(`/trips/${tripId}/members/${userId}`, { method: "DELETE" }),

  listItinerary: (tripId: string) => request<ItineraryItem[]>(`/trips/${tripId}/itinerary`),
  createItineraryItem: (tripId: string, payload: Partial<ItineraryItem>) =>
    request<ItineraryItem>(`/trips/${tripId}/itinerary`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  deleteItineraryItem: (tripId: string, itemId: string) =>
    request(`/trips/${tripId}/itinerary/${itemId}`, { method: "DELETE" }),

  listExpenses: (tripId: string) => request<Expense[]>(`/trips/${tripId}/expenses`),
  createExpense: (
    tripId: string,
    payload: {
      description: string;
      amount: string;
      currency?: string;
      category?: string;
      paid_by: string;
      split_type: SplitType;
      splits: { user_id: string; value?: string | null }[];
      receipt_url?: string | null;
      notes?: string | null;
    }
  ) =>
    request<Expense>(`/trips/${tripId}/expenses`, {
      method: "POST",
      body: JSON.stringify(payload),
      idempotent: true,
    }),
  deleteExpense: (tripId: string, expenseId: string) =>
    request(`/trips/${tripId}/expenses/${expenseId}`, { method: "DELETE" }),

  getBalances: (tripId: string) =>
    request<{ balances: BalanceEntry[]; suggested_transfers: SuggestedTransfer[] }>(
      `/trips/${tripId}/balances`
    ),
  listSettlements: (tripId: string) => request<Settlement[]>(`/trips/${tripId}/settlements`),
  createSettlement: (
    tripId: string,
    payload: { from_user: string; to_user: string; amount: string; note?: string }
  ) =>
    request<Settlement>(`/trips/${tripId}/settlements`, {
      method: "POST",
      body: JSON.stringify(payload),
      idempotent: true,
    }),

  listActivity: (tripId: string) => request<ActivityLogEntry[]>(`/trips/${tripId}/activity`),
  verifyActivity: (tripId: string) =>
    request<{ valid: boolean; entries_checked: number; first_broken_seq: number | null }>(
      `/trips/${tripId}/activity/verify`
    ),

  getMetrics: (tripId: string) => request<TripMetrics>(`/trips/${tripId}/metrics`),

  // Returns an { upload_url, public_url } pair. Backed by S3 when the
  // server has AWS credentials configured, or local disk storage
  // otherwise (see backend/src/local_uploads.rs) -- the client doesn't
  // need to know or care which; both are used the same way (see
  // uploadReceipt below).
  presignReceipt: (tripId: string, filename: string, contentType: string) =>
    request<{ upload_url: string; public_url: string }>(`/trips/${tripId}/receipts/presign`, {
      method: "POST",
      body: JSON.stringify({ filename, content_type: contentType }),
    }),

  // Full receipt-upload flow: get an upload target, PUT the file bytes to
  // it, and return the public URL to store on the expense as receipt_url.
  uploadReceipt: async (tripId: string, file: File): Promise<string> => {
    const { upload_url, public_url } = await api.presignReceipt(tripId, file.name, file.type);
    const token = getToken();
    const res = await fetch(upload_url, {
      method: "PUT",
      headers: {
        "Content-Type": file.type,
        // Harmless against S3 (which ignores unsigned headers), needed so
        // local-mode uploads carry a token if the endpoint ever starts
        // requiring one; omitted from the signed part of the S3 URL either
        // way, so it never breaks the signature.
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: file,
    });
    if (!res.ok) {
      throw new ApiClientError(res.status, "Couldn't upload the receipt photo. Try again.");
    }
    return public_url;
  },
};

export function wsUrl(tripId: string): string {
  const base = API_URL.replace(/^http/, "ws");
  return `${base}/ws?trip_id=${tripId}`;
}
