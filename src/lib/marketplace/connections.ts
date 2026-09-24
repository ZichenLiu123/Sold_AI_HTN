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
  let landed = adapter.loginUrl;
  if (platform === "Karrot") {
    try {
      const page = await connectToSession(created.id, created.connectUrl);
      await page.goto(adapter.loginUrl, {
        waitUntil: "domcontentloaded",
        timeout: 45_000,
      });
      const signIn = page
        .getByRole("button", { name: /^sign in$/i })
        .or(page.getByRole("link", { name: /^sign in$/i }))
        .first();
      if (await signIn.isVisible().catch(() => false)) {
        await signIn.click({ timeout: 5_000 }).catch(() => undefined);
        await page.waitForTimeout(800).catch(() => undefined);
      }
      landed = page.url();
      await disconnectSession(created.id);
    } catch {
      landed = await openLoginPage(
        created.id,
        adapter.loginUrl,
        created.connectUrl
      ).catch(() => adapter.loginUrl);
    }
  } else {
    landed = await openLoginPage(
      created.id,
      adapter.loginUrl,
      created.connectUrl
    ).catch(() => adapter.loginUrl);
  }
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
  if (platform === "Karrot") {
    const signIn = page
      .getByRole("button", { name: /^sign in$/i })
      .or(page.getByRole("link", { name: /^sign in$/i }))
      .first();
    if (await signIn.isVisible().catch(() => false)) {
      await signIn.click({ timeout: 5_000 }).catch(() => undefined);
      await page.waitForTimeout(800).catch(() => undefined);
    }
  }
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
  await prepareForLoginDetect(page, platform);
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

const DETECT_HOME: Partial<Record<Platform, string>> = {
  "Facebook Marketplace": "https://www.facebook.com/marketplace",
  Craigslist: "https://accounts.craigslist.org/login/home",
  eBay: "https://www.ebay.com/",
  Kijiji: "https://www.kijiji.ca/",
  Karrot: "https://www.karrotmarket.com/ca/",
  OfferUp: "https://offerup.com/",
  Mercari: "https://www.mercari.com/",
  Poshmark: "https://poshmark.com/",
};

async function prepareForLoginDetect(
  page: Awaited<ReturnType<typeof connectToSession>>,
  platform: Platform
) {
  const home = DETECT_HOME[platform];
  if (!home) return;
  const url = page.url();
  const onAuthOrBlank =
    !url ||
    /about:blank/i.test(url) ||
    /\/login|\/signin|sign-in|\/checkpoint|accounts\./i.test(url);
  const host = (() => {
    try {
      return new URL(home).hostname.replace(/^www\./, "");
    } catch {
      return "";
    }
  })();
  const offSite = host ? !url.toLowerCase().includes(host) : false;
  if (onAuthOrBlank || offSite || platform === "Karrot") {
    await page
      .goto(home, { waitUntil: "domcontentloaded", timeout: 45_000 })
      .catch(() => undefined);
    await page.waitForTimeout(1_400).catch(() => undefined);
  }
}

async function attachLoginPage(
  sessionId: string,
  connectUrl?: string | null
): Promise<Awaited<ReturnType<typeof connectToSession>> | undefined> {
  try {
    return await connectToSession(sessionId, connectUrl || undefined);
  } catch {
    await disconnectSession(sessionId).catch(() => undefined);
    try {
      return await connectToSession(sessionId, connectUrl || undefined);
    } catch {
      return undefined;
    }
  }
}

export async function checkConnection(platform: Platform): Promise<PublicConnection> {
  const current = await getPlatformConnection(sellerId(), platform);
  if (current && isLocalConnection(current.metadata)) {
    return checkLocalConnection(platform);
  }
  if (!current?.context_id && !current?.session_id) {
    const now = new Date().toISOString();
    return {
      ...(await upsertPlatformConnection({
        ...(current || emptyConnection(platform)),
        status: "awaiting_login",
        updated_at: now,
        checked_at: now,
        error: null,
        metadata: {
          ...(current?.metadata || {}),
          evidence:
            "Login browser is still opening. Wait a couple seconds after Open login, then tap I finished logging in again.",
        },
      })),
    };
  }

  let sessionId = current?.session_id || null;
  let liveUrl: string | null = current?.metadata?.live_url || null;
  let page: Awaited<ReturnType<typeof connectToSession>> | undefined;

  if (sessionId) {
    const running = await getBrowserbaseSession(sessionId).catch(() => null);
    if (running?.status === "RUNNING") {
      liveUrl = await sessionLiveUrl(sessionId).catch(() => liveUrl);
      page = await attachLoginPage(sessionId, running.connectUrl);
      if (!page) {
        await new Promise((resolve) => setTimeout(resolve, 1_200));
        page = await attachLoginPage(sessionId, running.connectUrl);
      }
    }
  }

  // Persisted Browserbase context still has cookies even if the live tab attach failed.
  if (!page && current?.context_id) {
    try {
      const session = await startMarketplaceSession(
        current.context_id,
        platform,
        "login",
        { live: true }
      );
      sessionId = session.sessionId;
      liveUrl = session.liveUrl;
      page = session.page;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Could not open login browser.";
      const now = new Date().toISOString();
      return {
        ...(await upsertPlatformConnection({
          ...(current || emptyConnection(platform)),
          status: "awaiting_login",
          updated_at: now,
          checked_at: now,
          error: message,
          metadata: {
            ...(current?.metadata || {}),
            evidence: message,
            ...(liveUrl ? { live_url: liveUrl } : {}),
          },
        })),
        live_url: liveUrl,
      };
    }
  }

  if (!page) {
    const now = new Date().toISOString();
    return {
      ...(await upsertPlatformConnection({
        ...(current || emptyConnection(platform)),
        status: "awaiting_login",
        updated_at: now,
        checked_at: now,
        error: null,
        metadata: {
          ...(current?.metadata || {}),
          evidence:
            "Could not reach the login browser. Tap Open login again, finish signing in, then tap I finished logging in.",
          ...(liveUrl ? { live_url: liveUrl } : {}),
        },
      })),
      live_url: liveUrl,
    };
  }

  await prepareForLoginDetect(page, platform);
  const evidence = await getMarketplaceAdapter(platform).detectLogin(page);
  if (sessionId && !evidence.loggedIn) {
    await disconnectSession(sessionId);
  }
  const now = new Date().toISOString();
  const saved = await upsertPlatformConnection({
    ...(current || emptyConnection(platform)),
    session_id: evidence.loggedIn ? null : sessionId,
    status: statusFromLoginEvidence(evidence.loggedIn, true),
    updated_at: now,
    checked_at: now,
    error: null,
    metadata: {
      ...(current?.metadata || {}),
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
