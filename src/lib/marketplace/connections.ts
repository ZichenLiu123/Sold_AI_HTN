import {
  getPlatformConnection,
  listPlatformConnections,
  upsertPlatformConnection,
} from "../db";
import {
  PLATFORMS,
  type Platform,
  type PlatformConnection,
} from "../types";
import { sellerId } from "../seller-context";
import { getMarketplaceAdapter } from "./adapters";
import { platformSlug } from "../platforms";
import { statusFromLoginEvidence } from "./policy";
import {
  connectToSession,
  createMarketplaceSession,
  createPersistentContext,
  disconnectSession,
  getBrowserbaseSession,
  openLoginPage,
  releaseSession,
  releaseSoldSessions,
  remoteMinutesExhausted,
  sessionLiveUrl,
  startMarketplaceSession,
} from "./browserbase";
import { isLocalConnection, openLocalLogin } from "./local-browser";

export { remoteMinutesExhausted };

export type PublicConnection = PlatformConnection & { live_url?: string | null };

const loginLocks = globalThis as unknown as {
  soldBeginConnection?: Map<string, Promise<PublicConnection>>;
};

function emptyConnection(platform: Platform): PlatformConnection {
  const now = new Date().toISOString();
  return {
    user_id: sellerId(),
    platform,
    context_id: null,
    session_id: null,
    status: "not_connected",
    created_at: now,
    updated_at: now,
    checked_at: null,
    error: null,
    metadata: {},
  };
}

export async function getLiveLoginUrl(platform: Platform): Promise<string | null> {
  const connection = await getPlatformConnection(sellerId(), platform);
  if (!connection?.session_id) return null;
  return connection.metadata.live_url || null;
}

export async function ensureLiveLogin(
  platform: Platform,
  options?: { fresh?: boolean }
): Promise<string> {
  const lockKey = `${sellerId()}:${platform}`;
  const inflight = loginLocks.soldBeginConnection?.get(lockKey);
  if (inflight) {
    const started = await inflight;
    if (started.live_url) return started.live_url;
  }
  if (!options?.fresh) {
    const liveUrl = await getLiveLoginUrl(platform);
    if (liveUrl) return liveUrl;
  }
  const started = await beginConnection(platform);
  if (!started.live_url) {
    throw new Error("Browserbase opened a session but did not return a live view URL.");
  }
  return started.live_url;
}

export async function listConnections(options?: {
  includeLive?: boolean;
}): Promise<PublicConnection[]> {
  const existing = new Map(
    (await listPlatformConnections(sellerId())).map((connection) => [
      connection.platform,
      connection,
    ])
  );
  const includeLive = options?.includeLive === true;
  const connections: PublicConnection[] = [];
  for (const platform of PLATFORMS) {
    const connection = existing.get(platform) || emptyConnection(platform);
    const live_url =
      includeLive && connection.session_id
        ? await sessionLiveUrl(connection.session_id).catch(
            () => connection.metadata.live_url || null
          )
        : connection.metadata.live_url || null;
    connections.push({ ...connection, live_url });
  }
  return connections;
}

function contextName(platform: Platform) {
  return `sold-${sellerId()}-${platform.toLowerCase().replace(/\W+/g, "-")}`;
}

export async function beginConnection(platform: Platform): Promise<PublicConnection> {
  const lockKey = `${sellerId()}:${platform}`;
  loginLocks.soldBeginConnection ??= new Map();
  const existing = loginLocks.soldBeginConnection.get(lockKey);
  if (existing) return existing;
  const run = startConnection(platform);
  loginLocks.soldBeginConnection.set(lockKey, run);
  try {
    return await run;
  } finally {
    loginLocks.soldBeginConnection.delete(lockKey);
  }
}

async function startConnection(platform: Platform): Promise<PublicConnection> {
  const current =
    (await getPlatformConnection(sellerId(), platform)) || emptyConnection(platform);
  let contextId = current.context_id;
  if (!contextId) {
    contextId = (await createPersistentContext(contextName(platform))).id;
    await upsertPlatformConnection({
      ...current,
      context_id: contextId,
      updated_at: new Date().toISOString(),
    });
  }
  await releaseSoldSessions(platform);
  if (current.session_id) {
    await Promise.race([
      releaseSession(current.session_id),
      new Promise((resolve) => setTimeout(resolve, 2_500)),
    ]);
  }
  let created;
  try {
    created = await createMarketplaceSession(contextId, platform, "login");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/context/i.test(message)) throw error;
    contextId = (
      await createPersistentContext(`${contextName(platform)}-${Date.now().toString(36)}`)
    ).id;
    await upsertPlatformConnection({
      ...current,
      context_id: contextId,
      updated_at: new Date().toISOString(),
    });
    created = await createMarketplaceSession(contextId, platform, "login");
  }
  const adapter = getMarketplaceAdapter(platform);
  const now = new Date().toISOString();
  // Navigate the cloud tab to the marketplace sign-in page before handing
  // the live view to the seller. openLoginPage disconnects our CDP client
  // but leaves the Browserbase session running on that URL.
  const landed = await openLoginPage(
    created.id,
    adapter.loginUrl,
    created.connectUrl
  ).catch(() => adapter.loginUrl);
  const liveUrl =
    (await sessionLiveUrl(created.id, adapter.domains[0]).catch(() => null)) ||
    `https://www.browserbase.com/sessions/${created.id}`;
  const saved = await upsertPlatformConnection({
    ...current,
    context_id: contextId,
    session_id: created.id,
    status: "awaiting_login",
    updated_at: now,
    checked_at: now,
    error: null,
    metadata: {
      ...current.metadata,
      last_url: landed || adapter.loginUrl,
      live_url: liveUrl,
      stealth: created.stealth || "none",
      ...(remoteMinutesExhausted() ? { minutes: "spent" } : {}),
    },
  });
  return { ...saved, live_url: liveUrl };
}

export async function beginLocalConnection(platform: Platform): Promise<PublicConnection> {
  const current =
    (await getPlatformConnection(sellerId(), platform)) || emptyConnection(platform);
  const adapter = getMarketplaceAdapter(platform);
  const page = await openLocalLogin(platform, adapter.loginUrl);
  const now = new Date().toISOString();
  return upsertPlatformConnection({
    ...current,
    context_id: `local:${platformSlug(platform)}`,
    session_id: null,
    status: "awaiting_login",
    updated_at: now,
    checked_at: now,
    error: null,
    metadata: {
      ...current.metadata,
      via: "local",
      last_url: page.url(),
      evidence: "Log into the Chrome window on this Mac, then check login.",
    },
  });
}

export async function checkLocalConnection(platform: Platform): Promise<PublicConnection> {
  const current =
    (await getPlatformConnection(sellerId(), platform)) || emptyConnection(platform);
  const adapter = getMarketplaceAdapter(platform);
  const page = await openLocalLogin(platform, adapter.loginUrl);
  if (platform === "Facebook Marketplace") {
    const cookies = await page.context().cookies("https://www.facebook.com");
    const signedIn = cookies.some((cookie) => cookie.name === "c_user" && cookie.value);
    if (signedIn && !/\/marketplace/i.test(page.url())) {
      await page.goto("https://www.facebook.com/marketplace", {
        waitUntil: "domcontentloaded",
        timeout: 45_000,
      });
    }
  }
  const evidence = await adapter.detectLogin(page);
  const now = new Date().toISOString();
  const saved = await upsertPlatformConnection({
    ...current,
    context_id: current.context_id || `local:${platformSlug(platform)}`,
    session_id: null,
    status: statusFromLoginEvidence(evidence.loggedIn, true),
    updated_at: now,
    checked_at: now,
    error: null,
    metadata: {
      ...current.metadata,
      via: "local",
      last_url: evidence.url,
      evidence: evidence.detail,
    },
  });
  if (evidence.loggedIn) {
    const { ensureBackgroundFacebookMonitor } = await import("../agents/monitor");
    void ensureBackgroundFacebookMonitor();
  }
  return saved;
}

export async function disconnectConnection(platform: Platform): Promise<PublicConnection> {
  const current =
    (await getPlatformConnection(sellerId(), platform)) || emptyConnection(platform);
  if (current.session_id) {
    await Promise.race([
      releaseSession(current.session_id),
      new Promise((resolve) => setTimeout(resolve, 2_500)),
    ]).catch(() => undefined);
  }
  const now = new Date().toISOString();
  const saved = await upsertPlatformConnection({
    ...current,
    session_id: null,
    status: "not_connected",
    updated_at: now,
    checked_at: now,
    error: null,
    metadata: {},
  });
  if (platform === "Facebook Marketplace") {
    const { stopFacebookMonitor } = await import("../agents/monitor");
    stopFacebookMonitor({ persist: false });
  }
  return saved;
}

export async function checkConnection(platform: Platform): Promise<PublicConnection> {
  const current = await getPlatformConnection(sellerId(), platform);
  if (current && isLocalConnection(current.metadata)) {
    return checkLocalConnection(platform);
  }
  if (!current?.context_id) return emptyConnection(platform);

  let sessionId = current.session_id;
  let liveUrl: string | null = null;
  let page;
  try {
    if (sessionId) {
      page = await connectToSession(sessionId);
      liveUrl = await sessionLiveUrl(sessionId);
    } else {
      throw new Error("No active session");
    }
  } catch {
    const running = sessionId
      ? await getBrowserbaseSession(sessionId).catch(() => null)
      : null;
    if (sessionId && running?.status === "RUNNING") {
      liveUrl = await sessionLiveUrl(sessionId).catch(() => current.metadata.live_url || null);
      const now = new Date().toISOString();
      return {
        ...(await upsertPlatformConnection({
          ...current,
          status: "awaiting_login",
          updated_at: now,
          checked_at: now,
          error: null,
          metadata: {
            ...current.metadata,
            evidence: "Finish the captcha or 2FA in the live login window, then check again.",
            ...(liveUrl ? { live_url: liveUrl } : {}),
          },
        })),
        live_url: liveUrl,
      };
    }
    const session = await startMarketplaceSession(
      current.context_id,
      platform,
      "login",
      { live: true }
    );
    sessionId = session.sessionId;
    liveUrl = session.liveUrl;
    page = session.page;
    await page.goto(getMarketplaceAdapter(platform).loginUrl, {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    });
  }

  const evidence = await getMarketplaceAdapter(platform).detectLogin(page);
  if (sessionId && !evidence.loggedIn) {
    await disconnectSession(sessionId);
  }
  const now = new Date().toISOString();
  const saved = await upsertPlatformConnection({
    ...current,
    session_id: evidence.loggedIn ? null : sessionId,
    status: statusFromLoginEvidence(evidence.loggedIn, true),
    updated_at: now,
    checked_at: now,
    error: null,
    metadata: {
      ...current.metadata,
      last_url: evidence.url,
      evidence: evidence.detail,
      ...(liveUrl ? { live_url: liveUrl } : {}),
    },
  });
  if (evidence.loggedIn && sessionId) {
    await releaseSession(sessionId);
    liveUrl = null;
  }
  if (evidence.loggedIn) {
    const { ensureBackgroundFacebookMonitor } = await import("../agents/monitor");
    void ensureBackgroundFacebookMonitor();
  }
  return { ...saved, live_url: liveUrl };
}
