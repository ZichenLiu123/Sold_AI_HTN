"use client";

import { useEffect, useState } from "react";
import { InboxWatchToggle } from "@/components/InboxWatchToggle";
import { platformSlug } from "@/lib/platforms";
import type { PlatformConnection } from "@/lib/types";

type Connection = PlatformConnection & { live_url?: string | null };

const STATUS_LABEL: Record<PlatformConnection["status"], string> = {
  not_connected: "not connected",
  awaiting_login: "awaiting login",
  connected: "connected",
  expired: "expired",
  error: "error",
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

function accountHint(
  connection: Connection,
  connected: boolean,
  waiting: boolean,
  hosted: boolean
) {
  if (connected) {
    return (
      connection.metadata.evidence ||
      "Connected. Sold watches your inbox. A chat appears only when a person writes you."
    );
  }
  if (waiting) {
    if (hosted) {
      return "Finish login in the live browser tab, come back here, then tap I finished logging in.";
    }
    if (usesLocalLogin(connection.platform) || onPhone()) {
      return "Chrome opened on the computer running Sold — not on this phone. Log in there, then tap I finished logging in.";
    }
    return "Finish login in the window that opened, then tap I finished logging in.";
  }
  if (hosted) {
    return "Opens a live browser tab so you can log in from this phone.";
  }
  return "Log in once. Sold starts watching after that.";
}

export function PlatformAccounts({ hosted = false }: { hosted?: boolean }) {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [cloudHost, setCloudHost] = useState(hosted);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  async function load() {
    const response = await fetch("/api/platforms", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not load accounts.");
    setConnections(data.connections);
    if (typeof data.hosted === "boolean") setCloudHost(data.hosted);
  }

  useEffect(() => {
    load().catch((reason) =>
      setError(reason instanceof Error ? reason.message : "Could not load accounts.")
    );
  }, []);

  async function watchLocalLogin(platform: string) {
    const slug = platformSlug(platform);
    const started = Date.now();
    while (Date.now() - started < 180_000) {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      try {
        const response = await fetch(`/api/platforms/${slug}/check`, { method: "POST" });
        const data = await response.json();
        if (!response.ok) continue;
        setConnections((current) =>
          current.map((item) => (item.platform === data.platform ? data : item))
        );
        if (data.status === "connected") return;
      } catch {
        /* keep waiting while the seller finishes login */
      }
    }
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
        if (usesLocalLogin(connection.platform)) {
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
      {error && <p className="mt-4 rounded-xl bg-wash px-3 py-2 text-sm text-sold">{error}</p>}
      <ul className="mt-6 space-y-3">
        {connections.map((connection) => {
          const waiting = connection.status === "awaiting_login";
          const connected = connection.status === "connected";
          return (
            <li key={connection.platform} className="rounded-2xl bg-card px-4 py-4">
              <div className="flex items-center justify-between gap-2">
                <p className="font-serif text-xl">{connection.platform}</p>
                <span className={`stamp ${connected ? "text-sage" : waiting ? "text-gold" : "text-ink/50"}`}>
                  {STATUS_LABEL[connection.status]}
                </span>
              </div>
              <p className="mt-1 text-sm text-ink/60">
                {accountHint(connection, connected, waiting, cloudHost)}
              </p>
              {connection.error && <p className="mt-2 text-xs text-sold">{connection.error}</p>}
              {connected ? (
                <button
                  type="button"
                  onClick={() => void disconnect(connection)}
                  disabled={Boolean(busy)}
                  className="mt-3 h-10 w-full rounded-full border border-line px-3 text-xs disabled:opacity-50"
                >
                  {busy === `${connection.platform}:disconnect`
                    ? "Disconnecting…"
                    : "Disconnect"}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => connect(connection)}
                  disabled={Boolean(busy)}
                  className="mt-3 h-10 w-full rounded-full bg-ink px-3 text-xs text-paper disabled:opacity-50"
                >
                  {busy === connection.platform
                    ? "Opening…"
                    : waiting
                      ? "Open login again"
                      : "Connect"}
                </button>
              )}
              {waiting && (
                <button
                  type="button"
                  onClick={() => void check(connection)}
                  disabled={Boolean(busy)}
                  className="mt-2 h-10 w-full rounded-full border border-sage text-xs text-sage disabled:opacity-40"
                >
                  I finished logging in
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}
