"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useApi } from "@/lib/client-api";
import { OrgContext } from "@/lib/dashboard-context";
import type { MemberDoc, MemberRole, OrgDoc, VendorDoc, WalletDoc } from "@/lib/types";

const NAV = [
  { href: "/dashboard", label: "Overview" },
  { href: "/dashboard/payouts", label: "Payouts" },
  { href: "/dashboard/schedules", label: "Automations" },
  { href: "/dashboard/vendors", label: "Vendors" },
  { href: "/dashboard/team", label: "Team" },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { ready, authenticated, user, logout } = usePrivy();
  const api = useApi();

  const [org, setOrg] = useState<OrgDoc | null>(null);
  const [wallets, setWallets] = useState<WalletDoc[]>([]);
  const [vendors, setVendors] = useState<VendorDoc[]>([]);
  const [members, setMembers] = useState<MemberDoc[]>([]);
  const [myRole, setMyRole] = useState<MemberRole | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const data = await api("/api/orgs");
    setOrg(data.org);
    setWallets(data.wallets ?? []);
    setVendors(data.vendors ?? []);
    setMembers(data.members ?? []);
    setMyRole(data.myRole ?? null);
  }, [api]);

  useEffect(() => {
    if (!ready) return;
    if (!authenticated) {
      router.replace("/");
      return;
    }
    (async () => {
      try {
        await refresh();
        setLoadError(null);
      } catch (err) {
        // Show the error in-place with a Retry button — a transient DB/network
        // issue should not look like an auth failure or kick the user out.
        setLoadError(err instanceof Error ? err.message : "Failed to load org");
      } finally {
        setLoading(false);
      }
    })();
  }, [ready, authenticated, refresh, router]);

  useEffect(() => {
    if (!loading && !loadError && !org) router.replace("/onboarding");
  }, [loading, loadError, org, router]);

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center text-muted">
        Loading…
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="max-w-md text-rose-300">
          Couldn&apos;t load your organization: {loadError}
        </p>
        <button
          onClick={() => {
            setLoading(true);
            refresh()
              .then(() => setLoadError(null))
              .catch((err: unknown) =>
                setLoadError(err instanceof Error ? err.message : "Failed to load org"),
              )
              .finally(() => setLoading(false));
          }}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-[#052017] transition-colors hover:bg-accent-dim"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!org) return null;

  return (
    <OrgContext.Provider value={{ org, wallets, vendors, members, myRole, refresh }}>
      <div className="flex min-h-screen flex-col">
        <header className="border-b border-line">
          <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-3">
            <div className="flex items-center gap-3">
              <Link href="/dashboard" className="flex items-center gap-2 text-base font-semibold tracking-tight">
                <span className="text-accent">◆</span> PayPilot
              </Link>
              <span className="text-sm text-muted">/ {org.name}</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="hidden text-sm text-muted sm:inline">{user?.email?.address}</span>
              <button
                onClick={logout}
                className="rounded-lg border border-line px-3 py-1.5 text-sm text-muted transition-colors hover:bg-surface2 hover:text-foreground"
              >
                Sign out
              </button>
            </div>
          </div>
          <nav className="mx-auto flex w-full max-w-6xl gap-1 px-6">
            {NAV.map((item) => {
              const active = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`border-b-2 px-3 py-2.5 text-sm transition-colors ${
                    active
                      ? "border-accent text-foreground"
                      : "border-transparent text-muted hover:text-foreground"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">{children}</main>
      </div>
    </OrgContext.Provider>
  );
}
