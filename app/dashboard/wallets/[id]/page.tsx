"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useApi } from "@/lib/client-api";
import { useOrg } from "@/lib/dashboard-context";
import { addressUrl } from "@/lib/chain";
import { Badge, Card, CopyAddr, StatusChip } from "@/app/ui";
import type { PayoutDoc } from "@/lib/types";

export default function WalletDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { org, wallets, vendors } = useOrg();
  const api = useApi();
  const wallet = wallets.find((w) => w._id === id);

  const [balance, setBalance] = useState<number | null>(null);
  const [payouts, setPayouts] = useState<PayoutDoc[]>([]);

  useEffect(() => {
    if (!wallet) return;
    let alive = true;
    const load = async () => {
      try {
        const { balance: b } = await api(`/api/wallets/${wallet._id}/balance`);
        if (alive) setBalance(b);
      } catch {
        /* ignore */
      }
    };
    load();
    const timer = setInterval(load, 20000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [wallet, api]);

  useEffect(() => {
    let alive = true;
    api("/api/payouts")
      .then(({ payouts: list }) => {
        if (alive)
          setPayouts((list ?? []).filter((p: PayoutDoc) => p.walletId === id));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [api, id]);

  if (!wallet) return <p className="text-muted">Wallet not found.</p>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{wallet.name}</h1>
        <p className="mt-1 text-sm text-muted">
          Privy organization wallet · owned by the org&apos;s key quorum
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <p className="text-xs uppercase tracking-wide text-muted">USDC balance</p>
          <p className="mt-2 text-3xl font-semibold tracking-tight">
            {balance == null ? "$…" : `$${balance.toLocaleString(undefined, { minimumFractionDigits: 2 })}`}
          </p>
          <div className="mt-4 flex items-center justify-between border-t border-line pt-3 text-xs text-muted">
            <CopyAddr address={wallet.address} />
            <a
              className="hover:text-foreground"
              href={addressUrl(wallet.address)}
              target="_blank"
              rel="noreferrer"
            >
              explorer ↗
            </a>
          </div>
        </Card>

        <Card className="space-y-2 text-sm">
          <p className="text-xs uppercase tracking-wide text-muted">Policy (Privy, enforced at signature time)</p>
          <p>
            <Badge tone="blue">${wallet.capUsd.toLocaleString()}/tx cap</Badge>{" "}
            <Badge tone="green">vendor allowlist</Badge>{" "}
            <Badge tone="gray">Base Sepolia only</Badge>{" "}
            <Badge tone="gray">USDC only</Badge>
          </p>
          <p className="text-xs text-muted">
            {vendors.length} allowlisted vendor{vendors.length === 1 ? "" : "s"} ·
            quorum {wallet.purpose === "ops"
              ? "Ops · 1-of-N (single signer)"
              : `Main · ${org?.quorumThreshold ?? 1}-of-N`}
          </p>
          <div className="rounded-lg border border-line bg-surface2 px-3 py-2.5">
            <p className="text-xs font-medium text-muted">Fund this wallet</p>
            <p className="mt-1 font-mono text-xs break-all">{wallet.address}</p>
            <p className="mt-1.5 text-xs text-muted">
              Send free test USDC from{" "}
              <a
                className="text-accent hover:underline"
                href="https://faucet.circle.com"
                target="_blank"
                rel="noreferrer"
              >
                faucet.circle.com ↗
              </a>{" "}
              (Base Sepolia). Gas is sponsored by Privy.
            </p>
          </div>
        </Card>
      </div>

      <div>
        <h2 className="mb-3 text-lg font-semibold tracking-tight">Payouts from this wallet</h2>
        <Card className="divide-y divide-line p-0">
          {payouts.length === 0 ? (
            <p className="p-5 text-sm text-muted">No payouts yet.</p>
          ) : (
            payouts.map((p) => (
              <div key={p._id} className="flex items-center justify-between gap-4 px-5 py-3">
                <div>
                  <p className="text-sm font-medium">
                    ${p.amountUsdc.toLocaleString()} → {p.vendorName ?? p.recipient.slice(0, 10) + "…"}
                  </p>
                  <p className="text-xs text-muted">{new Date(p.createdAt).toLocaleString()}</p>
                </div>
                <StatusChip status={p.status} />
              </div>
            ))
          )}
        </Card>
      </div>
    </div>
  );
}
