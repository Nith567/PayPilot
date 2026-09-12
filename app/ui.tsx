"use client";

export type Tone = "green" | "red" | "amber" | "blue" | "gray";

export function Card({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-xl border border-line bg-surface p-5 ${className}`}>
      {children}
    </div>
  );
}

export function Badge({
  tone = "gray",
  children,
}: {
  tone?: Tone;
  children: React.ReactNode;
}) {
  const tones: Record<Tone, string> = {
    green: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
    red: "bg-rose-500/15 text-rose-300 border-rose-500/30",
    amber: "bg-amber-500/15 text-amber-300 border-amber-500/30",
    blue: "bg-sky-500/15 text-sky-300 border-sky-500/30",
    gray: "bg-white/5 text-muted border-white/10",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

export function Button({
  variant = "primary",
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "ghost" | "danger";
}) {
  const variants = {
    primary: "bg-accent text-[#052017] hover:bg-accent-dim",
    ghost: "border border-line text-foreground hover:bg-surface2",
    danger: "bg-rose-500/15 text-rose-300 border border-rose-500/40 hover:bg-rose-500/25",
  };
  return (
    <button
      {...props}
      className={`inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 ${variants[variant]} ${className}`}
    />
  );
}

export function Addr({
  address,
  className = "",
}: {
  address: string;
  className?: string;
}) {
  return (
    <span className={`font-mono text-xs ${className}`}>
      {address.slice(0, 6)}…{address.slice(-4)}
    </span>
  );
}

export function CopyAddr({ address }: { address: string }) {
  const [copied, setCopied] = React.useState(false);
  return (
    <button
      onClick={async () => {
        await navigator.clipboard.writeText(address);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="font-mono text-xs text-muted hover:text-foreground transition-colors"
      title={address}
    >
      {copied ? "copied ✓" : `${address.slice(0, 6)}…${address.slice(-4)}`}
    </button>
  );
}

export function StatusChip({ status }: { status: string }) {
  const map: Record<string, { tone: Tone; label: string }> = {
    pending: { tone: "amber", label: "Pending quorum" },
    executed: { tone: "green", label: "Executed onchain" },
    denied: { tone: "red", label: "Denied by policy" },
    expired: { tone: "gray", label: "Expired" },
    failed: { tone: "red", label: "Failed" },
  };
  const m = map[status] ?? { tone: "gray" as Tone, label: status };
  return <Badge tone={m.tone}>{m.label}</Badge>;
}

export const inputCls =
  "w-full rounded-lg border border-line bg-surface2 px-3 py-2 text-sm text-foreground placeholder:text-muted/60 outline-none focus:border-accent/60";

export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-muted">
        {label}
      </span>
      {children}
      {hint ? <span className="mt-1 block text-xs text-muted/70">{hint}</span> : null}
    </label>
  );
}

import React from "react";
