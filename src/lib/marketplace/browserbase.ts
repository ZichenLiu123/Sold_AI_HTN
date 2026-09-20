import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Browserbase } from "@browserbasehq/sdk";
import { chromium, type Browser, type Page } from "playwright-core";
import { getMarketplaceAdapter } from "./adapters";
import type { Platform } from "../types";
import { platformSlug } from "../platforms";
import { browserbaseRetryDelay, existingContextId, isRemoteMinutesError } from "./rate-limit";

// Browserbase session helpers for marketplace login and posting.

const MINUTES_FLAG = path.join(process.cwd(), "data", "browserbase-minutes-spent");

const globalBrowsers = globalThis as unknown as {
  soldMarketplaceBrowsers?: Map<string, Browser>;
  soldBrowserbaseQueue?: Promise<unknown>;
  soldBrowserbaseLimitedUntil?: number;
  soldBrowserbaseMinutesSpent?: boolean;
};

function browserCache() {
  globalBrowsers.soldMarketplaceBrowsers ??= new Map();
  return globalBrowsers.soldMarketplaceBrowsers;
}

export function markRemoteMinutesExhausted() {
  globalBrowsers.soldBrowserbaseMinutesSpent = true;
  try {
    writeFileSync(MINUTES_FLAG, String(Date.now()));
  } catch {
    // Flag is best-effort so a restart still skips Browserbase for a day.
  }
}

export function remoteMinutesExhausted() {
  if (globalBrowsers.soldBrowserbaseMinutesSpent) return true;
  try {
    if (!existsSync(MINUTES_FLAG)) return false;
    const stamped = Number(readFileSync(MINUTES_FLAG, "utf8"));
    if (!Number.isFinite(stamped) || Date.now() - stamped > 24 * 60 * 60 * 1000) {
      return false;
    }
    globalBrowsers.soldBrowserbaseMinutesSpent = true;
    return true;
  } catch {
    return false;
  }
}

export { isRemoteMinutesError };

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function client() {
  const apiKey = process.env.BROWSERBASE_API_KEY;
  if (!apiKey) throw new Error("BROWSERBASE_API_KEY is not configured.");
  return new Browserbase({ apiKey, maxRetries: 0 });
}

async function browserbaseCall<T>(fn: () => Promise<T>): Promise<T> {
  const run = async () => {
    const cooldown = (globalBrowsers.soldBrowserbaseLimitedUntil || 0) - Date.now();
    if (cooldown > 0) await sleep(cooldown);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await fn();
      } catch (error) {
        const wait = browserbaseRetryDelay(error);
        if (wait == null || attempt === 1) throw error;
        globalBrowsers.soldBrowserbaseLimitedUntil = Date.now() + wait;
        await sleep(wait);
      }
    }
    throw new Error("Browserbase request failed");
  };
  const queued = (globalBrowsers.soldBrowserbaseQueue || Promise.resolve()).then(run, run);
  globalBrowsers.soldBrowserbaseQueue = queued.then(
    () => undefined,
    () => undefined
  );
  return queued;
}

export async function createPersistentContext(name: string) {
  const projectId = process.env.BROWSERBASE_PROJECT_ID || undefined;
  try {
    return await browserbaseCall(() => client().contexts.create({ name, projectId }));
  } catch (error) {
    const existingId = existingContextId(error);
    if (existingId) return { id: existingId };
    const status = (error as { status?: number }).status;
    const message = error instanceof Error ? error.message : String(error);
    if (status !== 409 && !/already exists/i.test(message)) throw error;
    return browserbaseCall(() =>
      client().contexts.create({
        name: `${name}-${Date.now().toString(36)}`,
        projectId,
      })
    );
  }
}

export async function createBrowserbaseSession() {
  return browserbaseCall(() =>
    client().sessions.create({
      projectId: process.env.BROWSERBASE_PROJECT_ID || undefined,
    })
  );
}

function describeBrowserbaseError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (isRemoteMinutesError(error)) {
    markRemoteMinutesExhausted();
    return new Error(
      "The remote Craigslist browser is out of minutes. Sold will use Chrome on this Mac."
    );
  }
  if (/429|burst rate/i.test(message)) {
    return new Error(
      "Browserbase is rate-limiting right now. Wait a minute, then open live login again."
    );
  }
  if (/concurrent|too many sessions/i.test(message)) {
    return new Error(
      "Browserbase already has 3 browsers open. Close extra live windows, then try again."
    );
  }
  if (/prox/i.test(message)) {
    return new Error(
      `This Browserbase plan rejected proxies. Marketplace login needs a proxy. ${message}`
    );
  }
  return error instanceof Error ? error : new Error(message);
}

export async function createMarketplaceSession(
  contextId: string,
  platform: Platform,
  task: "login" | "posting"
) {
  const adapter = getMarketplaceAdapter(platform);
  const projectId = process.env.BROWSERBASE_PROJECT_ID || undefined;
  const attempts: Array<{ proxies?: boolean; verified?: boolean }> = [
    { proxies: true },
    {},
  ];
  let lastError: unknown;
  for (const attempt of attempts) {
    try {
      const session = await browserbaseCall(() =>
        client().sessions.create({
          projectId,
          keepAlive: true,
          api_timeout: 3600,
          proxies: attempt.proxies || undefined,
          browserSettings: {
            context: { id: contextId, persist: true },
            ...(task === "posting" ? { allowedDomains: adapter.domains } : {}),
            recordSession: true,
            logSession: true,
            solveCaptchas: task === "posting",
            viewport: { width: 1280, height: 900 },
            ...(attempt.verified ? { verified: true } : {}),
          },
          userMetadata: {
            app: "sold",
            platform: platformSlug(platform),
            task,
            userId: "demo-seller",
          },
        })
      );
      return { ...session, stealth: attempt.proxies ? "proxy" : "none" };
    } catch (error) {
      lastError = error;
    }
  }
  throw describeBrowserbaseError(
    lastError instanceof Error
      ? lastError
      : new Error("Could not create a Browserbase session.")
  );
}

function withTimeout<T>(work: Promise<T>, ms: number, message: string) {
  return Promise.race([
    work,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(message)), ms)),
  ]);
}

export async function startMarketplaceSession(
  contextId: string,
  platform: Platform,
  task: "login" | "posting",
  options?: { live?: boolean; timeoutMs?: number }
) {
  if (remoteMinutesExhausted()) {
    throw new Error(
      "The remote Craigslist browser is out of minutes. Sold will use Chrome on this Mac."
    );
  }
  const timeoutMs = options?.timeoutMs ?? 18_000;
  const session = await withTimeout(
    createMarketplaceSession(contextId, platform, task),
    timeoutMs,
    "Browserbase took too long to open."
  );
  const page = await withTimeout(
    connectToSession(session.id, session.connectUrl),
    12_000,
    "Browserbase opened but the page never connected."
  );
  return {
    sessionId: session.id,
    page,
    liveUrl: options?.live ? await sessionLiveUrl(session.id) : null,
  };
}

export async function resumeMarketplaceSession(sessionId: string) {
  const page = await connectToSession(sessionId);
  return { sessionId, page, liveUrl: null as string | null };
}

export async function connectToSession(
  sessionId: string,
  connectUrl?: string
): Promise<Page> {
  let browser = browserCache().get(sessionId);
  if (!browser?.isConnected()) {
    const url =
      connectUrl ||
      (await browserbaseCall(() => client().sessions.retrieve(sessionId))).connectUrl;
    if (!url) throw new Error("Browser session has no connect URL.");
    browser = await chromium.connectOverCDP(url, { timeout: 15_000 });
    browserCache().set(sessionId, browser);
  }
  const context = browser.contexts()[0];
  return context.pages()[0] || (await context.newPage());
}

export async function disconnectSession(sessionId: string) {
  const browser = browserCache().get(sessionId);
  browserCache().delete(sessionId);
  await browser?.close().catch(() => undefined);
}

export async function openLoginPage(
  sessionId: string,
  url: string,
  connectUrl?: string
) {
  const page = await connectToSession(sessionId, connectUrl);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
  const currentUrl = page.url();
  await disconnectSession(sessionId);
  return currentUrl;
}

export async function getBrowserbaseSession(sessionId: string) {
  return browserbaseCall(() => client().sessions.retrieve(sessionId));
}

export async function sessionLiveUrl(sessionId: string, preferHost?: string) {
  const debug = await browserbaseCall(() => client().sessions.debug(sessionId));
  const pages = debug.pages || [];
  const match = preferHost
    ? pages.find((page) => page.url?.includes(preferHost))
    : undefined;
  const page =
    match ||
    pages.find((item) => item.url && !/^about:blank/i.test(item.url)) ||
    pages[0];
  return (
    page?.debuggerFullscreenUrl ||
    debug.debuggerFullscreenUrl ||
    debug.debuggerUrl ||
    null
  );
}

export async function releaseSoldSessions(platform: Platform) {
  const slug = platformSlug(platform);
  const sessions = await browserbaseCall(() =>
    client().sessions.list({ status: "RUNNING" })
  ).catch(() => []);
  for (const session of sessions) {
    const meta = session.userMetadata || {};
    if (meta.app === "sold" && meta.platform === slug) {
      await releaseSession(session.id);
    }
  }
}

export async function releaseSession(sessionId: string) {
  await browserbaseCall(() =>
    client().sessions.update(sessionId, {
      status: "REQUEST_RELEASE",
      projectId: process.env.BROWSERBASE_PROJECT_ID || undefined,
    })
  ).catch(() => undefined);
  const browser = browserCache().get(sessionId);
  browserCache().delete(sessionId);
  await browser?.close().catch(() => undefined);
}
