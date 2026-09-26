export function money(amount: string | number, currency = "USD"): string {
  const n = typeof amount === "string" ? parseFloat(amount) : amount;
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(n);
}

export function initials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
}

export function relativeTime(iso: string): string {
  const date = new Date(iso);
  const diffMs = Date.now() - date.getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function dateLabel(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export const CATEGORY_ICONS: Record<string, string> = {
  food: "🍜",
  lodging: "🛏️",
  transport: "🚕",
  activity: "🎟️",
  shopping: "🛍️",
  other: "📎",
};

export const ACTION_LABELS: Record<string, string> = {
  "trip.created": "created the trip",
  "member.added": "joined the trip",
  "member.invited": "invited a member",
  "member.removed": "removed a member",
  "itinerary.created": "added an itinerary item",
  "itinerary.deleted": "removed an itinerary item",
  "expense.created": "logged an expense",
  "expense.deleted": "deleted an expense",
  "settlement.recorded": "recorded a settlement",
};
