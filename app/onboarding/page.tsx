"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { usePrivy } from "@privy-io/react-auth";
import { useApi } from "@/lib/client-api";
import { ROLE_LABELS } from "@/lib/types";
import { Badge, Button, Card, Field, inputCls } from "@/app/ui";

interface InviteRow {
  _id: string;
  orgName: string;
  role: keyof typeof ROLE_LABELS;
  pregenerated?: boolean;
}

export default function OnboardingPage() {
  const router = useRouter();
  const { ready, authenticated, user } = usePrivy();
  const api = useApi();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invites, setInvites] = useState<InviteRow[]>([]);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);

  const loadInvites = useCallback(async () => {
    try {
      const { invites: list } = await api("/api/invites");
      setInvites(list ?? []);
    } catch {
      /* ignore — invites are best-effort discovery */
    }
  }, [api]);

  useEffect(() => {
    if (ready && !authenticated) router.replace("/");
  }, [ready, authenticated, router]);

  useEffect(() => {
    // loadInvites only sets state after awaits — not a synchronous setState.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (ready && authenticated) loadInvites();
  }, [ready, authenticated, loadInvites]);

  const accept = async (invite: InviteRow) => {
    setAcceptingId(invite._id);
    setInviteError(null);
    try {
      await api(`/api/members/${invite._id}/accept`, { method: "POST" });
      router.push("/dashboard");
    } catch (err) {
      setInviteError(err instanceof Error ? err.message : "Accept failed");
      setAcceptingId(null);
    }
  };

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      await api("/api/orgs", { method: "POST", body: JSON.stringify({ name }) });
      router.push("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setBusy(false);
    }
  };

  if (!ready || !authenticated) return null;

  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-6 py-20">
      {invites.length > 0 ? (
        <Card className="mb-6 border-accent/40">
          <h2 className="font-semibold text-accent">You&apos;re invited</h2>
          <div className="mt-3 space-y-3">
            {invites.map((invite) => (
              <div key={invite._id} className="rounded-lg border border-line bg-surface2 p-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium">{invite.orgName}</p>
                    <div className="mt-1 flex items-center gap-2">
                      <Badge tone="green">{ROLE_LABELS[invite.role]}</Badge>
                      {invite.pregenerated ? <Badge tone="blue">wallet ready</Badge> : null}
                    </div>
                  </div>
                  <Button
                    disabled={acceptingId !== null}
                    onClick={() => accept(invite)}
                  >
                    {acceptingId === invite._id ? "Accepting…" : "Accept"}
                  </Button>
                </div>
              </div>
            ))}
          </div>
          {inviteError ? (
            <p className="mt-3 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
              {inviteError}
            </p>
          ) : null}
          <p className="mt-3 text-xs text-muted">
            Or create your own organization below — accepting is optional.
          </p>
        </Card>
      ) : null}

      <h1 className="text-2xl font-semibold tracking-tight">Create your organization</h1>
      <p className="mt-2 text-sm text-muted">
        Signed in as {user?.email?.address}. This creates a Privy organization
        with a <span className="text-foreground">key quorum for your whole team</span> —
        it starts with you, and as you invite employees (Treasurer, Finance
        Officer…) you add them as signers. Set your approval policy in
        Settings: small payouts execute with a single signer, larger ones
        need the full quorum. Plus Treasury and Ops wallets on Base Sepolia.
      </p>

      <Card className="mt-6">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) create();
          }}
          className="space-y-4"
        >
          <Field label="Organization name">
            <input
              className={inputCls}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Northwind Labs"
              maxLength={100}
              autoFocus
            />
          </Field>
          {error ? (
            <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
              {error}
            </p>
          ) : null}
          <Button type="submit" disabled={busy || !name.trim()} className="w-full">
            {busy ? "Creating…" : "Create organization →"}
          </Button>
        </form>
      </Card>
    </div>
  );
}
