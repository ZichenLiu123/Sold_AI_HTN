"use client";

import { useEffect, useState } from "react";
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

function loginWindowName(platform: string) {
  return `sold-login-${platformSlug(platform)}`;
}

function liveLoginPath(platform: string, fresh = false) {
  return `/api/platforms/${platformSlug(platform)}/live${fresh ? "?fresh=1" : ""}`;
}

function accountHint(connection: Connection, connected: boolean, waiting: boolean) {
  if (connected) {
    return (
      connection.metadata.evidence ||
      "Connected. Sold watches your inbox. A chat appears only when a person writes you."
    );
  }
  if (waiting) {
    return usesLocalLogin(connection.platform)
      ? "Finish login in the window that opened. Sold marks this connected and starts watching by itself."
      : "Finish login in the window that opened, then tap check if Sold hasn’t caught up.";
  }
  return "Log in once. Sold starts watching after that.";
}

function popupHtml(platform: string, title: string, body: string) {
  const href = liveLoginPath(platform);
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${title}</title>
  </head>
  <body style="margin:0;background:#f6f1e8;color:#1c1917;font:16px/1.45 ui-sans-serif,system-ui,sans-serif">
    <main style="max-width:28rem;margin:20vh auto;padding:0 1.5rem">
      <p style="letter-spacing:.18em;text-transform:uppercase;font:11px ui-monospace,monospace;opacity:.5">Sold</p>
      <h1 style="font-family:Georgia,serif;font-size:1.8rem;font-weight:500">${title}</h1>
      <p id="status" style="opacity:.7">${body} If this tab does not switch, use the link:</p>
      <p style="margin-top:1.25rem">
        <a href="${href}" style="display:inline-block;background:#1c1917;color:#f6f1e8;text-decoration:none;border-radius:999px;padding:.75rem 1.1rem;font-size:.85rem">Open live login</a>
      </p>
    </main>
  </body>
</html>`;
}

function writePopup(
  popup: Window | null,
  platform: string,
  title: string,
  body: string
) {
  if (!popup) return;
  popup.document.open();
  popup.document.write(popupHtml(platform, title, body));
  popup.document.close();
}

export function PlatformAccounts() {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  async function load() {
    const response = await fetch("/api/platforms", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not load accounts.");
    setConnections(data.connections);
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

  async function connectRemote(connection: Connection) {
    const popup = window.open("about:blank", loginWindowName(connection.platform));
    writePopup(
      popup,
      connection.platform,
      `Opening ${connection.platform}`,
      "Hang on — this tab will switch to the live login as soon as it’s ready."
    );
    const response = await fetch(
      `/api/platforms/${platformSlug(connection.platform)}/connect`,
      { method: "POST" }
    );
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not open login.");
    setConnections((current) =>
      current.map((item) => (item.platform === data.platform ? data : item))
    );
    if (data.live_url) {
      if (popup) popup.location.replace(data.live_url);
      else window.open(data.live_url, "_blank", "noopener,noreferrer");
      return;
    }
    writePopup(
      popup,
      connection.platform,
      "Login window missing",
      "The login browser did not return a live view. Close this tab and press Connect again."
    );
    throw new Error("The login window opened, but no live view came back. Press Connect again.");
  }

  async function connect(connection: Connection) {
    setBusy(connection.platform);
    setError("");
    try {
      if (usesLocalLogin(connection.platform)) {
        await connectLocal(connection);
        return;
      }
      try {
        await connectRemote(connection);
      } catch {
        await connectLocal(connection);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not open login.");
    } finally {
      setBusy("");
    }
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
                {accountHint(connection, connected, waiting)}
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
                  onClick={() => void connect(connection)}
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
