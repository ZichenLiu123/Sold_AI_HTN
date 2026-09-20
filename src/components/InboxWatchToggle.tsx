"use client";

import { useEffect, useState } from "react";

type MonitorStatus = {
  enabled?: boolean;
  running?: boolean;
  last_summary?: string;
};

export function InboxWatchToggle({ compact = false }: { compact?: boolean }) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [summary, setSummary] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    const response = await fetch("/api/monitor/facebook", { cache: "no-store" });
    const data = (await response.json()) as MonitorStatus;
    setEnabled(data.enabled !== false);
    setSummary(data.last_summary || "");
  }

  useEffect(() => {
    load().catch(() => setEnabled(true));
  }, []);

  async function toggle() {
    if (enabled == null || busy) return;
    setBusy(true);
    try {
      const response = await fetch("/api/monitor/facebook", {
        method: enabled ? "DELETE" : "POST",
      });
      const data = (await response.json()) as MonitorStatus;
      setEnabled(data.enabled !== false);
      setSummary(data.last_summary || "");
    } finally {
      setBusy(false);
    }
  }

  if (enabled == null) return null;

  if (compact) {
    return (
      <button
        type="button"
        onClick={() => void toggle()}
        disabled={busy}
        className={`font-mono text-[9px] uppercase tracking-[0.16em] ${
          enabled ? "text-sage" : "text-ink/45"
        }`}
      >
        {busy ? "…" : enabled ? "Watch on" : "Watch off"}
      </button>
    );
  }

  return (
    <div className="mt-5 rounded-2xl bg-card px-4 py-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-serif text-xl">Inbox watch</p>
          <p className="mt-1 text-sm text-ink/60">
            {enabled
              ? "Sold checks Facebook, Craigslist, and eBay for real buyer messages."
              : "Off. Sold will not open Chrome to read inboxes."}
          </p>
          {summary && (
            <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.12em] text-ink/40">
              {summary}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => void toggle()}
          disabled={busy}
          className={`shrink-0 rounded-full px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] ${
            enabled ? "bg-sage text-paper" : "border border-line text-ink/55"
          }`}
        >
          {busy ? "…" : enabled ? "On" : "Off"}
        </button>
      </div>
    </div>
  );
}
