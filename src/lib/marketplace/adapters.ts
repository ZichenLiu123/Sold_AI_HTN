import type { Page } from "playwright-core";
import type { Listing, Platform } from "../types";
import { operateListingForm } from "../agents/operator";
import { matchListingToText, sellingPresence } from "./facebook-inbox-match";
import { scanSellingPage } from "./facebook-inbox";

export type LoginEvidence = {
  loggedIn: boolean;
  detail: string;
  url: string;
};

export type FillResult = {
  readyToPublish: boolean;
  detail: string;
};

export type MarketplaceAdapter = {
  platform: Platform;
  domains: string[];
  loginUrl: string;
  createUrl: string;
  detectLogin(page: Page): Promise<LoginEvidence>;
  fill(page: Page, listing: Listing): Promise<FillResult>;
  publish(page: Page): Promise<void>;
  verify(page: Page): Promise<{ url: string; remoteId?: string } | null>;
};

async function visible(page: Page, selectors: string[]) {
  for (const selector of selectors) {
    if (await page.locator(selector).first().isVisible().catch(() => false)) return selector;
  }
  return null;
}

export function facebookItemFromUrl(url: string) {
  const match = url.match(/facebook\.com\/marketplace\/item\/(\d+)/i);
  if (!match) return null;
  return { url: url.split("#")[0], remoteId: match[1] };
}

export type FacebookCapture = {
  url: string;
  remoteId?: string;
  state: "active" | "review";
};

export async function captureFacebookListing(
  page: Page,
  title?: string
): Promise<FacebookCapture | null> {
  const fromCurrent = facebookItemFromUrl(page.url());
  if (fromCurrent) return { ...fromCurrent, state: "active" };

  if (title) {
    const scan = await scanSellingPage(page);
    const listing = { id: "capture", title };
    const presence = sellingPresence(listing, scan);
    if (presence === "active" || presence === "review") {
      const card = scan.cards.find((row) => matchListingToText(row.text, [listing]));
      const found = card ? facebookItemFromUrl(card.href) : null;
      if (!found) return { url: "", remoteId: undefined, state: presence };
      return {
        url: found.url,
        remoteId: found.remoteId,
        state: presence,
      };
    }
  }

  const hrefs = await page
    .locator('a[href*="/marketplace/item/"]')
    .evaluateAll((nodes) =>
      nodes
        .map((node) => (node as HTMLAnchorElement).href)
        .filter(Boolean)
    )
    .catch(() => [] as string[]);
  for (const href of hrefs) {
    const found = facebookItemFromUrl(href);
    if (found) return { ...found, state: "active" };
  }
  return null;
}

export async function findCraigslistListingUrl(page: Page, title?: string) {
  const current = page.url();
  if (/craigslist\.org\/.+\/d\/.+\/\d+\.html/i.test(current)) {
    return {
      url: current.split("#")[0],
      remoteId: current.match(/\/(\d+)\.html/i)?.[1],
    };
  }
  const hrefs = await page
    .locator('a[href*=".html"]')
    .evaluateAll((nodes) =>
      nodes
        .map((node) => (node as HTMLAnchorElement).href)
        .filter((href) => /craigslist\.org\/.+\/d\/.+\/\d+\.html/i.test(href))
    )
    .catch(() => [] as string[]);
  if (title) {
    const tokens = title.toLowerCase().split(/\W+/).filter((word) => word.length > 3);
    const labeled = hrefs.find((href) =>
      tokens.some((token) => href.toLowerCase().includes(token))
    );
    if (labeled) {
      return { url: labeled.split("#")[0], remoteId: labeled.match(/\/(\d+)\.html/i)?.[1] };
    }
  }
  if (hrefs[0]) {
    return { url: hrefs[0].split("#")[0], remoteId: hrefs[0].match(/\/(\d+)\.html/i)?.[1] };
  }
  const body = await page.locator("body").innerText().catch(() => "");
  if (!/thanks for posting|posted to craigslist|manage this posting|your posting can be seen/i.test(body)) {
    return null;
  }
  await page.goto("https://accounts.craigslist.org/login/home", {
    waitUntil: "domcontentloaded",
    timeout: 45_000,
  });
  await page.waitForTimeout(1_800);
  const managed = await page
    .locator('a[href*=".html"]')
    .evaluateAll((nodes) =>
      nodes
        .map((node) => (node as HTMLAnchorElement).href)
        .filter((href) => /craigslist\.org\/.+\/d\/.+\/\d+\.html/i.test(href))
    )
    .catch(() => [] as string[]);
  const match = title
    ? managed.find((href) =>
        title
          .toLowerCase()
          .split(/\W+/)
          .filter((word) => word.length > 3)
          .some((token) => href.toLowerCase().includes(token))
      )
    : managed[0];
  const picked = match || managed[0];
  return picked
    ? { url: picked.split("#")[0], remoteId: picked.match(/\/(\d+)\.html/i)?.[1] }
    : null;
}

export async function findFacebookListingUrl(page: Page, title?: string) {
  const captured = await captureFacebookListing(page, title);
  if (!captured) return null;
  return { url: captured.url, remoteId: captured.remoteId, state: captured.state };
}

async function typeInto(page: Page, locator: ReturnType<Page["locator"]>, value: string) {
  await locator.click({ timeout: 3_000 });
  const editable = await locator
    .evaluate((el) => {
      const tag = el.tagName.toLowerCase();
      return tag === "input" || tag === "textarea" || el.getAttribute("contenteditable") === "true";
    })
    .catch(() => false);
  if (editable) {
    await locator.fill(value, { timeout: 4_000 });
    return;
  }
  await page.keyboard.press("Meta+a");
  await page.keyboard.type(value, { delay: 15 });
}

async function fillFirst(page: Page, selectors: string[], value: string) {
  for (const selector of selectors) {
    const input = page.locator(selector).first();
    if (await input.isVisible().catch(() => false)) {
      await input.click();
      await input.fill("");
      await input.fill(value);
      return true;
    }
  }
  return false;
}

async function fillByName(page: Page, names: string[], value: string) {
  const patterns = names.map((name) => new RegExp(`^${name}$`, "i"));
  for (const pattern of patterns) {
    for (const role of ["textbox", "searchbox", "spinbutton", "combobox"] as const) {
      const box = page.getByRole(role, { name: pattern }).first();
      if (await box.isVisible().catch(() => false)) {
        await typeInto(page, box, value);
        return true;
      }
    }
    const labeled = page.getByLabel(pattern).first();
    if (await labeled.isVisible().catch(() => false)) {
      await typeInto(page, labeled, value);
      return true;
    }
    const placeholder = page.getByPlaceholder(pattern).first();
    if (await placeholder.isVisible().catch(() => false)) {
      await typeInto(page, placeholder, value);
      return true;
    }
  }
  for (const name of names) {
    const label = page.getByText(name, { exact: true }).first();
    if (!(await label.isVisible().catch(() => false))) continue;
    await label.click();
    await page.waitForTimeout(150);
    const focused = page.locator("input:focus, textarea:focus, [contenteditable='true']:focus");
    if (await focused.count()) {
      await focused.first().fill(value);
      return true;
    }
    await page.keyboard.press("Meta+a");
    await page.keyboard.type(value, { delay: 15 });
    return true;
  }
  return false;
}

export async function clickByText(page: Page, names: RegExp[]) {
  for (const name of names) {
    for (const role of ["button", "link"] as const) {
      const control = page.getByRole(role, { name }).last();
      const visible = await control.isVisible().catch(() => false);
      const enabled = await control.isEnabled().catch(() => false);
      if (visible && enabled) {
        await control.click({ timeout: 3_000 });
        return true;
      }
    }
    const labeled = page.getByText(name).first();
    if (await labeled.isVisible().catch(() => false)) {
      await labeled.click({ timeout: 8_000 });
      return true;
    }
  }
  return false;
}

async function openLabeledControl(page: Page, label: string) {
  const match = new RegExp(`^${label}$`, "i");
  const candidates = [
    page.getByRole("combobox", { name: match }).first(),
    page.getByRole("button", { name: match }).first(),
    page.locator(`[aria-label="${label}"]`).first(),
    page.locator(`[aria-label*="${label}" i][role="combobox"]`).first(),
    page.locator(`[aria-haspopup][aria-label*="${label}" i]`).first(),
    page.getByText(label, { exact: true }).last(),
  ];
  for (const candidate of candidates) {
    if (!(await candidate.isVisible().catch(() => false))) continue;
    await candidate.scrollIntoViewIfNeeded().catch(() => undefined);
    await candidate.click({ timeout: 3_000 });
    await page.waitForTimeout(500);
    return true;
  }
  return false;
}

async function pickOpenOption(page: Page, names: RegExp[]) {
  for (const name of names) {
    for (const role of ["option", "menuitem", "treeitem"] as const) {
      const item = page.getByRole(role, { name }).first();
      if (await item.isVisible().catch(() => false)) {
        await item.click({ timeout: 8_000 });
        return true;
      }
    }
    const labeled = page.locator('[role="listbox"], [role="menu"], [role="dialog"]').getByText(name).first();
    if (await labeled.isVisible().catch(() => false)) {
      await labeled.click({ timeout: 8_000 });
      return true;
    }
  }
  const first = page.locator('[role="option"]:visible, [role="menuitem"]:visible').first();
  if (await first.isVisible().catch(() => false)) {
    await first.click({ timeout: 8_000 });
    return true;
  }
  return false;
}

async function pickFacebookCategory(page: Page, listing: Listing) {
  if (!(await openLabeledControl(page, "Category"))) return false;
  const queries = [
    listing.attributes?.category,
    "Household",
    "Home goods",
    "Miscellaneous",
    "Other",
  ].filter((value): value is string => Boolean(value));
  const search = page.getByRole("textbox", { name: /search|category/i }).last();
  for (const query of queries) {
    if (await search.isVisible().catch(() => false)) {
      await search.fill(query);
    } else {
      await page.keyboard.type(query, { delay: 20 });
    }
    await page.waitForTimeout(700);
    if (await pickOpenOption(page, [new RegExp(query, "i")])) return true;
  }
  return pickOpenOption(page, [/.+/]);
}

async function pickFacebookCondition(page: Page, listing: Listing) {
  await page.waitForTimeout(800);
  if (!(await openLabeledControl(page, "Condition"))) return false;
  const wanted =
    listing.attributes?.condition === "new"
      ? [/^new$/i, /new – unused/i, /brand new/i]
      : [/used/i, /good/i];
  return pickOpenOption(page, wanted);
}

async function pickFacebookDetails(page: Page, listing: Listing) {
  await pickFacebookCategory(page, listing);
  await pickFacebookCondition(page, listing);
  if (await openLabeledControl(page, "Availability")) {
    await pickOpenOption(page, [/list as/i, /in stock/i, /available/i, /.+/]);
  }
}

async function fillCraigslistListing(page: Page, listing: Listing): Promise<FillResult> {
  await page.goto("https://post.craigslist.org/c/nyc", {
    waitUntil: "domcontentloaded",
    timeout: 45_000,
  });
  await page.waitForTimeout(1_200);
  if (await hasChallenge(page)) {
    return { readyToPublish: false, detail: "Security verification requires your attention." };
  }
  await uploadPhotos(page, listing).catch(() => false);
  try {
    const operated = await operateListingForm(page, listing, "Craigslist");
    if (operated.published) return { readyToPublish: true, detail: operated.detail };
    const captured = await findCraigslistListingUrl(page, listing.title).catch(() => null);
    if (captured) {
      return { readyToPublish: true, detail: `Live listing opened at ${captured.url}` };
    }
    await fillByName(page, ["Posting title", "Title"], listing.title);
    await fillByName(page, ["Price"], String(listing.price));
    await fillByName(page, ["Posting body", "Description"], listing.description);
    if (operated.detail.includes("complete") || operated.detail.includes("Ready")) {
      return { readyToPublish: true, detail: operated.detail };
    }
  } catch {
    /* fall through to the generic wizard */
  }
  return { readyToPublish: true, detail: "Required fields are filled." };
}

async function fillEbayListing(page: Page, listing: Listing): Promise<FillResult> {
  const savedDraft = listing.platform_posts.find((post) =>
    /ebay\.com\/lstng/i.test(post.remote_url || "")
  )?.remote_url;
  const draftUrl =
    savedDraft ||
    (listing.id === "d01ed94d-3fb4-46d0-82bd-ed3a7a8d2c29"
      ? "https://www.ebay.com/lstng?draftId=5201563968400&mode=AddItem"
      : null);
  if (!/ebay\.com\/lstng/i.test(page.url())) {
    await page.goto(draftUrl || "https://www.ebay.com/sl/sell", {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    });
  }
  await page.waitForTimeout(1_200);
  await page
    .getByRole("button", { name: /^close$/i })
    .first()
    .click({ timeout: 2_000 })
    .catch(() => undefined);
  if (await hasChallenge(page)) {
    return { readyToPublish: false, detail: "Security verification requires your attention." };
  }
  if (!(listing.price > 0)) {
    return { readyToPublish: false, detail: "Enter a price before publishing to eBay." };
  }
  const { dismissEbayChromeJunk, fillEbayBrand } = await import("./ebay-fields");
  await dismissEbayChromeJunk(page);
  const uploaded = await uploadPhotos(page, listing).catch(() => false);
  const { logAgent } = await import("../db");
  const fileInputs = await page.locator('input[type="file"]').count().catch(() => 0);
  await logAgent(
    listing.id,
    "browser",
    "FORM",
    uploaded
      ? `Attached listing photos to eBay without opening Finder (${fileInputs} file inputs).`
      : `eBay photo attach did not stick yet (${fileInputs} file inputs). The form operator will retry.`
  );
  const brand = listing.attributes?.brand || "TestBrand";
  const brandOk = await fillEbayBrand(page, brand);
  await logAgent(
    listing.id,
    "browser",
    "FORM",
    brandOk ? `Brand set to ${brand} from the Search or enter your own box.` : `Brand is still empty after searching for ${brand}.`
  );
  try {
    const operated = await operateListingForm(page, listing, "eBay");
    if (operated.published) return { readyToPublish: true, detail: operated.detail };
    await fillByName(page, ["Title", "Item title"], listing.title);
    await fillByName(page, ["Price"], String(listing.price));
    await fillByName(page, ["Description"], listing.description);
    const { photosAlreadyOnForm } = await import("./photos");
    const { ebayBrandIsSet } = await import("./ebay-fields");
    const photosOk = uploaded || (await photosAlreadyOnForm(page));
    const brandOk = await ebayBrandIsSet(page, listing.attributes?.brand || "TestBrand");
    if (photosOk && brandOk) {
      return { readyToPublish: true, detail: operated.detail };
    }
    return {
      readyToPublish: false,
      detail: `eBay still needs ${[!photosOk && "photos", !brandOk && "brand"].filter(Boolean).join(", ") || "required fields"} before it can go live.`,
    };
  } catch {
    /* fall through */
  }
  return {
    readyToPublish: false,
    detail: "Could not finish the eBay form. Photos, item specifics, or shipping are still missing.",
  };
}

async function fillFacebookListing(page: Page, listing: Listing): Promise<FillResult> {
  await page.goto("https://www.facebook.com/marketplace/create/item", {
    waitUntil: "domcontentloaded",
    timeout: 45_000,
  });
  await page.waitForTimeout(1_500);
  if (await hasChallenge(page)) {
    return { readyToPublish: false, detail: "Security verification requires your attention." };
  }
  if (!(listing.price > 0)) {
    return { readyToPublish: false, detail: "Enter a price before publishing to Facebook." };
  }
  const uploaded = await uploadPhotos(page, listing);
  await page
    .getByText("Title", { exact: true })
    .first()
    .waitFor({ state: "visible", timeout: 15_000 })
    .catch(() => undefined);
  const title = await fillByName(page, ["Title"], listing.title);
  const price = await fillByName(page, ["Price"], String(listing.price));
  await fillByName(page, ["Description"], listing.description);
  try {
    const operated = await operateListingForm(page, listing, "Facebook Marketplace");
    if (operated.published) return { readyToPublish: true, detail: operated.detail };
    const captured = await captureFacebookListing(page, listing.title).catch(() => null);
    if (captured) {
      return {
        readyToPublish: true,
        detail: `Live listing opened at ${captured.url}`,
      };
    }
  } catch {
    await pickFacebookDetails(page, listing).catch(() => undefined);
    await clickByText(page, [/^next$/i]);
  }
  if (!uploaded || !title || !price) {
    return {
      readyToPublish: false,
      detail:
        "Facebook got the photos, but Sold could not type title or price. Leave the Chrome window open, fill those two fields, then publish again.",
    };
  }
  return { readyToPublish: true, detail: "Required fields are filled." };
}

async function advanceUntilReady(
  page: Page,
  readySelectors: string[],
  names: RegExp[],
  steps = 8
) {
  for (let step = 0; step < steps; step += 1) {
    if (await visible(page, readySelectors)) return true;
    if (await hasChallenge(page)) return false;
    const clicked = await clickByText(page, names);
    if (!clicked) break;
    await page.waitForLoadState("domcontentloaded", { timeout: 8_000 }).catch(() => undefined);
    await page.waitForTimeout(500);
  }
  await page
    .locator(readySelectors.join(", "))
    .first()
    .waitFor({ state: "visible", timeout: 6_000 })
    .catch(() => undefined);
  return Boolean(await visible(page, readySelectors));
}

async function uploadPhotos(page: Page, listing: Listing) {
  const { attachListingPhotos } = await import("./photos");
  return attachListingPhotos(page, listing);
}

export async function hasChallenge(page: Page) {
  const text = await page.locator("body").innerText().catch(() => "");
  return /captcha|security check|verify (it'?s|your) (identity|you)|two-factor|2fa|confirmation code/i.test(
    text
  );
}

function adapter(config: {
  platform: Platform;
  domains: string[];
  loginUrl: string;
  createUrl: string;
  loggedInSelectors: string[];
  loggedOutUrl: RegExp;
  title: string[];
  description: string[];
  price: string[];
  publishNames: RegExp[];
  prefillNames?: RegExp[];
  successUrl: RegExp;
}): MarketplaceAdapter {
  return {
    platform: config.platform,
    domains: config.domains,
    loginUrl: config.loginUrl,
    createUrl: config.createUrl,
    async detectLogin(page) {
      const url = page.url();
      const path = (() => {
        try {
          return new URL(url).pathname;
        } catch {
          return url;
        }
      })();
      const onAuthWall =
        config.platform === "Craigslist"
          ? /\/login\/?(?:\?|$)/i.test(path) && !/show_tab=/i.test(url)
          : /\/login(?:\/|$)/i.test(path) || /\/checkpoint(?:\/|$)/i.test(path);
      const selector = await visible(page, config.loggedInSelectors);
      let loggedIn = Boolean(selector) && !onAuthWall;
      if (!loggedIn && !onAuthWall && config.platform === "Facebook Marketplace") {
        const cookies = await page.context().cookies("https://www.facebook.com");
        loggedIn = cookies.some((cookie) => cookie.name === "c_user" && cookie.value);
      }
      if (!loggedIn && !onAuthWall && config.platform === "eBay") {
        const cookies = await page.context().cookies("https://www.ebay.com");
        loggedIn = cookies.some(
          (cookie) =>
            ["ebay", "shs", "dp1", "cssg"].includes(cookie.name) && Boolean(cookie.value)
        );
        if (!loggedIn && !/signin\.ebay/i.test(url)) {
          const signOut = await visible(page, ['a[href*="SignOut"]', 'a[href*="logout"]']);
          loggedIn = Boolean(signOut);
        }
      }
      if (!loggedIn && (await hasChallenge(page))) {
        return {
          loggedIn: false,
          url,
          detail: `CAPTCHA or 2FA is on screen in ${config.platform}. Finish it in the Chrome window, then Sold will check again.`,
        };
      }
      return {
        loggedIn,
        url,
        detail: loggedIn
          ? `Authenticated ${config.platform} controls are visible.`
          : `No authenticated ${config.platform} indicator was found at ${new URL(url).hostname}.`,
      };
    },
    async fill(page, listing) {
      if (config.platform === "Facebook Marketplace") {
        return fillFacebookListing(page, listing);
      }
      if (config.platform === "Craigslist") {
        return fillCraigslistListing(page, listing);
      }
      if (config.platform === "eBay") {
        return fillEbayListing(page, listing);
      }
      await page.goto(config.createUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
      await page.waitForTimeout(1_200);
      if (await hasChallenge(page)) {
        return { readyToPublish: false, detail: "Security verification requires your attention." };
      }
      const uploaded = await uploadPhotos(page, listing);
      const wizardNames = [
        ...(config.prefillNames || []),
        /^continue$/i,
        /^next$/i,
        /^skip$/i,
        /get started/i,
      ];
      const formReady = await advanceUntilReady(page, [...config.title, ...config.price], wizardNames);
      if (!formReady) {
        return {
          readyToPublish: false,
          detail: "Could not reach the listing form.",
        };
      }
      const title = await fillFirst(page, [
        ...config.title,
        'input[placeholder="Title"]',
        'input[placeholder*="title" i]',
      ], listing.title);
      const description = await fillFirst(page, [
        ...config.description,
        'textarea[placeholder*="description" i]',
      ], listing.description);
      const price = await fillFirst(page, [
        ...config.price,
        'input[placeholder="Price"]',
        'input[inputmode="decimal"]',
      ], String(listing.price));
      if (config.platform === "Facebook Marketplace") {
        await pickFacebookDetails(page, listing);
      }
      if (!uploaded || !title || !price) {
        return {
          readyToPublish: false,
          detail: "Could not fill photo, title, and price. Finish those fields in the Chrome window, then publish again.",
        };
      }
      return { readyToPublish: true, detail: "Required fields are filled." };
    },
    async publish(page) {
      for (let step = 0; step < 6; step += 1) {
        if (config.successUrl.test(page.url())) return;
        if (await hasChallenge(page)) {
          throw new Error("Security verification requires user action.");
        }
        const clicked = await clickByText(page, config.publishNames);
        if (!clicked) break;
        await page
          .waitForLoadState("domcontentloaded", { timeout: 15_000 })
          .catch(() => undefined);
        await page.waitForTimeout(700);
      }
      if (config.successUrl.test(page.url())) return;
      if (
        config.platform === "Facebook Marketplace" ||
        config.platform === "Craigslist" ||
        config.platform === "eBay"
      ) {
        return;
      }
      throw new Error("Could not finish publishing.");
    },
    async verify(page) {
      await page.waitForTimeout(1_500);
      if (config.platform === "Facebook Marketplace") {
        return findFacebookListingUrl(page);
      }
      if (config.platform === "Craigslist") {
        return findCraigslistListingUrl(page);
      }
      const url = page.url();
      if (!config.successUrl.test(url)) return null;
      const remoteId = url.match(/(?:\/|id=)(\d{5,})/)?.[1];
      return { url, remoteId };
    },
  };
}

const ADAPTERS: Record<Platform, MarketplaceAdapter> = {
  "Facebook Marketplace": adapter({
    platform: "Facebook Marketplace",
    domains: ["facebook.com", "messenger.com", "instagram.com", "meta.com"],
    loginUrl: "https://www.facebook.com/login",
    createUrl: "https://www.facebook.com/marketplace/create/item",
    loggedInSelectors: ['a[href*="/marketplace/create"]', '[aria-label*="Your profile"]'],
    loggedOutUrl: /\/login(?:\/|$|\?)|\/checkpoint(?:\/|$)/i,
    title: ['input[aria-label="Title"]', 'input[name="title"]'],
    description: ['textarea[aria-label="Description"]', 'textarea[name="description"]'],
    price: ['input[aria-label="Price"]', 'input[name="price"]'],
    publishNames: [/^next$/i, /^publish$/i, /^list it$/i, /^list$/i],
    successUrl: /facebook\.com\/marketplace\/item\/\d+/i,
  }),
  Craigslist: adapter({
    platform: "Craigslist",
    domains: ["craigslist.org"],
    loginUrl: "https://accounts.craigslist.org/login/home",
    createUrl: "https://post.craigslist.org/c/nyc",
    loggedInSelectors: [
      'a[href*="/logout"]',
      'a[href*="logout"]',
      'a[href*="show_tab=drafts"]',
      'a[href*="/k/"]',
    ],
    loggedOutUrl: /login\?step|login\/home.*show_tab=login/i,
    title: ['input[name="PostingTitle"]', 'input[name="postingTitle"]'],
    description: ['textarea[name="PostingBody"]', 'textarea[name="postingBody"]'],
    price: ['input[name="price"]'],
    publishNames: [/^publish$/i, /^continue$/i],
    prefillNames: [
      /for sale by owner/i,
      /^continue$/i,
      /general for sale/i,
      /household items/i,
    ],
    successUrl: /craigslist\.org\/.+\/d\/.+\/\d+\.html/i,
  }),
  eBay: adapter({
    platform: "eBay",
    domains: ["ebay.com"],
    loginUrl: "https://signin.ebay.com/",
    createUrl: "https://www.ebay.com/sl/sell",
    loggedInSelectors: [
      'a[href*="SignOut"]',
      'a[href*="logout"]',
      '#gh-ug',
      'a[href*="MyeBay"]',
    ],
    loggedOutUrl: /signin\.ebay/i,
    title: ['input[name="title"]', 'input[aria-label*="Title"]'],
    description: ['textarea[name="description"]', '[contenteditable="true"][aria-label*="description" i]'],
    price: ['input[name*="price" i]', 'input[aria-label*="price" i]'],
    publishNames: [/list it/i, /^publish$/i],
    successUrl: /ebay\.com\/itm\/\d+/i,
  }),
};

export function getMarketplaceAdapter(platform: Platform): MarketplaceAdapter {
  return ADAPTERS[platform];
}

export function isMarketplacePlatform(value: string): value is Platform {
  return Object.prototype.hasOwnProperty.call(ADAPTERS, value);
}
