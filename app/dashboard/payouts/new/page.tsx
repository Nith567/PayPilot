"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useApi } from "@/lib/client-api";
import { useOrg } from "@/lib/dashboard-context";
import { Button, Card, Field, inputCls } from "@/app/ui";

export default function NewPayoutPage() {
  const router = useRouter();
  const { org, wallets, vendors } = useOrg();
  const api = useApi();

  const [walletId, setWalletId] = useState(wallets[0]?._id ?? "");
  const [recipientMode, setRecipientMode] = useState<"vendor" | "custom">("vendor");
  const [vendorAddress, setVendorAddress] = useState(vendors[0]?.address ?? "");
  const [customAddress, setCustomAddress] = useState("");
  const [amount, setAmount] = useState("");
  const [memo, setMemo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [denied, setDenied] = useState<string | null>(null);

  const recipient = recipientMode === "vendor" ? vendorAddress : customAddress;

  const submit = async () => {
    setBusy(true);
    setError(null);
    setDenied(null);
    try {
      const res = await api("/api/payouts", {
        method: "POST",
        body: JSON.stringify({
          walletId,
          recipient,
          amountUsdc: Number(amount),
          memo,
        }),
      });
      router.push(`/dashboard/payouts/${res.payout._id}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Request failed";
      if (/allowlist|cap|policy/i.test(message)) {
        setDenied(message);
      } else {
        setError(message);
      }
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">New payout</h1>
        <p className="mt-1 text-sm text-muted">
          The Privy policy on each wallet only allows payouts to onboarded
          vendors, within the wallet&apos;s cap. Try breaking that — it won&apos;t
          work.
        </p>
      </div>

      <Card>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (recipient && amount) submit();
          }}
          className="space-y-4"
        >
          <Field
            label="From wallet"
            hint={`Payouts ≤ $${org?.tierAmountUsd ?? 300} auto-route to the Ops wallet (single signer); larger amounts use the selected wallet (${org?.quorumThreshold ?? 1}-of-N quorum).`}
          >
            <select
              className={inputCls}
              value={walletId}
              onChange={(e) => setWalletId(e.target.value)}
            >
              {wallets.map((w) => (
                <option key={w._id} value={w._id}>
                  {w.name} (${w.capUsd.toLocaleString()}/tx cap)
                </option>
              ))}
            </select>
          </Field>

          <Field label="Recipient">
            <div className="mb-2 flex gap-4 text-sm">
              <label className="flex items-center gap-1.5">
                <input
                  type="radio"
                  checked={recipientMode === "vendor"}
                  onChange={() => setRecipientMode("vendor")}
                />
                Onboarded vendor
              </label>
              <label className="flex items-center gap-1.5">
                <input
                  type="radio"
                  checked={recipientMode === "custom"}
                  onChange={() => setRecipientMode("custom")}
                />
                Custom address
              </label>
            </div>
            {recipientMode === "vendor" ? (
              <select
                className={inputCls}
                value={vendorAddress}
                onChange={(e) => setVendorAddress(e.target.value)}
              >
                {vendors.map((v) => (
                  <option key={v._id} value={v.address}>
                    {v.name} — {v.address.slice(0, 10)}…
                  </option>
                ))}
              </select>
            ) : (
              <input
                className={inputCls}
                value={customAddress}
                onChange={(e) => setCustomAddress(e.target.value)}
                placeholder="0x… (not allowlisted — expect a policy denial)"
              />
            )}
          </Field>

          <Field label="Amount (USDC)">
            <input
              className={inputCls}
              type="number"
              min="1"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="e.g. 1250"
            />
          </Field>

          <Field label="Memo">
            <input
              className={inputCls}
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              placeholder="Invoice reference…"
              maxLength={280}
            />
          </Field>

          {denied ? (
            <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-4 py-3">
              <p className="text-sm font-semibold text-rose-300">DENIED BY POLICY</p>
              <p className="mt-1 text-sm text-rose-200/80">{denied}</p>
            </div>
          ) : null}
          {error ? (
            <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
              {error}
            </p>
          ) : null}

          <Button
            type="submit"
            disabled={busy || !recipient || !amount || !walletId}
            className="w-full"
          >
            {busy ? "Creating intent…" : "Request payout →"}
          </Button>
        </form>
      </Card>
    </div>
  );
}
