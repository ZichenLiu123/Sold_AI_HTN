import type { Page } from "playwright-core";
import { looksLikePersonName, parseInboxRow } from "./facebook-inbox-match";
import type { WatchedThread } from "./inbox-record";

export const CRAIGSLIST_INBOX = "https://accounts.craigslist.org/login/home?show_tab=messages";

export async function scanCraigslistInbox(page: Page): Promise<WatchedThread[]> {
  await page.goto(CRAIGSLIST_INBOX, {
    waitUntil: "domcontentloaded",
    timeout: 20_000,
  });
  await page.waitForTimeout(800);
  const rows = await page
    .locator("tr, li, .msgrow, a")
    .evaluateAll((nodes) =>
      nodes
        .map((node) => (node as HTMLElement).innerText.replace(/\s+/g, " ").trim())
        .filter((text) => text.length > 8 && text.length < 220)
    )
    .catch(() => [] as string[]);

  const seen = new Set<string>();
  const threads: WatchedThread[] = [];
  for (const raw of rows) {
    const parsed = parseInboxRow(raw);
    if (!parsed || !looksLikePersonName(parsed.buyer)) continue;
    if (/craigslist|logout|posting|drafts|billing/i.test(parsed.buyer)) continue;
    const key = `${parsed.buyer}:${parsed.preview}`;
    if (seen.has(key)) continue;
    seen.add(key);
    threads.push({
      buyer: parsed.buyer,
      hint: parsed.hint,
      preview: parsed.preview || parsed.hint,
    });
  }
  return threads.slice(0, 12);
}
