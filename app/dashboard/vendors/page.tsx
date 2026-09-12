"use client";

import { useState } from "react";
import { useApi } from "@/lib/client-api";
import { useOrg } from "@/lib/dashboard-context";
import { Badge, Button, Card, CopyAddr, Field, inputCls } from "@/app/ui";

export default function VendorsPage() {
  const { vendors, refresh } = useOrg();
  const api = useApi();

  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    setAdded(null);
    try {
      await api("/api/vendors", {
        method: "POST",
        body: JSON.stringify({ name, address, email: email || undefined }),
      });
      setName("");
      setAddress("");
      setEmail("");
      setAdded(`${name} onboarded — added to the Privy policy allowlist`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to onboard vendor");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Vendors</h1>
        <p className="mt-1 text-sm text-muted">
          Onboarding a vendor adds their address to the Privy condition set that
          every wallet policy references — the allowlist is enforced at
          signature time, not just in the UI.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <Card className="divide-y divide-line self-start p-0">
          {vendors.length === 0 ? (
            <p className="p-5 text-sm text-muted">No vendors yet.</p>
          ) : (
            vendors.map((v) => (
              <div key={v._id} className="flex items-center justify-between gap-4 px-5 py-3.5">
                <div>
                  <p className="text-sm font-medium">{v.name}</p>
                  <div className="mt-0.5 flex items-center gap-2">
                    <CopyAddr address={v.address} />
                    {v.email ? <span className="text-xs text-muted">{v.email}</span> : null}
                  </div>
                </div>
                <Badge tone="green">allowlisted</Badge>
              </div>
            ))
          )}
        </Card>

        <Card className="self-start">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (name && address) submit();
            }}
            className="space-y-4"
          >
            <h3 className="font-semibold">Onboard vendor</h3>
            <Field label="Name">
              <input
                className={inputCls}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Cloudflare"
                maxLength={100}
              />
            </Field>
            <Field label="Payout address" hint="EVM address (Base)">
              <input
                className={inputCls}
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="0x…"
              />
            </Field>
            <Field label="Email (optional)">
              <input
                className={inputCls}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="ap@vendor.com"
              />
            </Field>
            {added ? (
              <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">
                {added}
              </p>
            ) : null}
            {error ? (
              <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
                {error}
              </p>
            ) : null}
            <Button type="submit" disabled={busy || !name || !address} className="w-full">
              {busy ? "Onboarding…" : "Add vendor"}
            </Button>
          </form>
        </Card>
      </div>
    </div>
  );
}
