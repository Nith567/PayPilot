"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { usePrivy } from "@privy-io/react-auth";
import { useApi } from "@/lib/client-api";
import { ROLE_LABELS } from "@/lib/types";
import { Badge, Button } from "@/app/ui";

interface InviteRow {
  _id: string;
  orgName: string;
  role: keyof typeof ROLE_LABELS;
  pregenerated?: boolean;
}

const FEATURES = [
  {
    icon: "🏦",
    title: "Organization wallets",
    body: "Every org gets real self-custodial wallets (up to 150) owned by its key quorum — never by the app.",
  },
  {
    icon: "👥",
    title: "2-of-N team quorum",
    body: "Invite employees as signers and set your own threshold. Payroll to big vendors: any two of your team must sign. Small payouts: a single approver.",
  },
  {
    icon: "🛡️",
    title: "Policies in the signing enclave",
    body: "Vendor allowlists, per-transaction caps and chain rules evaluated by Privy's enclave at signature time. Default deny.",
  },
  {
    icon: "⚡",
    title: "Async approval intents",
    body: "Every payout is an intent. Approvers sign from any device; Privy executes automatically when the threshold is met.",
  },
];

export default function Home() {
  const router = useRouter();
  const { ready, authenticated, login, logout, user } = usePrivy();
  const api = useApi();
  const [pending, setPending] = useState<null | "own">(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sdkSlow, setSdkSlow] = useState(false);
  const [invites, setInvites] = useState<InviteRow[]>([]);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);

  // After login, surface pending invites right here on the landing page —
  // an invited employee shouldn't have to guess which button to press.
  useEffect(() => {
    if (!ready || !authenticated) return;
    let cancelled = false;
    api("/api/invites")
      .then(({ invites: list }) => {
        if (!cancelled) setInvites(list ?? []);
      })
      .catch(() => {
        /* invites are best-effort discovery */
      });
    return () => {
      cancelled = true;
    };
  }, [ready, authenticated, api]);

  const acceptInvite = async (invite: InviteRow) => {
    setAcceptingId(invite._id);
    setError(null);
    try {
      await api(`/api/members/${invite._id}/accept`, { method: "POST" });
      router.push("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Accept failed");
      setAcceptingId(null);
    }
  };

  // Watchdog: if Privy never reports ready, say so instead of dead buttons.
  // (State is only set from the timeout callback — never synchronously.)
  useEffect(() => {
    if (ready) return;
    const timer = setTimeout(() => setSdkSlow(true), 5000);
    return () => clearTimeout(timer);
  }, [ready]);

  // Runs the pending action once the Privy SDK is ready + authenticated
  // (e.g. right after the login modal completes).
  useEffect(() => {
    if (!ready || !authenticated || !pending || busy) return;
    let cancelled = false;
    (async () => {
      setBusy(true);
      setError(null);
      try {
        const { org } = await api("/api/orgs");
        if (!cancelled) router.push(org ? "/dashboard" : "/onboarding");
      } catch (err) {
        console.error(err);
        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : "Request failed — check the server log",
          );
          setPending(null);
          setBusy(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, authenticated, pending, busy, api, router]);

  const start = () => {
    setError(null);
    if (!ready) {
      setError("Privy is still loading — give it a second and try again.");
      return;
    }
    if (authenticated) {
      // Already signed in: run the action directly (visible feedback, no
      // reliance on effect chains).
      setPending("own");
      setBusy(true);
      api("/api/orgs")
        .then(({ org }) => router.push(org ? "/dashboard" : "/onboarding"))
        .catch((err: unknown) => {
          setError(err instanceof Error ? err.message : "Request failed");
          setBusy(false);
          setPending(null);
        });
      return;
    }
    // Not signed in: open the Privy login modal; the effect above resumes
    // the action after authentication completes.
    setPending("own");
    login();
  };

  return (
    <div className="flex flex-1 flex-col">
      <header className="flex items-center justify-between px-6 py-4">
        <div className="flex items-center gap-2 text-lg font-semibold tracking-tight">
          <span className="text-accent">◆</span> PayPilot
        </div>
        <div className="flex items-center gap-3">
          {ready && authenticated ? (
            <>
              <span className="text-sm text-muted">{user?.email?.address}</span>
              <Button variant="ghost" onClick={logout}>
                Sign out
              </Button>
            </>
          ) : (
            <Button variant="ghost" onClick={() => login()}>
              Sign in
            </Button>
          )}
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col items-center px-6 pb-20 pt-10 text-center">
        <p className="mb-4 rounded-full border border-accent/30 bg-accent/10 px-3 py-1 text-xs font-medium text-accent">
          Best B2B financial product · built on Privy
        </p>
        <h1 className="max-w-3xl text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">
          Your money autopilot — flying inside{" "}
          <span className="bg-gradient-to-r from-emerald-400 via-teal-300 to-cyan-300 bg-clip-text text-transparent">
            policy, not trust
          </span>
          .
        </h1>
        <p className="mt-5 max-w-2xl text-lg text-muted">
          Treasury, payroll, vendor payouts and scheduled sends on organization
          wallets — with allowlists, caps and quorum approvals enforced by
          Privy at signature time, not by a database someone can edit.
        </p>

        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <Button onClick={start} disabled={busy} className="h-12 px-6 text-base">
            {busy && pending === "own" ? "Loading your org…" : "Create your organization →"}
          </Button>
        </div>

        {invites.length > 0 ? (
          <div className="mt-8 w-full max-w-xl rounded-xl border border-accent/40 bg-accent/5 p-5 text-left">
            <p className="text-sm font-semibold text-accent">You&apos;re invited 🎟</p>
            <div className="mt-3 space-y-3">
              {invites.map((invite) => (
                <div
                  key={invite._id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-surface p-3"
                >
                  <div>
                    <p className="text-sm font-medium">{invite.orgName}</p>
                    <div className="mt-1 flex items-center gap-2">
                      <Badge tone="green">{ROLE_LABELS[invite.role]}</Badge>
                      {invite.pregenerated ? <Badge tone="blue">wallet ready</Badge> : null}
                    </div>
                  </div>
                  <Button
                    disabled={acceptingId !== null}
                    onClick={() => acceptInvite(invite)}
                  >
                    {acceptingId === invite._id ? "Accepting…" : "Accept & open dashboard"}
                  </Button>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {!ready && sdkSlow ? (
          <p className="mt-4 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
            Privy is taking too long to initialize — hard-refresh the page
            (Cmd+Shift+R). If that doesn&apos;t help, check the browser console.
          </p>
        ) : null}

        {error ? (
          <p className="mt-4 max-w-xl rounded-lg border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
            {error}
          </p>
        ) : null}

        <div className="mt-16 grid w-full gap-4 text-left sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map((f) => (
            <div key={f.title} className="rounded-xl border border-line bg-surface p-5 transition-colors hover:border-accent/30">
              <div className="text-2xl">{f.icon}</div>
              <h3 className="mt-2 text-sm font-semibold">{f.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">{f.body}</p>
            </div>
          ))}
        </div>

        <p className="mt-16 text-sm text-muted">
          Test USDC on Base Sepolia — nothing real at risk.{" "}
          <a className="text-accent hover:underline" href="https://github.com/Nith567/PayPilot" target="_blank" rel="noreferrer">Source on GitHub</a>.
        </p>
      </main>
    </div>
  );
}
