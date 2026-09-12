"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useApi } from "@/lib/client-api";
import { Button, Card, StatusChip } from "@/app/ui";
import type { PayoutDoc } from "@/lib/types";

export default function PayoutsPage() {
  const api = useApi();
  const [payouts, setPayouts] = useState<PayoutDoc[]>([]);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const { payouts: list } = await api("/api/payouts");
        if (alive) setPayouts(list ?? []);
      } catch {
        /* ignore */
      }
    };
    load();
    const timer = setInterval(() => {
      if (payouts.some((p) => p.status === "pending")) load();
    }, 8000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [api]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Payouts</h1>
          <p className="mt-1 text-sm text-muted">
            Request → policy pre-check → quorum intent → executed onchain
          </p>
        </div>
        <Link href="/dashboard/payouts/new">
          <Button>New payout</Button>
        </Link>
      </div>

      <Card className="divide-y divide-line p-0">
        {payouts.length === 0 ? (
          <p className="p-5 text-sm text-muted">No payouts yet.</p>
        ) : (
          payouts.map((p) => (
            <Link
              key={p._id}
              href={`/dashboard/payouts/${p._id}`}
              className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3.5 transition-colors hover:bg-surface2"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  ${p.amountUsdc.toLocaleString()} → {p.vendorName ?? p.recipient.slice(0, 10) + "…"}
                </p>
                <p className="text-xs text-muted">
                  {p.walletName} · {new Date(p.createdAt).toLocaleString()}
                </p>
              </div>
              <span className="text-xs text-muted">
                {p.signedBy.length > 0 ? `${p.signedBy.join(" + ")}` : "0/2 signed"}
              </span>
              <StatusChip status={p.status} />
            </Link>
          ))
        )}
      </Card>
    </div>
  );
}
