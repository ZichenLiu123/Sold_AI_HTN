import { mkdirSync } from "node:fs";
import path from "node:path";
import { chromium, type BrowserContext, type Page } from "playwright-core";
import type { Platform } from "../types";
import { platformSlug } from "../platforms";

export type LocalChromeJob = "idle" | "login" | "post" | "monitor";

const globalLocal = globalThis as unknown as {
  soldLocalContexts?: Map<string, BrowserContext>;
  soldLocalHeadless?: Map<string, boolean>;
  soldChromeJob?: LocalChromeJob;
};

function contextCache() {
  globalLocal.soldLocalContexts ??= new Map();
  return globalLocal.soldLocalContexts;
}

function headlessCache() {
  globalLocal.soldLocalHeadless ??= new Map();
  return globalLocal.soldLocalHeadless;
}

export function localProfileDir(platform: Platform) {
  return path.join(process.cwd(), "data", "chrome-profiles", platformSlug(platform));
}

export function isLocalConnection(metadata: Record<string, string>) {
  return metadata.via === "local";
}

async function launchProfile(
  platform: Platform,
  headless: boolean
): Promise<BrowserContext> {
  const userDataDir = localProfileDir(platform);
  mkdirSync(userDataDir, { recursive: true });
  const options = {
    headless,
    viewport: headless ? { width: 1280, height: 1800 } : null,
    chromiumSandbox: true,
    ignoreDefaultArgs: ["--enable-automation", "--no-sandbox", "--disable-setuid-sandbox"],
    args: [],
  };
  try {
    return await chromium.launchPersistentContext(userDataDir, {
      ...options,
      channel: "chrome",
    });
  } catch {
    return chromium.launchPersistentContext(userDataDir, {
      ...options,
      executablePath:
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    });
  }
}

async function contextFor(
  platform: Platform,
  headless: boolean
): Promise<BrowserContext> {
  const cache = contextCache();
  const flags = headlessCache();
  let context = cache.get(platform);
  if (context && flags.get(platform) !== headless) {
    await context.close().catch(() => undefined);
    cache.delete(platform);
    flags.delete(platform);
    context = undefined;
  }
  if (!context) {
    context = await launchProfile(platform, headless);
    cache.set(platform, context);
    flags.set(platform, headless);
    context.on("close", () => {
      cache.delete(platform);
      flags.delete(platform);
    });
  }
  return context;
}

export async function openLocalLogin(
  platform: Platform,
  url: string,
  options?: { focus?: boolean; headless?: boolean }
): Promise<Page> {
  const headless = options?.headless === true;
  let context: BrowserContext;
  try {
    context = await contextFor(platform, headless);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Could not open Google Chrome on this Mac. Install Chrome and try again. ${message}`
    );
  }
  const page = context.pages()[0] || (await context.newPage());
  if (!headless && options?.focus !== false) {
    await page.bringToFront().catch(() => undefined);
  }
  const current = page.url();
  if (current === "about:blank" || current === "" || /^chrome:\/\//i.test(current)) {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
  }
  return page;
}

export async function localPage(platform: Platform, url: string): Promise<Page> {
  return openLocalLogin(platform, url);
}

export function localChromeJob(): LocalChromeJob {
  return globalLocal.soldChromeJob || "idle";
}

export async function withLocalChrome<T>(
  job: Exclude<LocalChromeJob, "idle">,
  work: () => Promise<T>,
  options?: { waitMs?: number }
): Promise<T> {
  const started = Date.now();
  const waitMs = options?.waitMs ?? 90_000;
  while (localChromeJob() !== "idle") {
    if (Date.now() - started > waitMs) {
      throw new Error(
        `Your Chrome is busy with ${localChromeJob()}. Try again in a moment.`
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  globalLocal.soldChromeJob = job;
  try {
    return await work();
  } finally {
    if (globalLocal.soldChromeJob === job) globalLocal.soldChromeJob = "idle";
  }
}

export async function gotoLocalPage(
  platform: Platform,
  url: string,
  options?: { focus?: boolean; headless?: boolean }
): Promise<Page> {
  const page = await openLocalLogin(platform, url, options);
  const current = page.url().split("#")[0];
  const target = url.split("#")[0];
  const samePath = (() => {
    try {
      const a = new URL(current);
      const b = new URL(target);
      return a.origin === b.origin && a.pathname === b.pathname;
    } catch {
      return current === target;
    }
  })();
  if (!samePath) {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
  }
  if (!options?.headless && options?.focus !== false) {
    await page.bringToFront().catch(() => undefined);
  }
  return page;
}
