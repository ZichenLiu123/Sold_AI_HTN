"use client";

import { useEffect, useState } from "react";

type MonitorStatus = {
  enabled?: boolean;
  running?: boolean;
  ticking?: boolean;
  last_summary?: string;
  last_tick_at?: string | null;
  last_error?: string | null;
  interval_ms?: number;
  scraped?: number;
  replied?: number;
  escalated?: number;
};

function formatTick(iso: string | null | undefined) {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  const ago = Math.max(0, Date.now() - ms);
  if (ago < 60_000) return "just now";
  if (ago < 3_600_000) return `${Math.floor(ago / 60_000)}m ago`;
  return `${Math.floor(ago / 3_600_000)}h ago`;
}

export function InboxWatchToggle({ compact = false }: { compact?: boolean }) {
  const [status, setStatus] = useState<MonitorStatus | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    const response = await fetch("/api/monitor/facebook", { cache: "no-store" });
    const data = (await response.json()) as MonitorStatus;
    setStatus(data);
  }

  useEffect(() => {
    load().catch(() =>
      setStatus({ enabled: true, last_summary: "Could not read watch status." })
    );
    const id = window.setInterval(() => {
      load().catch(() => undefined);
    }, 20_000);
    return () => window.clearInterval(id);
  }, []);

  async function toggle() {
    if (!status || busy) return;
    const enabled = status.enabled !== false;
    setBusy(true);
    try {
      const response = await fetch("/api/monitor/facebook", {
        method: enabled ? "DELETE" : "POST",
      });
      const data = (await response.json()) as MonitorStatus;
      setStatus(data);
    } finally {
      setBusy(false);
    }
  }

  if (!status) return null;
  const enabled = status.enabled !== false;
  const tick = formatTick(status.last_tick_at);
  const health = !enabled
    ? null
    : status.last_error
      ? `error · ${status.last_error}`
      : status.ticking
        ? "checking now"
        : status.running
          ? tick
            ? `last check ${tick}`
            : "running"
          : "on · waiting for first check";

  if (compact) {
    return (
      <button
        type="button"
        onClick={() => void toggle()}
        disabled={busy}
        title={status.last_summary || health || undefined}
        className={`text-[13px] font-semibold ${enabled ? "text-ink" : "text-grey"}`}
      >
        {busy ? "…" : enabled ? "Watch on" : "Watch off"}
      </button>
    );
  }

  return (
    <div className="mt-5 panel px-4 py-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[15px] font-semibold tracking-tight text-ink">Inbox watch</p>
          <p className="mt-1.5 text-[13px] leading-relaxed text-grey">
            {enabled
              ? "Sold checks Facebook, Craigslist, and eBay on a timer and drafts replies in Sold — never auto-sends. Facebook stays monitor-only."
              : "Off. Sold will not open Chrome to read inboxes."}
          </p>
          <p className="mt-2 text-[12px] text-grey">{health}</p>
          {status.last_summary && (
            <p className="mt-1 text-[12px] text-grey">{status.last_summary}</p>
          )}
        </div>
        <button
          type="button"
          onClick={() => void toggle()}
          disabled={busy}
          className={`shrink-0 rounded-full px-3.5 py-1.5 text-[12px] font-semibold ${
            enabled
              ? "bg-ink text-paper"
              : "border border-line text-ink hover:bg-wash"
          }`}
        >
          {busy ? "…" : enabled ? "On" : "Off"}
        </button>
      </div>
    </div>
  );
}
