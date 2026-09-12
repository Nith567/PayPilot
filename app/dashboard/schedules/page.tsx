"use client";

import { useCallback, useEffect, useState } from "react";
import { useApi } from "@/lib/client-api";
import { useOrg } from "@/lib/dashboard-context";
import type { ScheduleDoc, ScheduleFrequency } from "@/lib/types";
import { Badge, Button, Card, Field, inputCls } from "@/app/ui";

const FREQ_LABEL: Record<ScheduleFrequency, string> = {
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
  once: "One-shot",
};

export default function SchedulesPage() {
  const { vendors, refresh } = useOrg();
  const api = useApi();

  const [schedules, setSchedules] = useState<ScheduleDoc[]>([]);
  const [recipient, setRecipient] = useState(vendors[0]?.address ?? "");
  const [amount, setAmount] = useState("");
  const [frequency, setFrequency] = useState<ScheduleFrequency>("weekly");
  const [startInMinutes, setStartInMinutes] = useState("1");
  const [memo, setMemo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const { schedules: list } = await api("/api/schedules");
      setSchedules(list ?? []);
    } catch {
      /* ignore */
    }
  }, [api]);

  useEffect(() => {
    // load only sets state after awaits.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    // Local tick: without the Vercel cron, due schedules fire while the app
    // is open. (Cron covers production.)
    const tick = async () => {
      try {
        await api("/api/schedules/tick", { method: "POST" });
        await load();
      } catch {
        /* ignore */
      }
    };
    const timer = setInterval(tick, 30_000);
    return () => clearInterval(timer);
  }, [load, api]);

  const create = async () => {
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      await api("/api/schedules", {
        method: "POST",
        body: JSON.stringify({
          recipient,
          amountUsdc: Number(amount),
          frequency,
          startInMinutes: Number(startInMinutes),
          memo,
        }),
      });
      setAmount("");
      setOk(`Schedule created — first payout fires in ${startInMinutes} min, then ${frequency}`);
      await load();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create schedule");
    } finally {
      setBusy(false);
    }
  };

  const act = async (id: string, action: "pause" | "resume" | "delete") => {
    try {
      await api(`/api/schedules/${id}`, {
        method: "POST",
        body: JSON.stringify({ action }),
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Scheduled payouts</h1>
        <p className="mt-1 text-sm text-muted">
          Automation with the same rules as humans: when a schedule fires, it
          enters the normal payout pipeline — tier routing, policy gates,
          quorum approval. Policy can pause automation automatically.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_400px]">
        <Card className="divide-y divide-line self-start p-0">
          {schedules.length === 0 ? (
            <p className="p-5 text-sm text-muted">
              No schedules yet — create one: &quot;$X to vendor every
              week&quot;.
            </p>
          ) : (
            schedules.map((s) => (
              <div key={s._id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    ${s.amountUsdc.toLocaleString()} → {s.vendorName ?? s.recipient.slice(0, 10) + "…"}
                  </p>
                  <p className="mt-0.5 text-xs text-muted">
                    {FREQ_LABEL[s.frequency]} · next run{" "}
                    {s.status === "active"
                      ? new Date(s.nextRunAt).toLocaleString()
                      : "—"}{" "}
                    · {s.memo || "no memo"}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge
                    tone={
                      s.status === "active"
                        ? "green"
                        : s.status === "paused"
                          ? "amber"
                          : "gray"
                    }
                  >
                    {s.status}
                  </Badge>
                  {s.status === "active" ? (
                    <Button variant="ghost" onClick={() => act(s._id, "pause")}>
                      Pause
                    </Button>
                  ) : null}
                  {s.status === "paused" ? (
                    <Button variant="ghost" onClick={() => act(s._id, "resume")}>
                      Resume
                    </Button>
                  ) : null}
                  <Button variant="danger" onClick={() => act(s._id, "delete")}>
                    Delete
                  </Button>
                </div>
              </div>
            ))
          )}
        </Card>

        <Card className="self-start">
          <h3 className="font-semibold">New schedule</h3>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (recipient && amount) create();
            }}
            className="mt-3 space-y-4"
          >
            <Field label="Vendor (policy allowlisted)">
              <select
                className={inputCls}
                value={recipient}
                onChange={(e) => setRecipient(e.target.value)}
              >
                {vendors.map((v) => (
                  <option key={v._id} value={v.address}>
                    {v.name} — {v.address.slice(0, 10)}…
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Amount (USDC)">
              <input
                className={inputCls}
                type="number"
                min="1"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="e.g. 20"
              />
            </Field>
            <Field label="Frequency">
              <select
                className={inputCls}
                value={frequency}
                onChange={(e) => setFrequency(e.target.value as ScheduleFrequency)}
              >
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
                <option value="once">One-shot</option>
              </select>
            </Field>
            <Field label="First run in (minutes)" hint="Small for demoing; the ticker fires due schedules">
              <input
                className={inputCls}
                type="number"
                min="1"
                max="1440"
                value={startInMinutes}
                onChange={(e) => setStartInMinutes(e.target.value)}
              />
            </Field>
            <Field label="Memo">
              <input
                className={inputCls}
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
                placeholder="e.g. Retainer — infrastructure support"
                maxLength={280}
              />
            </Field>
            {ok ? (
              <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">
                {ok}
              </p>
            ) : null}
            {error ? (
              <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
                {error}
              </p>
            ) : null}
            <Button
              type="submit"
              disabled={busy || !recipient || !amount}
              className="w-full"
            >
              {busy ? "Creating…" : "Create schedule"}
            </Button>
            <p className="text-xs text-muted">
              When it fires, the payout appears in the Payouts list like any
              request — small amounts route to the Ops wallet (single signer),
              larger ones need the full quorum.
            </p>
          </form>
        </Card>
      </div>
    </div>
  );
}
