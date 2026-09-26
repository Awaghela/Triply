"use client";

import clsx from "clsx";
import { initials } from "@/lib/format";

export function Button({
  children,
  variant = "primary",
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
}) {
  const base =
    "inline-flex items-center justify-center gap-2 rounded-full px-5 py-2.5 text-sm font-medium transition-all duration-150 disabled:opacity-50 disabled:pointer-events-none";
  const variants: Record<string, string> = {
    primary: "bg-ink text-paper hover:bg-ink-700 active:scale-[0.98]",
    secondary:
      "bg-transparent text-ink border border-ink/20 hover:border-ink/50 active:scale-[0.98]",
    ghost: "bg-transparent text-ink/70 hover:text-ink hover:bg-ink/5",
    danger: "bg-transparent text-rust-deep border border-rust/30 hover:bg-rust-dim",
  };
  return (
    <button className={clsx(base, variants[variant], className)} {...props}>
      {children}
    </button>
  );
}

export function Input({
  label,
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { label?: string }) {
  return (
    <label className="block">
      {label && <span className="mb-1.5 block text-sm font-medium text-ink/70">{label}</span>}
      <input
        className={clsx(
          "w-full rounded-lg border border-ink/15 bg-white/60 px-3.5 py-2.5 text-[15px] text-ink placeholder:text-ink/35",
          "focus:border-ink/40 focus:outline-none transition-colors",
          className
        )}
        {...props}
      />
    </label>
  );
}

export function Textarea({
  label,
  className,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { label?: string }) {
  return (
    <label className="block">
      {label && <span className="mb-1.5 block text-sm font-medium text-ink/70">{label}</span>}
      <textarea
        className={clsx(
          "w-full rounded-lg border border-ink/15 bg-white/60 px-3.5 py-2.5 text-[15px] text-ink placeholder:text-ink/35",
          "focus:border-ink/40 focus:outline-none transition-colors resize-none",
          className
        )}
        {...props}
      />
    </label>
  );
}

export function Select({
  label,
  className,
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement> & { label?: string }) {
  return (
    <label className="block">
      {label && <span className="mb-1.5 block text-sm font-medium text-ink/70">{label}</span>}
      <select
        className={clsx(
          "w-full rounded-lg border border-ink/15 bg-white/60 px-3.5 py-2.5 text-[15px] text-ink",
          "focus:border-ink/40 focus:outline-none transition-colors",
          className
        )}
        {...props}
      >
        {children}
      </select>
    </label>
  );
}

export function Avatar({
  name,
  color,
  size = "md",
}: {
  name: string;
  color: string;
  size?: "sm" | "md" | "lg";
}) {
  const sizes = { sm: "h-6 w-6 text-[10px]", md: "h-8 w-8 text-xs", lg: "h-11 w-11 text-sm" };
  return (
    <div
      className={clsx(
        "flex shrink-0 items-center justify-center rounded-full font-semibold text-white",
        sizes[size]
      )}
      style={{ backgroundColor: color }}
      title={name}
    >
      {initials(name)}
    </div>
  );
}

export function Modal({
  open,
  onClose,
  children,
  title,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  title: string;
  wide?: boolean;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/40 px-4 py-8 backdrop-blur-[2px]">
      <div
        className={clsx(
          "animate-rise-in mt-4 w-full rounded-2xl border border-ink/10 bg-paper p-6 shadow-card sm:p-8",
          wide ? "max-w-2xl" : "max-w-md"
        )}
      >
        <div className="mb-6 flex items-center justify-between">
          <h2 className="font-display text-2xl text-ink">{title}</h2>
          <button
            onClick={onClose}
            className="rounded-full p-1.5 text-ink/40 hover:bg-ink/5 hover:text-ink"
            aria-label="Close"
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <path d="M2 2L16 16M16 2L2 16" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Badge({
  children,
  tone = "default",
}: {
  children: React.ReactNode;
  tone?: "default" | "amber" | "teal" | "rust";
}) {
  const tones: Record<string, string> = {
    default: "bg-ink/5 text-ink/70",
    amber: "bg-amber-dim text-amber-deep",
    teal: "bg-teal-dim text-teal-deep",
    rust: "bg-rust-dim text-rust-deep",
  };
  return (
    <span className={clsx("rounded-full px-2.5 py-1 text-xs font-medium", tones[tone])}>
      {children}
    </span>
  );
}
