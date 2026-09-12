"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useApi } from "@/lib/client-api";
import { useOrg } from "@/lib/dashboard-context";
import { addressUrl } from "@/lib/chain";
import { Badge, Button, Card, CopyAddr } from "@/app/ui";
import type { ActivityDoc } from "@/lib/types";

const PURPOSE_LABEL: Record<string, string> = {
  treasury: "Treasury",
  payroll: "Payroll",
  bug_bounty: "Bug bounty",
  ops: "Ops",
  custom: "Custom",
};

const PURPOSE_ICON: Record<string, string> = {
  treasury: "🏦",
  payroll: "💸",
  bug_bounty: "🐛",
  ops: "⚙️",
  custom: "💼",
};

const ACTIVITY_ICON: Record<string, string> = {
  org_created: "🏢",
  wallet_created: "➕",
  vendor_added: "🤝",
  member_invited: "✉️",
  member_joined: "👋",
  member_signer: "🔑",
  governance_requested: "🗳️",
  settings_updated: "⚙️",
  payout_requested: "📤",
  payout_approved: "✍️",
  payout_executed: "✅",
  payout_denied: "⛔",
  wallet_funded: "💰",
};

export default function DashboardPage() {
  const { org, wallets, members, myRole, refresh } = useOrg();
  const api = useApi();
  const [balances, setBalances] = useState<Record<string, number | null>>({});
  const [activity, setActivity] = useState<ActivityDoc[]>([]);
  const [quorumBusy, setQuorumBusy] = useState<string | null>(null);
  const [quorumError, setQuorumError] = useState<string | null>(null);

  // Treasurers who accepted their invite but aren't signers yet — the owner
  // must confirm (their signature is required to mutate the quorum).
  const pendingSigners = members.filter(
    (m) => m.role === "treasurer" && m.status === "active" && !m.inQuorum,
  );

  const addSigner = async (memberId: string) => {
    setQuorumBusy(memberId);
    setQuorumError(null);
    try {
      await api(`/api/members/${memberId}/quorum`, { method: "POST" });
      await refresh();
    } catch (err) {
      setQuorumError(err instanceof Error ? err.message : "Quorum update failed");
    } finally {
      setQuorumBusy(null);
    }
  };

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const results = await Promise.all(
        wallets.map(async (w) => {
          try {
            const { balance } = await api(`/api/wallets/${w._id}/balance`);
            return [w._id, balance as number] as const;
          } catch {
            return [w._id, null] as const;
          }
        }),
      );
      if (alive) setBalances(Object.fromEntries(results));
    };
    load();
    const timer = setInterval(load, 20000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [wallets, api]);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const { activity: list } = await api("/api/activity");
        if (alive) setActivity(list ?? []);
      } catch {
        /* ignore */
      }
    };
    load();
    const timer = setInterval(load, 30000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [api]);

  const total = Object.values(balances).reduce<number>(
    (sum, b) => sum + (b ?? 0),
    0,
  );

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Treasury</h1>
          <p className="mt-1 text-sm text-muted">
            ${total.toLocaleString(undefined, { minimumFractionDigits: 2 })} USDC
            across {wallets.length} wallet{wallets.length === 1 ? "" : "s"} on Base Sepolia
          </p>
        </div>
        <div className="flex gap-3">
          <Link href="/dashboard/wallets/new">
            <Button variant="ghost">+ Add wallet</Button>
          </Link>
          <Link href="/dashboard/payouts/new">
            <Button>New payout</Button>
          </Link>
        </div>
      </div>

      {myRole === "owner" && pendingSigners.length > 0 ? (
        <div className="rounded-xl border border-accent/40 bg-accent/5 p-5">
          <p className="text-sm font-semibold text-accent">
            Signer approval needed
          </p>
          <div className="mt-3 space-y-2">
            {pendingSigners.map((m) => (
              <div
                key={m._id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-surface p-3"
              >
                <p className="text-sm">
                  <span className="font-medium">{m.email}</span> accepted the
                  Treasurer role — add them to the key quorums as a signer?
                </p>
                <Button
                  variant="ghost"
                  disabled={quorumBusy !== null}
                  onClick={() => addSigner(m._id)}
                >
                  {quorumBusy === m._id ? "Updating quorums…" : "Add to quorum"}
                </Button>
              </div>
            ))}
          </div>
          {quorumError ? (
            <p className="mt-2 text-sm text-rose-300">{quorumError}</p>
          ) : null}
          <p className="mt-3 text-xs text-muted">
            Updates the Privy key quorums. Once the main quorum requires two
            signatures, additions themselves need quorum approval — nobody can
            add a signer alone.
          </p>
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {wallets.map((w) => (
          <Card key={w._id} className="flex flex-col border-t-2 border-t-accent/40">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2">
                <span className="text-xl">{PURPOSE_ICON[w.purpose] ?? "💼"}</span>
                <div>
                  <h3 className="font-semibold">{w.name}</h3>
                  <p className="mt-0.5 text-xs text-muted">
                    {PURPOSE_LABEL[w.purpose] ?? w.purpose} wallet
                  </p>
                </div>
              </div>
              <Badge tone="blue">${w.capUsd.toLocaleString()}/tx cap</Badge>
            </div>
            <p className="mt-4 text-3xl font-semibold tracking-tight">
              $
              {balances[w._id] == null
                ? "…"
                : (balances[w._id] as number).toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                  })}
              <span className="ml-1 text-sm font-normal text-muted">USDC</span>
            </p>
            <div className="mt-4 flex items-center justify-between border-t border-line pt-3 text-xs text-muted">
              <CopyAddr address={w.address} />
              <a
                className="hover:text-foreground"
                href={addressUrl(w.address)}
                target="_blank"
                rel="noreferrer"
              >
                explorer ↗
              </a>
            </div>
          </Card>
        ))}
        <Link
          href="/dashboard/wallets/new"
          className="flex min-h-[180px] items-center justify-center rounded-xl border border-dashed border-line text-sm text-muted transition-colors hover:border-accent/50 hover:text-accent"
        >
          + Add wallet
        </Link>
      </div>

      <div>
        <h2 className="mb-3 text-lg font-semibold tracking-tight">Activity</h2>
        <Card className="divide-y divide-line p-0">
          {activity.length === 0 ? (
            <p className="p-5 text-sm text-muted">No activity yet.</p>
          ) : (
            activity.map((a) => (
              <div key={a._id} className="flex items-start justify-between gap-4 px-5 py-3">
                <p className="text-sm">
                  <span className="mr-2">{ACTIVITY_ICON[a.type] ?? "•"}</span>
                  {a.message}
                </p>
                <span className="shrink-0 text-xs text-muted">
                  {new Date(a.createdAt).toLocaleString()}
                </span>
              </div>
            ))
          )}
        </Card>
      </div>

      <p className="text-xs text-muted">
        {org?.name} · payouts ≤ ${org?.tierAmountUsd ?? 300} execute on the Ops
        wallet with a single signer; larger ones need {org?.quorumThreshold ?? 1}
        -of-N on the main quorum — all enforced by Privy at signature time.
      </p>
    </div>
  );
}
