import type { Page } from "playwright-core";
import { looksLikePersonName, parseInboxRow } from "./facebook-inbox-match";
import type { WatchedThread } from "./inbox-record";

export const EBAY_INBOX = "https://www.ebay.com/mesg/sly/overview";

export async function scanEbayInbox(page: Page): Promise<WatchedThread[]> {
  await page.goto(EBAY_INBOX, {
    waitUntil: "domcontentloaded",
    timeout: 20_000,
  });
  await page.waitForTimeout(1_000);
  const rows = await page
    .locator('[class*="message"], tr, li, a')
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
    if (/^e ?bay$|customer service|sign in|watchlist|selling|shipping/i.test(parsed.buyer)) {
      continue;
    }
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
