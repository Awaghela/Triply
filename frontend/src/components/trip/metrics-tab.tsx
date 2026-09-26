"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { TripMetrics } from "@/lib/api";
import { CATEGORY_ICONS, money } from "@/lib/format";

const PALETTE = ["#E4A33B", "#1F6B66", "#C0503A", "#3B5B92", "#7A5C99", "#8C8060"];

export function MetricsTab({ metrics, currency }: { metrics: TripMetrics; currency: string }) {
  const dayData = metrics.by_day.map((d) => ({
    date: new Date(d.date).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    total: parseFloat(d.total),
  }));
  const categoryData = metrics.by_category.map((c) => ({
    name: c.category,
    value: parseFloat(c.total),
    count: c.count,
  }));

  return (
    <div>
      <h2 className="font-display text-xl text-ink">Trip metrics</h2>

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Total spent" value={money(metrics.total_amount, currency)} tone="amber" />
        <StatCard label="Expenses logged" value={String(metrics.total_expenses)} tone="teal" />
        <StatCard label="Members" value={String(metrics.member_count)} tone="rust" />
        <StatCard label="Avg. expense" value={money(metrics.avg_expense, currency)} tone="default" />
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-[1.3fr,1fr]">
        <div className="rounded-xl border border-ink/10 bg-white/50 p-5">
          <p className="mb-4 text-sm font-medium text-ink/70">Spending over time</p>
          {dayData.length === 0 ? (
            <p className="py-16 text-center text-sm text-ink/40">No data yet</p>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={dayData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#DAD3C1" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#16241D99" }} axisLine={{ stroke: "#DAD3C1" }} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "#16241D99" }} axisLine={false} tickLine={false} />
                <Tooltip
                  contentStyle={{ background: "#F6F4EE", border: "1px solid #DAD3C1", borderRadius: 8, fontSize: 12 }}
                  formatter={(v) => money(Number(v) || 0, currency)}
                />
                <Bar dataKey="total" fill="#E4A33B" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="rounded-xl border border-ink/10 bg-white/50 p-5">
          <p className="mb-4 text-sm font-medium text-ink/70">By category</p>
          {categoryData.length === 0 ? (
            <p className="py-16 text-center text-sm text-ink/40">No data yet</p>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={180}>
                <PieChart>
                  <Pie data={categoryData} dataKey="value" nameKey="name" innerRadius={45} outerRadius={70} paddingAngle={2}>
                    {categoryData.map((_, i) => (
                      <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v) => money(Number(v) || 0, currency)} />
                </PieChart>
              </ResponsiveContainer>
              <div className="mt-3 space-y-1.5">
                {categoryData.map((c, i) => (
                  <div key={c.name} className="flex items-center justify-between text-xs">
                    <span className="flex items-center gap-1.5 text-ink/70">
                      <span className="h-2 w-2 rounded-full" style={{ background: PALETTE[i % PALETTE.length] }} />
                      {CATEGORY_ICONS[c.name] || "📎"} {c.name}
                    </span>
                    <span className="font-mono text-ink/50">{money(c.value, currency)}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, tone }: { label: string; value: string; tone: string }) {
  const tones: Record<string, string> = {
    amber: "text-amber-deep",
    teal: "text-teal-deep",
    rust: "text-rust-deep",
    default: "text-ink",
  };
  return (
    <div className="rounded-xl border border-ink/10 bg-white/50 p-4">
      <p className="text-xs text-ink/45">{label}</p>
      <p className={`mt-1 font-display text-2xl ${tones[tone]}`}>{value}</p>
    </div>
  );
}
