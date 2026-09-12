"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useApi } from "@/lib/client-api";
import { useOrg } from "@/lib/dashboard-context";
import { Badge, Button, Card, Field, inputCls } from "@/app/ui";

const PURPOSES = [
  { id: "treasury", label: "Treasury", cap: 10000, desc: "Main operating funds" },
  { id: "payroll", label: "Payroll", cap: 2000, desc: "Contractor & salary runs" },
  { id: "bug_bounty", label: "Bug Bounty Rewards", cap: 5000, desc: "Researcher payouts" },
  { id: "ops", label: "Ops", cap: 1000, desc: "SaaS, infra, day-to-day" },
  { id: "custom", label: "Custom", cap: 500, desc: "Any purpose, tight cap" },
];

export default function NewWalletPage() {
  const router = useRouter();
  const { refresh } = useOrg();
  const api = useApi();
  const [name, setName] = useState("");
  const [purpose, setPurpose] = useState("custom");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api("/api/wallets", {
        method: "POST",
        body: JSON.stringify({ name, purpose }),
      });
      await refresh();
      router.push("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create wallet");
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Add wallet</h1>
        <p className="mt-1 text-sm text-muted">
          A new Privy organization wallet with its own onchain address and its
          own policy: vendor allowlist + per-transaction cap, enforced at
          signature time.
        </p>
      </div>

      <Card className="space-y-4">
        <Field label="Wallet name">
          <input
            className={inputCls}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Bug Bounty Rewards"
            maxLength={100}
            autoFocus
          />
        </Field>

        <Field label="Purpose & policy preset">
          <div className="space-y-2">
            {PURPOSES.map((p) => (
              <label
                key={p.id}
                className={`flex cursor-pointer items-center justify-between rounded-lg border px-4 py-3 transition-colors ${
                  purpose === p.id
                    ? "border-accent/60 bg-accent/5"
                    : "border-line bg-surface2 hover:border-accent/30"
                }`}
              >
                <span className="flex items-center gap-3">
                  <input
                    type="radio"
                    name="purpose"
                    checked={purpose === p.id}
                    onChange={() => setPurpose(p.id)}
                  />
                  <span>
                    <span className="block text-sm font-medium">{p.label}</span>
                    <span className="block text-xs text-muted">{p.desc}</span>
                  </span>
                </span>
                <Badge tone="blue">${p.cap.toLocaleString()}/tx cap</Badge>
              </label>
            ))}
          </div>
        </Field>

        {error ? (
          <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
            {error}
          </p>
        ) : null}

        <Button
          onClick={submit}
          disabled={busy || !name.trim()}
          className="w-full"
        >
          {busy ? "Creating wallet + policy…" : "Create wallet →"}
        </Button>
      </Card>
    </div>
  );
}
