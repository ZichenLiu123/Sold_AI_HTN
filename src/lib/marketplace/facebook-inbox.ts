import type { Page } from "playwright-core";
import { complete } from "../llm";
import { extractJson } from "../util";
import {
  classifySellingText,
  isInboxChromeBuyer,
  lastBuyerText,
  looksLikeBuyerThread,
  looksLikePersonName,
  parseMarketplaceNotice,
  parseThreadPreview,
  type InboxThread,
  type SellingScan,
  type ThreadMessage,
} from "./facebook-inbox-match";

export {
  alreadySeenInbound,
  classifySellingText,
  facebookThreadId,
  marketplaceThreadId,
  isFacebookSystemBuyer,
  isInboxChromeBuyer,
  isThreadChrome,
  lastBuyerText,
  looksLikePersonName,
  matchListingToText,
  normalizeMessage,
  parseThreadPreview,
  resolveThreadListing,
  sellerTookOver,
  sellingPresence,
  titleTokens,
} from "./facebook-inbox-match";
export type { InboxThread, SellingScan, ThreadMessage } from "./facebook-inbox-match";

export const FACEBOOK_SELLING_URL =
  "https://www.facebook.com/marketplace/you/selling";

export const FACEBOOK_INBOX_URLS = [
  "https://www.facebook.com/marketplace/inbox",
];

const NAV_LABEL =
  /^(marketplace|inbox|unread|selling|buying|notifications|home|watchlist|you|menu|search|create|chats|marketplace inbox|see all|filters)$/i;

export async function facebookSignedIn(page: Page) {
  const cookies = await page.context().cookies("https://www.facebook.com");
  return cookies.some((cookie) => cookie.name === "c_user" && cookie.value);
}

export const FACEBOOK_CHAT_PIN_MESSAGE =
  "Facebook is asking for your chat PIN. Enter it in the Chrome window (or use a one-time code). Sold cannot read Marketplace messages until chat history is restored.";

export async function facebookNeedsChatPin(page: Page) {
  const pin = page.getByText(/enter your pin to restore your chats/i).first();
  const missing = page.getByText(/some messages are missing/i).first();
  return (
    (await pin.isVisible().catch(() => false)) ||
    (await missing.isVisible().catch(() => false))
  );
}

export async function assertFacebookChatUnlocked(page: Page) {
  if (await facebookNeedsChatPin(page)) {
    throw new Error(FACEBOOK_CHAT_PIN_MESSAGE);
  }
}

type Cell = { text: string; href: string; lines: string[] };

async function conversationCells(page: Page): Promise<Cell[]> {
  return page
    .evaluate(() => {
      const nodes = [
        ...document.querySelectorAll('[role="listitem"]'),
        ...document.querySelectorAll('[role="row"]'),
        ...document.querySelectorAll('a[href*="/t/"]'),
        ...document.querySelectorAll('a[href*="/messages/t/"]'),
        ...document.querySelectorAll('a[href*="/messages/"]'),
        ...document.querySelectorAll('[role="list"] a'),
        ...document.querySelectorAll('[aria-label*="conversation" i]'),
        ...document.querySelectorAll('[aria-label*="Conversation"]'),
      ];
      const seen = new Set<string>();
      const cells: Cell[] = [];
      for (const node of nodes) {
        const aria = String((node as HTMLElement).getAttribute("aria-label") || "").trim();
        const text = String((node as HTMLElement).innerText || "")
          .replace(/\u00a0/g, " ")
          .trim();
        const combined = [aria, text].filter(Boolean).join("\n");
        if (combined.length < 8 || combined.length > 500) continue;
        if (seen.has(combined)) continue;
        seen.add(combined);
        const lines = combined
          .split("\n")
          .map((line) => line.replace(/\s+/g, " ").trim())
          .filter(Boolean);
        const href =
          (node.closest("a") as HTMLAnchorElement | null)?.href ||
          (node as HTMLAnchorElement).href ||
          "";
        cells.push({ text: lines.join(" | "), href, lines });
      }
      return cells.slice(0, 40);
    })
    .catch(() => [] as Cell[]);
}

function threadFromCell(cell: Cell): InboxThread | null {
  const parsed = parseThreadPreview(cell.lines.join("\n") || cell.text);
  if (NAV_LABEL.test(parsed.buyer)) return null;
  if (isInboxChromeBuyer(parsed.buyer) || isInboxChromeBuyer(cell.text)) return null;
  if (!looksLikePersonName(parsed.buyer)) return null;
  if (!looksLikeBuyerThread(cell.text) && !looksLikeBuyerThread(parsed.preview || parsed.hint)) {
    return null;
  }
  const raw = cell.text.toLowerCase();
  const lastFrom = /\byou sent\b|\byou:\b/.test(raw)
    ? "seller"
    : parsed.preview
      ? "buyer"
      : "unknown";
  return {
    buyer: parsed.buyer,
    hint: parsed.hint,
    preview: parsed.preview,
    lastFrom,
    href: cell.href,
    raw: cell.text,
  };
}

async function readInboxWithVision(page: Page): Promise<InboxThread[]> {
  const shot = await page.screenshot({ type: "jpeg", quality: 45, fullPage: false });
  const raw = await complete({
    system:
      "You read a Facebook Marketplace inbox. Return JSON only. List people who wrote about a listing for sale. Ignore navigation, seller dashboard, unread counts, Messenger groups, and chat settings.",
    text: 'JSON: {"threads":[{"buyer":"","listing_hint":"","preview":"","last_from":"buyer|seller|unknown"}]}',
    images: [
      {
        media_type: "image/jpeg",
        data: shot.toString("base64"),
        detail: "low",
      },
    ],
    maxTokens: 500,
  });
  const parsed = extractJson<{
    threads?: {
      buyer?: string;
      listing_hint?: string;
      preview?: string;
      last_from?: string;
    }[];
  }>(raw);
  return (parsed.threads || [])
    .map((thread) => {
      const lastFrom =
        thread.last_from === "seller" || thread.last_from === "buyer"
          ? thread.last_from
          : "unknown";
      const buyer = (thread.buyer || "Buyer").trim();
      const hint = (thread.listing_hint || "").trim();
      const preview = (thread.preview || "").trim();
      if (!buyer && !preview) return null;
      return {
        buyer,
        hint,
        preview,
        lastFrom,
        href: "",
        raw: [buyer, hint, preview].filter(Boolean).join(" | "),
      } satisfies InboxThread;
    })
    .filter((thread): thread is InboxThread => Boolean(thread))
    .slice(0, 12);
}

function isStaleMessengerRow(text: string) {
  if (/\b\d+\s*[smh]\b|\bjust now\b|\btoday\b/i.test(text)) return false;
  return /\b\d+\s*y\b|\bmissed your call\b|\bsent a gif\b|^active now/i.test(text);
}

function isRecentOutreach(text: string) {
  return /\bjust now\b|\b\d+\s*[smh]\b|\b\d+\s*d\b|\btoday\b/i.test(text);
}

function uniqueThreads(threads: InboxThread[]) {
  const seen = new Set<string>();
  const unique: InboxThread[] = [];
  for (const thread of threads) {
    const key = thread.buyer.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(thread);
  }
  return unique;
}

async function scanMarketplaceNotifications(page: Page): Promise<InboxThread[]> {
  await page.goto("https://www.facebook.com/notifications", {
    waitUntil: "domcontentloaded",
    timeout: 45_000,
  });
  await page.waitForTimeout(2_000);
  const marketplace = page
    .getByRole("link", { name: /^marketplace$/i })
    .or(page.getByRole("button", { name: /^marketplace$/i }))
    .first();
  if (await marketplace.isVisible().catch(() => false)) {
    await marketplace.click({ timeout: 4_000 }).catch(() => undefined);
    await page.waitForTimeout(1_200);
  }
  const cells = await conversationCells(page);
  const body = await page.locator("body").innerText().catch(() => "");
  const extras = body
    .split("\n")
    .map((line) => ({ text: line, href: "", lines: [line] }))
    .filter((cell) => cell.text.length > 12 && cell.text.length < 240);
  const threads: InboxThread[] = [];
  const seen = new Set<string>();
  for (const cell of [...cells, ...extras]) {
    const parsed = parseMarketplaceNotice(cell.text) || parseMarketplaceNotice(cell.lines.join(" "));
    if (!parsed) continue;
    const key = `${parsed.buyer}:${parsed.preview}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    threads.push({
      buyer: parsed.buyer,
      hint: parsed.hint,
      preview: parsed.preview,
      lastFrom: "buyer",
      href: cell.href,
      raw: cell.text,
    });
  }
  return threads;
}

export async function openMarketplaceInbox(page: Page): Promise<InboxThread[]> {
  const collected: InboxThread[] = [];
  for (const url of FACEBOOK_INBOX_URLS) {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.waitForTimeout(2_400);
    await assertFacebookChatUnlocked(page);
    const cells = await conversationCells(page);
    const fromDom = cells
      .map(threadFromCell)
      .filter((thread): thread is InboxThread => Boolean(thread))
      .filter((thread) => !isStaleMessengerRow(thread.raw))
      .filter((thread) => !/messages\/\?category=marketplace/i.test(url) || isRecentOutreach(thread.raw));
    const fromVision = (await readInboxWithVision(page).catch(() => [])).filter(
      (thread) =>
        looksLikePersonName(thread.buyer) &&
        !isInboxChromeBuyer(thread.buyer) &&
        !isStaleMessengerRow(thread.raw)
    );
    collected.push(...fromDom, ...fromVision);
  }
  const fromNotices = await scanMarketplaceNotifications(page).catch(() => []);
  return uniqueThreads([...collected, ...fromNotices]);
}

async function collectSellingCards(page: Page) {
  return page
    .evaluate(() => {
      const itemHref = (root: Element) => {
        const html = (root as HTMLElement).outerHTML || "";
        const fromHtml = html.match(/marketplace\/item\/(\d+)/i);
        if (fromHtml) return `https://www.facebook.com/marketplace/item/${fromHtml[1]}`;
        const links = [
          root,
          root.closest("a"),
          ...root.querySelectorAll("a[href]"),
        ];
        for (const node of links) {
          const href =
            (node as HTMLAnchorElement | null)?.href ||
            node?.getAttribute?.("href") ||
            "";
          if (/marketplace\/item\/\d+/i.test(href)) return href;
        }
        return "";
      };
      const nodes = [
        ...document.querySelectorAll('a[href*="/marketplace/item/"]'),
        ...document.querySelectorAll('[role="article"]'),
        ...document.querySelectorAll('[role="listitem"]'),
        ...document.querySelectorAll('[role="link"]'),
      ];
      const cards: { text: string; href: string }[] = [];
      const seen = new Set<string>();
      for (const node of nodes) {
        const root = node as HTMLElement;
        const text = String(root.innerText || "").replace(/\s+/g, " ").trim();
        const href = itemHref(root);
        if (text.length < 8 || text.length > 400) continue;
        if (!/ca\$|\$\d|in review|pending|active/i.test(text) && !href.includes("/item/")) {
          continue;
        }
        const key = `${href}|${text.slice(0, 80)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        cards.push({ text, href });
      }
      return {
        cards,
        body: String(document.body.innerText || "").slice(0, 5000),
        url: location.href,
      };
    })
    .catch(() => ({ cards: [], body: "", url: page.url() }));
}

function facebookItemFromUrl(href?: string | null) {
  const match = href?.match(/marketplace\/item\/(\d+)/i);
  if (!match) return null;
  return {
    url: `https://www.facebook.com/marketplace/item/${match[1]}`,
    remoteId: match[1],
  };
}

async function readFacebookItemFromPage(page: Page) {
  const fromUrl = facebookItemFromUrl(page.url());
  if (fromUrl) return fromUrl;
  const hrefs = await page
    .evaluate(() => {
      const html = document.documentElement.innerHTML || "";
      const ids = [...html.matchAll(/marketplace\/item\/(\d+)/gi)].map(
        (match) => match[1]
      );
      return [...new Set(ids)];
    })
    .catch(() => [] as string[]);
  if (hrefs[0]) {
    return {
      url: `https://www.facebook.com/marketplace/item/${hrefs[0]}`,
      remoteId: hrefs[0],
    };
  }
  return null;
}

export async function captureSellingItemUrl(
  page: Page,
  listing: { title: string }
) {
  const already = await readFacebookItemFromPage(page);
  if (already && /\/marketplace\/item\//i.test(page.url())) return already;

  const active = page.getByRole("tab", { name: /^active$/i }).first();
  if (await active.isVisible().catch(() => false)) {
    await active.click({ timeout: 4_000 }).catch(() => undefined);
    await page.waitForTimeout(800);
  }

  const tokens = listing.title
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 2)
    .slice(0, 4);
  if (!tokens.length) return null;
  const titlePattern = new RegExp(tokens.slice(0, 3).join("[\\s\\W]+"), "i");
  const card = page.getByText(titlePattern).first();
  if (await card.isVisible().catch(() => false)) {
    await card.scrollIntoViewIfNeeded().catch(() => undefined);
    await card.click({ timeout: 5_000 }).catch(() => undefined);
    await page
      .waitForURL(/marketplace\/item\/\d+/i, { timeout: 6_000 })
      .catch(() => undefined);
    await page.waitForTimeout(1_200);
    const afterClick = facebookItemFromUrl(page.url());
    if (afterClick) return afterClick;
    const overlayHref = await page
      .locator('a[href*="/marketplace/item/"]')
      .first()
      .getAttribute("href")
      .catch(() => null);
    const fromOverlay = facebookItemFromUrl(overlayHref);
    if (fromOverlay) return fromOverlay;

    await page
      .getByRole("link", { name: /view listing|see listing|see details/i })
      .first()
      .click({ timeout: 3_000 })
      .catch(() => undefined);
    await page
      .waitForURL(/marketplace\/item\/\d+/i, { timeout: 5_000 })
      .catch(() => undefined);
    await page.waitForTimeout(800);
    const afterView = facebookItemFromUrl(page.url());
    if (afterView) return afterView;
  }

  await page
    .goto(
      `https://www.facebook.com/marketplace/search/?query=${encodeURIComponent(listing.title)}`,
      { waitUntil: "domcontentloaded", timeout: 45_000 }
    )
    .catch(() => undefined);
  await page.waitForTimeout(1_800);
  const fromSearch = await page
    .evaluate((wanted) => {
      const links = [...document.querySelectorAll('a[href*="/marketplace/item/"]')];
      for (const node of links) {
        const root =
          node.closest('[role="article"], [role="link"], a') || node.parentElement || node;
        const text = String((root as HTMLElement).innerText || "").toLowerCase();
        if (!wanted.every((token) => text.includes(token))) continue;
        const href = (node as HTMLAnchorElement).href || node.getAttribute("href") || "";
        const match = href.match(/marketplace\/item\/(\d+)/i);
        if (match) return match[1];
      }
      return null;
    }, tokens)
    .catch(() => null);
  if (fromSearch) {
    return {
      url: `https://www.facebook.com/marketplace/item/${fromSearch}`,
      remoteId: fromSearch,
    };
  }
  return facebookItemFromUrl(page.url());
}

export async function scanSellingPage(page: Page): Promise<SellingScan> {
  await page.goto(FACEBOOK_SELLING_URL, {
    waitUntil: "domcontentloaded",
    timeout: 45_000,
  });
  await page.waitForTimeout(1_800);
  const cards: SellingScan["cards"] = [];
  for (const name of ["Active", "In review", "Pending"]) {
    const tab = page.getByRole("tab", { name: new RegExp(`^${name}$`, "i") }).first();
    if (await tab.isVisible().catch(() => false)) {
      await tab.click({ timeout: 8_000 }).catch(() => undefined);
      await page.waitForTimeout(1_000);
    }
    const collected = await collectSellingCards(page);
    for (const card of collected.cards) {
      cards.push({
        ...card,
        state: classifySellingText(`${name} ${card.text}`),
      });
    }
  }
  const pageText = await page.locator("body").innerText().catch(() => "");
  const url = page.url();
  const loggedOut = /\/login|\/checkpoint(\/|$)/i.test(url);
  const onSelling =
    /marketplace\/you/i.test(url) || /your listings|selling/i.test(pageText);
  const loaded = !loggedOut && onSelling;
  const empty =
    cards.length === 0 &&
    /no listings|don'?t have any listings|nothing (to show|for sale)|you have no listings/i.test(
      pageText
    );
  return { loaded, empty, cards: cards.slice(0, 40), body: pageText.slice(0, 4000) };
}

export async function scanSellingTitles(page: Page): Promise<string[]> {
  const scan = await scanSellingPage(page);
  return scan.cards.map((card) => card.text);
}

export async function openInboxThread(page: Page, thread: InboxThread) {
  if (thread.href && /facebook\.com|messenger\.com/i.test(thread.href)) {
    await page.goto(thread.href, {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    });
    await page.waitForTimeout(1_400);
    return true;
  }
  const skip =
    /\d+\s+new messages?|see all|marketplace|notifications|friend suggestion/i;
  const labels = [thread.buyer, thread.hint, thread.preview]
    .map((label) => label.trim())
    .filter((label) => label.length > 2 && label.length < 80 && !skip.test(label));
  for (const exact of [true, false]) {
    for (const label of labels) {
      const target = page.getByText(label, { exact }).first();
      if (!(await target.isVisible().catch(() => false))) continue;
      try {
        await target.click({ timeout: 4_000, force: true });
        await page.waitForTimeout(1_200);
        return true;
      } catch {
        /* overlay or stale cell — try the next label */
      }
    }
  }
  return false;
}

async function readThreadWithVision(page: Page): Promise<ThreadMessage[]> {
  const shot = await page.screenshot({ type: "jpeg", quality: 45, fullPage: false });
  const raw = await complete({
    system:
      "You read an open Facebook Marketplace chat. Return JSON only. Seller messages are from You.",
    text: 'JSON: {"messages":[{"from":"buyer|seller","text":""}]}',
    images: [
      {
        media_type: "image/jpeg",
        data: shot.toString("base64"),
        detail: "low",
      },
    ],
    maxTokens: 500,
  });
  const parsed = extractJson<{
    messages?: { from?: string; text?: string }[];
  }>(raw);
  return (parsed.messages || [])
    .map((message) => {
      const text = (message.text || "").trim();
      if (!text) return null;
      return {
        from: message.from === "seller" ? "seller" : "buyer",
        text,
      } satisfies ThreadMessage;
    })
    .filter((message): message is ThreadMessage => Boolean(message))
    .slice(-12);
}

export async function readOpenThread(page: Page): Promise<ThreadMessage[]> {
  const rows = await page
    .evaluate(() => {
      const main =
        document.querySelector('[role="main"]') ||
        document.querySelector('[role="grid"]') ||
        document.body;
      const chunks = [...main.querySelectorAll("[dir='auto'], [role='row']")]
        .map((node) => {
          const el = node as HTMLElement;
          const text = String(el.innerText || "").replace(/\s+/g, " ").trim();
          const aria = el.getAttribute("aria-label") || "";
          const label = `${aria} ${text}`;
          return { text: text || aria, label };
        })
        .filter((row) => row.text.length > 1 && row.text.length < 280);
      return chunks.slice(-30);
    })
    .catch(() => [] as { text: string; label: string }[]);

  const skip =
    /^(aa|enter|send|type a message|write a message|online|active now|marketplace|privacy & support|see all)$/i;
  const messages: ThreadMessage[] = [];
  for (const row of rows) {
    if (skip.test(row.text)) continue;
    const seller = /\byou sent\b|\byou said\b|^you:/i.test(row.label);
    if (/^\d+:\d+\s*(am|pm)?$/i.test(row.text)) continue;
    messages.push({
      from: seller ? "seller" : "buyer",
      text: row.text.replace(/^you:\s*/i, "").trim(),
    });
  }
  const inbound = lastBuyerText(messages);
  if (inbound) return messages;
  return readThreadWithVision(page).catch(() => messages);
}

export async function sendFacebookReply(page: Page, text: string) {
  const reply = text.trim();
  if (!reply) return false;
  const box = page.locator('[contenteditable="true"][role="textbox"]').last();
  if (!(await box.isVisible().catch(() => false))) {
    const named = page.getByRole("textbox").last();
    if (!(await named.isVisible().catch(() => false))) return false;
    await named.click({ timeout: 8_000 });
  } else {
    await box.click({ timeout: 8_000 });
  }
  await page.keyboard.type(reply, { delay: 18 });
  await page.keyboard.press("Enter");
  await page.waitForTimeout(800);
  return true;
}
