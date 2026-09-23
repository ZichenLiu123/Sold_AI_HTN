"use client";

import { useEffect, useState } from "react";
import { InboxWatchToggle } from "@/components/InboxWatchToggle";
import { platformSlug } from "@/lib/platforms";
import { PLATFORMS, type PlatformConnection } from "@/lib/types";

type Connection = PlatformConnection & { live_url?: string | null };

const STATUS_LABEL: Record<PlatformConnection["status"], string> = {
  not_connected: "Not connected",
  awaiting_login: "Awaiting login",
  connected: "Connected",
  expired: "Expired",
  error: "Error",
};

function usesLocalLogin(platform: string) {
  return platform === "Facebook Marketplace" || platform === "eBay";
}

function liveLoginPath(platform: string, fresh = false) {
  return `/api/platforms/${platformSlug(platform)}/live${fresh ? "?fresh=1" : ""}`;
}

function onPhone() {
  if (typeof navigator === "undefined") return false;
  return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
}

function platformRegion(platform: string) {
  if (platform === "Kijiji") return "Canada";
  if (platform === "OfferUp") return "US";
  if (platform === "Mercari" || platform === "Poshmark") return "US + Canada";
  return "US + Canada";
}

function platformCapability(platform: string) {
  if (platform === "Facebook Marketplace") {
    return "Posts and verifies a live URL. Inbox is monitor-only — you reply on Facebook.";
  }
  if (platform === "Kijiji") {
    return `${platformRegion(platform)}. Posts and verifies a live listing URL.`;
  }
  if (platform === "OfferUp") {
    return `${platformRegion(platform)}. Posts and verifies a live listing URL.`;
  }
  if (platform === "Craigslist") {
    return "Posts and verifies a live URL. Drafts replies in Sold — does not send email.";
  }
  if (platform === "Mercari") {
    return `${platformRegion(platform)}. Posts and verifies a live listing URL.`;
  }
  if (platform === "Poshmark") {
    return `${platformRegion(platform)}. Posts and verifies a live listing URL.`;
  }
  if (platform === "eBay") {
    return "Posts and verifies a live URL. Drafts replies in Sold — you send on eBay.";
  }
  return "Connect to post and watch.";
}

function accountHint(
  connection: Connection,
  connected: boolean,
  waiting: boolean,
  hosted: boolean
) {
  if (connected) {
    return connection.metadata.evidence || platformCapability(connection.platform);
  }
  if (waiting) {
    if (hosted) {
      return "Finish login in the live browser tab — Sold will detect it automatically.";
    }
    if (usesLocalLogin(connection.platform) || onPhone()) {
      return "Chrome opened on the computer running Sold — not on this phone. Log in there; Sold will detect it.";
    }
    return "Finish login in the window that opened — Sold will detect it automatically.";
  }
  if (connection.status === "expired") {
    return "Session expired. Reconnect once — Sold still does not store your password.";
  }
  if (connection.status === "error") {
    return (
      connection.error ||
      "Last connect failed. Retry, or recheck the session if you already logged in."
    );
  }
  if (hosted) {
    return "Opens a live browser tab so you can log in from this phone.";
  }
  return "Log in once. Sold reuses the session and does not store your password.";
}

export function PlatformAccounts({ hosted = false }: { hosted?: boolean }) {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [cloudHost, setCloudHost] = useState(hosted);
  const [minutesSpent, setMinutesSpent] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  async function load(options?: { quiet?: boolean }) {
    if (!options?.quiet) setBusy("reload");
    try {
      const response = await fetch("/api/platforms", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load accounts.");
      const next = Array.isArray(data.connections) ? data.connections : [];
      // API should always return one slot per marketplace; if it returns none,
      // keep the list empty so recovery UI can retry instead of inventing state.
      setConnections(next);
      if (typeof data.hosted === "boolean") setCloudHost(data.hosted);
      if (typeof data.remote_minutes_exhausted === "boolean") {
        setMinutesSpent(data.remote_minutes_exhausted);
      }
      setError("");
    } finally {
      if (!options?.quiet) setBusy((current) => (current === "reload" ? "" : current));
    }
  }

  useEffect(() => {
    load({ quiet: true })
      .catch((reason) =>
        setError(reason instanceof Error ? reason.message : "Could not load accounts.")
      )
      .finally(() => setLoading(false));
  }, []);

  // While awaiting login, quietly re-check so Connect flips to Connected without a tap.
  const waitingKey = connections
    .filter((c) => c.status === "awaiting_login")
    .map((c) => c.platform)
    .join("|");

  useEffect(() => {
    if (!waitingKey || loading) return;
    let cancelled = false;
    const platforms = waitingKey.split("|").filter(Boolean);
    const tick = async () => {
      for (const platform of platforms) {
        if (cancelled) continue;
        try {
          const response = await fetch(
            `/api/platforms/${platformSlug(platform)}/check`,
            { method: "POST" }
          );
          const data = await response.json();
          if (!response.ok || cancelled) continue;
          setConnections((current) =>
            current.map((item) => (item.platform === data.platform ? data : item))
          );
          if (data.status === "connected") setBusy("");
        } catch {
          /* keep polling */
        }
      }
    };
    const id = window.setInterval(() => void tick(), 2500);
    void tick();
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [waitingKey, loading]);

  async function watchLocalLogin(platform: string) {
    const slug = platformSlug(platform);
    const started = Date.now();
    while (Date.now() - started < 180_000) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      try {
        const response = await fetch(`/api/platforms/${slug}/check`, { method: "POST" });
        const data = await response.json();
        if (!response.ok) continue;
        setConnections((current) =>
          current.map((item) => (item.platform === data.platform ? data : item))
        );
        if (data.status === "connected") {
          setBusy("");
          return;
        }
      } catch {
        /* keep waiting while the seller finishes login */
      }
    }
    setBusy("");
  }

  async function connectLocal(connection: Connection) {
    const response = await fetch(
      `/api/platforms/${platformSlug(connection.platform)}/local`,
      { method: "POST" }
    );
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not open login.");
    setConnections((current) =>
      current.map((item) => (item.platform === data.platform ? data : item))
    );
    void watchLocalLogin(connection.platform);
  }

  function connect(connection: Connection) {
    setError("");
    if (cloudHost) {
      window.location.assign(liveLoginPath(connection.platform, true));
      return;
    }
    setBusy(connection.platform);
    void (async () => {
      try {
        if (
          usesLocalLogin(connection.platform) ||
          (minutesSpent && connection.platform === "Craigslist")
        ) {
          await connectLocal(connection);
          return;
        }
        window.location.assign(liveLoginPath(connection.platform, true));
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "Could not open login.");
        setBusy("");
      }
    })();
  }

  async function disconnect(connection: Connection) {
    setBusy(`${connection.platform}:disconnect`);
    setError("");
    try {
      const response = await fetch(
        `/api/platforms/${platformSlug(connection.platform)}/disconnect`,
        { method: "POST" }
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not disconnect.");
      setConnections((current) =>
        current.map((item) => (item.platform === data.platform ? data : item))
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not disconnect.");
    } finally {
      setBusy("");
    }
  }

  async function check(connection: Connection) {
    setBusy(`${connection.platform}:check`);
    setError("");
    try {
      const response = await fetch(
        `/api/platforms/${platformSlug(connection.platform)}/check`,
        { method: "POST" }
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Check failed.");
      setConnections((current) =>
        current.map((item) => (item.platform === data.platform ? data : item))
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Check failed.");
    } finally {
      setBusy("");
    }
  }

  return (
    <>
      <InboxWatchToggle />
      {minutesSpent && !cloudHost && (
        <p className="mt-4 rounded-xl border border-line bg-wash px-3.5 py-2.5 text-[13px] text-grey">
          Remote browser minutes are used up. Craigslist will open in Chrome on this
          Mac instead of Browserbase.
        </p>
      )}
      {minutesSpent && cloudHost && (
        <p className="mt-4 rounded-xl border border-line bg-wash px-3.5 py-2.5 text-[13px] text-grey">
          Remote browser minutes are used up. Connect Craigslist from Sold on a laptop
          with Chrome, or wait until minutes reset.
        </p>
      )}
      {error && connections.length > 0 && (
        <p className="mt-4 rounded-xl border border-line bg-wash px-3.5 py-2.5 text-[13px] text-stamp">
          {error}
        </p>
      )}
      {loading ? (
        <ul className="mt-6 space-y-3">
          {PLATFORMS.map((name) => (
            <li key={name} className="panel px-4 py-4">
              <p className="text-[16px] font-semibold tracking-tight text-ink">{name}</p>
              <p className="mt-1.5 text-[12px] text-grey">Checking session…</p>
              <div className="mt-3 h-10 w-full animate-pulse rounded-lg bg-wash" />
            </li>
          ))}
        </ul>
      ) : connections.length === 0 ? (
        <div className="mt-6 rounded-xl border border-line bg-card px-4 py-5">
          <p className="text-[15px] font-medium tracking-tight text-ink">
            Marketplace slots didn&apos;t load
          </p>
          <p className="mt-1.5 text-[13px] leading-relaxed text-grey">
            {error
              ? "Sold couldn&apos;t reach your accounts. Try again — nothing was disconnected."
              : "No marketplace slots came back. Retry to restore Facebook, Kijiji, and the rest."}
          </p>
          <button
            type="button"
            onClick={() => {
              setLoading(true);
              setError("");
              load()
                .catch((reason) =>
                  setError(
                    reason instanceof Error ? reason.message : "Could not load accounts."
                  )
                )
                .finally(() => setLoading(false));
            }}
            disabled={busy === "reload"}
            className="btn-primary mt-4 h-10 w-full text-[13px]"
          >
            {busy === "reload" ? "Loading…" : "Try again"}
          </button>
        </div>
      ) : (
        <ul className="mt-6 space-y-3">
          {connections.map((connection) => {
            const waiting = connection.status === "awaiting_login";
            const connected = connection.status === "connected";
            const expired = connection.status === "expired";
            const errored = connection.status === "error";
            return (
              <li key={connection.platform} className="panel px-4 py-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[16px] font-semibold tracking-tight text-ink">
                    {connection.platform}
                  </p>
                  <span
                    className={`stamp ${
                      connected
                        ? "badge-live"
                        : waiting
                          ? "badge-submitted"
                          : expired || errored
                            ? "badge-submitted"
                            : "badge-draft"
                    }`}
                  >
                    {STATUS_LABEL[connection.status]}
                  </span>
                </div>
                <p className="mt-1.5 text-[13px] leading-relaxed text-grey">
                  {accountHint(connection, connected, waiting, cloudHost)}
                </p>
                {connection.error && (
                  <p className="mt-2 text-[12px] text-stamp">{connection.error}</p>
                )}
                {connected ? (
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => void check(connection)}
                      disabled={Boolean(busy)}
                      className="btn-secondary h-10 text-[13px]"
                    >
                      {busy === `${connection.platform}:check`
                        ? "Checking…"
                        : "Recheck"}
                    </button>
                    <button
                      type="button"
                      onClick={() => void disconnect(connection)}
                      disabled={Boolean(busy)}
                      className="btn-secondary h-10 text-[13px]"
                    >
                      {busy === `${connection.platform}:disconnect`
                        ? "Disconnecting…"
                        : "Disconnect"}
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => connect(connection)}
                    disabled={Boolean(busy)}
                    className="btn-primary mt-3 h-10 w-full text-[13px]"
                  >
                    {busy === connection.platform
                      ? "Opening…"
                      : waiting
                        ? "Open login again"
                        : expired
                          ? `Reconnect ${connection.platform.replace(" Marketplace", "")}`
                          : errored
                            ? `Retry ${connection.platform.replace(" Marketplace", "")}`
                            : `Connect ${connection.platform.replace(" Marketplace", "")}`}
                  </button>
                )}
                {waiting && (
                  <button
                    type="button"
                    onClick={() => void check(connection)}
                    disabled={Boolean(busy)}
                    className="btn-secondary mt-2 h-10 w-full text-[13px]"
                  >
                    I finished logging in
                  </button>
                )}
                {(expired || errored) && !waiting && (
                  <button
                    type="button"
                    onClick={() => void check(connection)}
                    disabled={Boolean(busy)}
                    className="btn-secondary mt-2 h-10 w-full text-[13px]"
                  >
                    {busy === `${connection.platform}:check`
                      ? "Checking…"
                      : "Recheck session"}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
