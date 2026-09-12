"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useAuthorizationSignature } from "@privy-io/react-auth";
import { useApi } from "@/lib/client-api";
import { txUrl } from "@/lib/chain";
import { Badge, Button, Card, StatusChip } from "@/app/ui";
import type { PayoutDoc } from "@/lib/types";

interface IntentMember {
  name: string;
  type: string;
  signedAt: number | null;
}

interface IntentInfo {
  status: string;
  threshold: number | null;
  members: IntentMember[];
  expiresAt: number | null;
}

export default function PayoutDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const api = useApi();
  const { generateAuthorizationSignature } = useAuthorizationSignature();

  const [payout, setPayout] = useState<PayoutDoc | null>(null);
  const [intent, setIntent] = useState<IntentInfo | null>(null);
  const [payload, setPayload] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api(`/api/payouts/${id}`);
      setPayout(data.payout);
      setIntent(data.intent);
      setPayload(data.signaturePayloadBase64);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load payout");
    }
  }, [api, id]);

  useEffect(() => {
    // Initial fetch + 5s poll while pending. load() only sets state after
    // awaits, so this is not a synchronous setState-in-effect — the rule's
    // dataflow analysis can't see that.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    const timer = setInterval(() => {
      if (payout?.status === "pending") load();
    }, 5000);
    return () => clearInterval(timer);
  }, [load, payout?.status]);

  const approve = async () => {
    if (!payload) return;
    setBusy(true);
    setError(null);
    try {
      // Sign the intent's underlying request payload with the user's
      // authorization key (Privy embedded wallet signing) — the browser
      // produces the ECDSA P-256 signature, the server submits it to Privy.
      const bytes = Uint8Array.from(atob(payload), (c) => c.charCodeAt(0));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result: any = await generateAuthorizationSignature(bytes);
      const signature =
        typeof result === "string" ? result : result?.signature ?? result;
      const timestamp =
        result && typeof result === "object" ? result.timestamp : undefined;

      const data = await api(`/api/payouts/${id}/approve`, {
        method: "POST",
        body: JSON.stringify({ signature, timestamp }),
      });
      setPayout(data.payout);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Approval failed");
    } finally {
      setBusy(false);
    }
  };

  if (error && !payout) {
    return <p className="text-rose-300">{error}</p>;
  }
  if (!payout) return <p className="text-muted">Loading payout…</p>;

  const signedCount = payout.signedBy.length;
  const threshold = intent?.threshold ?? 2;
  const userSigned = (intent?.members ?? []).some(
    (m) =>
      m.type === "user" &&
      (!!m.signedAt || payout.signedBy.includes(m.name)),
  );

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            ${payout.amountUsdc.toLocaleString()} USDC payout
          </h1>
          <p className="mt-1 text-sm text-muted">
            {payout.walletName} · requested by {payout.creatorName} ·{" "}
            {new Date(payout.createdAt).toLocaleString()}
          </p>
        </div>
        <StatusChip status={payout.status} />
      </div>

      {payout.status === "executed" && payout.txHash ? (
        <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-5 py-4">
          <p className="font-semibold text-emerald-300">✓ Executed onchain</p>
          <p className="mt-1 text-sm text-emerald-200/80">
            Privy broadcast the transfer on Base Sepolia.
          </p>
          <a
            className="mt-2 inline-block font-mono text-xs text-emerald-300 hover:underline"
            href={txUrl(payout.txHash)}
            target="_blank"
            rel="noreferrer"
          >
            {payout.txHash} ↗
          </a>
        </div>
      ) : null}

      {payout.deniedReason && payout.status !== "executed" ? (
        <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-5 py-4">
          <p className="font-semibold text-rose-300">DENIED BY POLICY</p>
          <p className="mt-1 text-sm text-rose-200/80">
            {payout.deniedReason}
          </p>
          <p className="mt-2 text-xs text-rose-200/60">
            The Privy policy on this wallet evaluates every signature request —
            allowlist, caps, chain — inside the signing enclave. Even a fully
            signed payout is denied before it can broadcast.
          </p>
        </div>
      ) : null}

      <Card className="space-y-4">
        <div className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted">Recipient</p>
            <p className="mt-1 font-mono text-xs break-all">{payout.recipient}</p>
            {payout.vendorName ? (
              <p className="mt-1 text-xs text-emerald-300">✓ allowlisted vendor: {payout.vendorName}</p>
            ) : (
              <p className="mt-1 text-xs text-rose-300">✗ not an onboarded vendor</p>
            )}
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-muted">Memo</p>
            <p className="mt-1">{payout.memo || "—"}</p>
          </div>
        </div>
      </Card>

      <Card className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">Quorum approval</h3>
          <Badge tone={payout.status === "executed" ? "green" : "amber"}>
            {signedCount}/{threshold} signed
          </Badge>
        </div>

        <div className="space-y-2">
          {(intent?.members ?? []).map((m) => {
            const signed = !!m.signedAt || payout.signedBy.includes(m.name);
            return (
              <div
                key={m.name}
                className="flex items-center justify-between rounded-lg border border-line bg-surface2 px-4 py-2.5"
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm">{m.name}</span>
                  <Badge tone="gray">quorum signer</Badge>
                </div>
                {signed ? (
                  <span className="text-sm text-emerald-300">✓ signed</span>
                ) : (
                  <span className="text-sm text-muted">awaiting signature</span>
                )}
              </div>
            );
          })}
        </div>

        {payout.status === "pending" ? (
          <>
            {error ? (
              <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
                {error}
              </p>
            ) : null}
            <Button
              onClick={approve}
              disabled={busy || !payload || userSigned}
              className="w-full"
            >
              {busy
                ? "Signing…"
                : userSigned
                  ? "Signed — awaiting PolicyBot"
                  : "Approve & sign"}
            </Button>
            <p className="text-xs text-muted">
              Approving signs the intent&apos;s request with your Privy
              authorization key. When the quorum threshold is met, Privy
              executes — and the wallet&apos;s policy (allowlist, caps) is
              checked at signature time.
            </p>
          </>
        ) : null}
      </Card>
    </div>
  );
}
