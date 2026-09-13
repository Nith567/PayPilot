"use client";

import { useCallback, useEffect, useState } from "react";
import { useIdentityToken, usePrivy } from "@privy-io/react-auth";
import { useApi } from "@/lib/client-api";
import { useOrg } from "@/lib/dashboard-context";
import { ROLE_LABELS } from "@/lib/types";
import type { MemberRole } from "@/lib/types";
import { Badge, Button, Card, Field, inputCls } from "@/app/ui";
import { PersonalWalletCard } from "./personal-wallet-card";

const ROLE_DESCRIPTIONS: Record<MemberRole, string> = {
  owner: "Full control — org, members, wallets, policies",
  treasurer: "Creates and approves payouts; can become a quorum signer",
  finance_officer: "Creates payout requests (no signing power)",
  viewer: "Read-only — balances and activity",
};

interface GovernanceRow {
  _id: string;
  title: string;
  intentStatus: string;
  threshold: number | null;
  members: { name: string; signedAt: number | null }[];
}

export default function TeamPage() {
  const { org, members, myRole, refresh } = useOrg();
  const api = useApi();
  const { user } = usePrivy();
  const { identityToken } = useIdentityToken();

  const [email, setEmail] = useState("");
  const [role, setRole] = useState<MemberRole>("finance_officer");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  // Quorum signer count = humans with quorum membership.
  const signerCount = members.filter(
    (m) => m.inQuorum || (m.status === "active" && m.role === "owner"),
  ).length;
  const [thresholdChoice, setThresholdChoice] = useState(org?.quorumThreshold ?? 1);
  const [thresholdBusy, setThresholdBusy] = useState(false);
  const [thresholdError, setThresholdError] = useState<string | null>(null);

  const [tierAmount, setTierAmount] = useState(String(org?.tierAmountUsd ?? 300));
  const [tierBusy, setTierBusy] = useState(false);
  const [tierError, setTierError] = useState<string | null>(null);

  const [governance, setGovernance] = useState<GovernanceRow[]>([]);
  const [govBusyId, setGovBusyId] = useState<string | null>(null);
  const [govError, setGovError] = useState<string | null>(null);

  const myEmail = user?.email?.address?.toLowerCase();
  const myInvite = members.find(
    (m) => m.status === "invited" && m.email.toLowerCase() === myEmail,
  );

  const loadGovernance = useCallback(async () => {
    try {
      const { governance: list } = await api("/api/governance");
      setGovernance(list ?? []);
    } catch {
      /* ignore */
    }
  }, [api]);

  useEffect(() => {
    // loadGovernance only sets state after awaits.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadGovernance();
    const timer = setInterval(loadGovernance, 8000);
    return () => clearInterval(timer);
  }, [loadGovernance]);

  const act = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setError(null);
    setOk(null);
    try {
      await fn();
      await refresh();
      setOk(label + " ✓");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setBusy(null);
    }
  };

  const invite = () =>
    act(`Invited ${email}`, async () => {
      await api("/api/members", {
        method: "POST",
        body: JSON.stringify({ email, role }),
      });
      setEmail("");
    });

  const saveThreshold = async () => {
    setThresholdBusy(true);
    setThresholdError(null);
    try {
      const res = await api("/api/orgs/quorum-threshold", {
        method: "POST",
        body: JSON.stringify({ threshold: thresholdChoice }),
      });
      if (res.direct) {
        await refresh();
        setOk(`Threshold set to ${thresholdChoice}-of-${signerCount} ✓`);
      } else {
        setOk("Threshold change sent for quorum approval ✓");
        await loadGovernance();
      }
    } catch (err) {
      setThresholdError(err instanceof Error ? err.message : "Threshold update failed");
    } finally {
      setThresholdBusy(false);
    }
  };

  const saveTier = async () => {
    setTierBusy(true);
    setTierError(null);
    try {
      await api("/api/orgs/settings", {
        method: "POST",
        body: JSON.stringify({ tierAmountUsd: Number(tierAmount) }),
      });
      await refresh();
      setOk(`Tier set: payouts ≤ $${tierAmount} use the Ops wallet (single approver) ✓`);
    } catch (err) {
      setTierError(err instanceof Error ? err.message : "Tier update failed");
    } finally {
      setTierBusy(false);
    }
  };

  const approveGovernance = async (recordId: string) => {
    setGovBusyId(recordId);
    setGovError(null);
    try {
      // Signing happens server-side (identity token → user signing key
      // exchange).
      await api(`/api/governance/${recordId}/approve`, {
        method: "POST",
        body: JSON.stringify({}),
        headers: { "x-privy-id-token": identityToken ?? "" },
      });
      await refresh();
      await loadGovernance();
    } catch (err) {
      setGovError(err instanceof Error ? err.message : "Approval failed");
    } finally {
      setGovBusyId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Team & governance</h1>
        <p className="mt-1 text-sm text-muted">
          Roles live in the app DB for permissions. Signing power is enforced
          by Privy — quorum membership to sign, policies to transfer. You are{" "}
          <span className="text-foreground">{myRole ? ROLE_LABELS[myRole] : "—"}</span>.
        </p>
      </div>

      {/* Personal wallet — the member's own Privy embedded wallet */}
      <PersonalWalletCard />

      {/* Approval settings (owner) */}
      {myRole === "owner" ? (
        <Card>
          <h3 className="font-semibold">Approval settings</h3>
          <div className="mt-4 grid gap-6 md:grid-cols-2">
            <div className="rounded-lg border border-line bg-surface2 p-4">
              <p className="text-sm font-medium">Main quorum threshold</p>
              <p className="mt-1 text-xs text-muted">
                Payouts above the tier need this many signatures from the{" "}
                {signerCount} quorum signer{signerCount === 1 ? "" : "s"}.
              </p>
              <div className="mt-3 flex items-center gap-3">
                <select
                  className={inputCls}
                  style={{ width: "8rem" }}
                  value={thresholdChoice}
                  onChange={(e) => setThresholdChoice(Number(e.target.value))}
                >
                  {Array.from({ length: Math.max(signerCount, 1) }, (_, i) => i + 1).map((n) => (
                    <option key={n} value={n}>
                      {n}-of-{Math.max(signerCount, 1)}
                    </option>
                  ))}
                </select>
                <Button
                  variant="ghost"
                  disabled={thresholdBusy || thresholdChoice === (org?.quorumThreshold ?? 1)}
                  onClick={saveThreshold}
                >
                  {thresholdBusy ? "Sending…" : "Save"}
                </Button>
              </div>
              {thresholdError ? (
                <p className="mt-2 text-sm text-rose-300">{thresholdError}</p>
              ) : null}
              <p className="mt-2 text-xs text-muted">
                Once the threshold is ≥ 2, changing it again requires quorum
                approval itself — governance can never be changed solo.
              </p>
            </div>

            <div className="rounded-lg border border-line bg-surface2 p-4">
              <p className="text-sm font-medium">Amount tier (single-approver limit)</p>
              <p className="mt-1 text-xs text-muted">
                Payouts ≤ this amount route to the Ops wallet: one quorum
                signer suffices. Above it, the main quorum applies. The Ops
                wallet&apos;s Privy policy cap follows this value.
              </p>
              <div className="mt-3 flex items-center gap-3">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted">$</span>
                  <input
                    className={inputCls}
                    style={{ width: "8rem" }}
                    type="number"
                    min="1"
                    max="10000"
                    value={tierAmount}
                    onChange={(e) => setTierAmount(e.target.value)}
                  />
                </div>
                <Button
                  variant="ghost"
                  disabled={tierBusy || Number(tierAmount) === (org?.tierAmountUsd ?? 300)}
                  onClick={saveTier}
                >
                  {tierBusy ? "Saving…" : "Save"}
                </Button>
              </div>
              {tierError ? (
                <p className="mt-2 text-sm text-rose-300">{tierError}</p>
              ) : null}
            </div>
          </div>
          {ok ? (
            <p className="mt-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">
              {ok}
            </p>
          ) : null}
        </Card>
      ) : null}

      {/* Governance approvals (any quorum member) */}
      {governance.filter((g) => g.intentStatus === "pending" || g.intentStatus === "processing").length > 0 ? (
        <Card className="border-accent/40">
          <h3 className="font-semibold text-accent">Governance approvals</h3>
          <div className="mt-3 space-y-3">
            {governance
              .filter((g) => g.intentStatus === "pending" || g.intentStatus === "processing")
              .map((g) => {
                const signed = g.members.filter((m) => m.signedAt).length;
                return (
                  <div key={g._id} className="rounded-lg border border-line bg-surface2 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium">{g.title}</p>
                        <p className="mt-0.5 text-xs text-muted">
                          {signed}/{g.threshold ?? "?"} signed ·{" "}
                          {g.members.map((m) => (m.signedAt ? `✓ ${m.name}` : `${m.name}`)).join(", ")}
                        </p>
                      </div>
                      <Button
                        disabled={govBusyId !== null}
                        onClick={() => approveGovernance(g._id)}
                      >
                        {govBusyId === g._id ? "Signing…" : "Approve & sign"}
                      </Button>
                    </div>
                  </div>
                );
              })}
          </div>
          {govError ? <p className="mt-2 text-sm text-rose-300">{govError}</p> : null}
        </Card>
      ) : null}

      {/* Members */}
      <Card className="divide-y divide-line p-0">
        {members.map((m) => {
          const isMe = m.privyUserId !== null && m.email === "" && m.role === "owner";
          return (
            <div key={m._id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
              <div className="min-w-0">
                <p className="text-sm font-medium">
                  {isMe ? `You (owner)` : m.email || "—"}
                </p>
                <p className="text-xs text-muted">{ROLE_DESCRIPTIONS[m.role]}</p>
              </div>
              <div className="flex items-center gap-2">
                <Badge tone={m.role === "owner" ? "blue" : m.role === "treasurer" ? "green" : "gray"}>
                  {ROLE_LABELS[m.role]}
                </Badge>
                {m.status === "invited" ? (
                  <Badge tone="amber">invited</Badge>
                ) : null}
                {m.status === "invited" && m.pregenerated ? (
                  <Badge tone="blue">wallet ready</Badge>
                ) : null}
                {m.inQuorum ? <Badge tone="blue">quorum signer</Badge> : null}
                {m.status === "active" && m.role === "treasurer" && !m.inQuorum && myRole === "owner" ? (
                  <Button
                    variant="ghost"
                    disabled={busy !== null}
                    onClick={() =>
                      act(`Added ${m.email} to quorum`, async () => {
                        await api(`/api/members/${m._id}/quorum`, { method: "POST" });
                      })
                    }
                  >
                    {busy === `Added ${m.email} to quorum` ? "Updating quorums…" : "Add to quorum"}
                  </Button>
                ) : null}
                {myInvite && myInvite._id === m._id ? (
                  <Button
                    disabled={busy !== null}
                    onClick={() =>
                      act("Invite accepted", async () => {
                        await api(`/api/members/${m._id}/accept`, { method: "POST" });
                      })
                    }
                  >
                    Accept invite
                  </Button>
                ) : null}
              </div>
            </div>
          );
        })}
      </Card>

      {myRole === "owner" ? (
        <Card className="self-start">
          <h3 className="font-semibold">Invite teammate</h3>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (email.trim()) invite();
            }}
            className="mt-3 space-y-4"
          >
            <Field label="Email">
              <input
                className={inputCls}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="teammate@company.com"
              />
            </Field>
            <Field label="Role">
              <select
                className={inputCls}
                value={role}
                onChange={(e) => setRole(e.target.value as MemberRole)}
              >
                <option value="treasurer">Treasurer — create + approve payouts</option>
                <option value="finance_officer">Finance Officer — create payout requests</option>
                <option value="viewer">Viewer — read-only</option>
              </select>
            </Field>
            {error ? (
              <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
                {error}
              </p>
            ) : null}
            <Button type="submit" disabled={busy !== null || !email.trim()} className="w-full">
              {busy ? "Inviting…" : "Send invite"}
            </Button>
            <p className="text-xs text-muted">
              Flow: invite (their Privy wallet is pregenerated by email, ready
              on first login) → teammate accepts → you add them to the quorums
              → they become a signer.
            </p>
          </form>
        </Card>
      ) : null}
    </div>
  );
}
