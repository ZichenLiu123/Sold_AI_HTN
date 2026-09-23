import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";
import type {
  CompData,
  CompListing,
  CompSourceDiagnostic,
  ItemAttributes,
} from "../types";
import { itemSize, median } from "../util.ts";
import { normalizeGoogleQuery } from "./search-query.ts";

type SiteKey =
  | "ebay"
  | "craigslist"
  | "facebook"
  | "mercari"
  | "offerup"
  | "poshmark"
  | "shopping";

type Site = {
  key: SiteKey;
  name: string;
  host: string;
  sold: boolean;
  itemLink: string;
  readySelector: string;
  url: (query: string) => string;
};

type RawListing = {
  title: string;
  priceText: string;
  url: string;
  context: string;
  sold: boolean;
};

type SourceResult = {
  comps: CompListing[];
  diagnostic: CompSourceDiagnostic;
};

const SITES: Site[] = [
  {
    key: "ebay",
    name: "eBay",
    host: "ebay.com",
    sold: true,
    itemLink: 'a[href*="/itm/"]',
    readySelector: "li.s-item, li.s-card",
    url: (query) =>
      `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(query)}&LH_Sold=1&LH_Complete=1&_sop=13`,
  },
  {
    key: "craigslist",
    name: "Craigslist",
    host: "craigslist.org",
    sold: false,
    itemLink: 'a[href*=".html"]',
    readySelector: ".cl-search-result, .cl-static-search-result",
    url: (query) =>
      `https://newyork.craigslist.org/search/sss?query=${encodeURIComponent(query)}&sort=date`,
  },
  {
    key: "facebook",
    name: "Facebook Marketplace",
    host: "facebook.com/marketplace",
    sold: false,
    itemLink: 'a[href*="/marketplace/item/"]',
    readySelector: 'a[href*="/marketplace/item/"]',
    url: (query) =>
      `https://www.facebook.com/marketplace/nyc/search?query=${encodeURIComponent(query)}`,
  },
  {
    key: "mercari",
    name: "Mercari",
    host: "mercari.com",
    sold: false,
    itemLink: 'a[href*="/item/"]',
    readySelector: '[data-testid="ItemContainer"], a[href*="/item/"]',
    url: (query) =>
      `https://www.mercari.com/search/?keyword=${encodeURIComponent(query)}`,
  },
  {
    key: "offerup",
    name: "OfferUp",
    host: "offerup.com",
    sold: false,
    itemLink: 'a[href*="/item/"]',
    readySelector: 'a[href*="/item/"], [data-test*="listing"]',
    url: (query) =>
      `https://offerup.com/search?q=${encodeURIComponent(query)}`,
  },
  {
    key: "poshmark",
    name: "Poshmark",
    host: "poshmark.com",
    sold: false,
    itemLink: 'a[href*="/listing/"]',
    readySelector: 'a[href*="/listing/"], .tile',
    url: (query) =>
      `https://poshmark.com/search?query=${encodeURIComponent(query)}&type=listings`,
  },
  {
    key: "shopping",
    name: "Web shopping",
    host: "google.com",
    sold: false,
    itemLink: 'a[href*="/shopping/product/"], a[href^="http"]',
    readySelector:
      ".PhALMc, .lmQWe, .sh-dgr__grid-result, .sh-dgr__content, [data-docid], [role='img'][title], a[href*='/shopping/product/']",
    url: (query) =>
      `https://www.google.com/search?tbm=shop&udm=28&hl=en&gl=us&q=${encodeURIComponent(query)}`,
  },
];

const BLOCK_TEXT =
  /captcha|verify you are human|unusual traffic|access denied|temporarily blocked|security check|robot or human|cloudflare/i;
const LOGIN_TEXT =
  /log in to continue|you must log in|sign in to continue|create new account/i;
const CONSENT_TEXT =
  /allow all cookies|accept all cookies|privacy choices|consent to cookies/i;
const NO_RESULTS_TEXT =
  /no results|nothing found|we couldn't find|try another search|0 results|no exact matches/i;
const CONDITION_WORDS = new Set([
  "used",
  "preowned",
  "pre-owned",
  "good",
  "fair",
  "poor",
  "condition",
]);
const TOKEN_STOP_WORDS = new Set([
  "and",
  "the",
  "with",
  "for",
  "from",
  "used",
  "preowned",
  "condition",
  "item",
  "sale",
]);
const CONTAINER_WORDS = new Set([
  "bottle",
  "bottles",
  "box",
  "boxes",
  "container",
  "package",
  "packaging",
  "can",
  "cans",
]);

function withAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new Error("Comp search timed out"));
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new Error("Comp search timed out"));
    signal.addEventListener("abort", abort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      }
    );
  });
}

function cleanTerm(value: string | null | undefined): string {
  return (value || "")
    .replace(/[^\p{L}\p{N}\-+&' ]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const WEAK_CATEGORY_TOKENS = new Set([
  "water",
  "gift",
  "item",
  "product",
  "plastic",
]);
const TOKEN_ALIASES: Record<string, string[]> = {
  laptop: ["laptop", "macbook", "notebook", "mac book"],
  juice: ["juice", "jus"],
  bottle: ["bottle", "tumbler", "freesip"],
};

function categorySearchTerms(category: string, hasBrand: boolean): string[] {
  const tokens = queryTokens(cleanTerm(category));
  const long = tokens.filter((token) => token.length >= 3);
  if (!hasBrand) return long;
  const withoutContainers = long.filter((token) => !CONTAINER_WORDS.has(token));
  if (
    withoutContainers.length === 0 ||
    withoutContainers.every((token) => WEAK_CATEGORY_TOKENS.has(token))
  ) {
    return long;
  }
  return withoutContainers;
}

function tokenInTitle(title: string, token: string): boolean {
  const normalized = title.toLowerCase();
  const aliases = TOKEN_ALIASES[token] || [token];
  return aliases.some((alias) => normalized.includes(alias));
}

export function buildCompQueries(attributes: ItemAttributes): {
  primary: string;
  alternate: string;
  google: string;
} {
  const brand = cleanTerm(attributes.brand);
  const model = cleanTerm(attributes.model);
  const category = cleanTerm(attributes.category);
  const color = cleanTerm(attributes.color);
  const size = itemSize(attributes.model, attributes.visible_text);
  const features = attributes.notable_features
    .map(cleanTerm)
    .filter((term) => term.length >= 3)
    .slice(0, 2);
  const condition = cleanTerm(attributes.condition).toLowerCase();
  const usefulCondition =
    condition && !CONDITION_WORDS.has(condition) ? condition : "";
  const categoryBits = categorySearchTerms(category, Boolean(brand));

  const identifying = [brand, model].filter(Boolean);
  // Prefer vision's Google-ready phrase when present.
  const fromVision = normalizeGoogleQuery(attributes.search_query, []);
  const primaryParts =
    fromVision.split(" ").filter(Boolean).length >= 2
      ? fromVision.split(" ")
      : identifying.length >= 2
        ? identifying
        : identifying.length
          ? [...identifying, size, ...categoryBits]
          : [color, ...features, category];
  if (
    usefulCondition &&
    !identifying.length &&
    !attributes.search_query &&
    primaryParts.join(" ").length < 65
  ) {
    primaryParts.push(usefulCondition);
  }
  const primary = [...new Set(primaryParts.filter(Boolean))]
    .join(" ")
    .slice(0, 110)
    .trim();

  const alternateParts = identifying.length
    ? [...identifying, ...categoryBits]
    : [color, category];
  const alternate =
    [...new Set(alternateParts.filter(Boolean))].join(" ").slice(0, 90).trim() ||
    primary;

  const google = normalizeGoogleQuery(attributes.search_query || primary, [
    brand,
    model,
    size,
    ...categoryBits,
  ]);

  return {
    primary: primary || "secondhand item",
    alternate,
    google: google || primary || "secondhand item",
  };
}

function pricingSet(comps: CompListing[]): {
  rows: CompListing[];
  basis: CompData["pricing_basis"];
} {
  const sold = comps.filter((comp) => comp.sold);
  if (sold.length >= 3) return { rows: sold, basis: "sold" };
  if (sold.length > 0) return { rows: comps, basis: "mixed" };
  if (comps.length > 0) return { rows: comps, basis: "asking" };
  return { rows: [], basis: "none" };
}

function summarize(comps: CompListing[], extra: Partial<CompData>): CompData {
  const priced = pricingSet(comps);
  const prices = priced.rows.map((comp) => comp.price);
  const sources = extra.sources?.length
    ? extra.sources
    : [...new Set(comps.map((comp) => comp.source))];
  return {
    source: extra.source || sources.join(", ") || "market comps",
    sources,
    query: extra.query || "",
    comps,
    min: prices.length ? Math.min(...prices) : null,
    max: prices.length ? Math.max(...prices) : null,
    median: median(prices),
    mocked: extra.mocked ?? false,
    confidence: extra.confidence ?? "none",
    failure_reason: extra.failure_reason ?? null,
    session_url: extra.session_url ?? null,
    attempted_sources: extra.attempted_sources ?? [],
    successful_sources: extra.successful_sources ?? sources,
    diagnostics: extra.diagnostics ?? [],
    pricing_basis: extra.pricing_basis ?? priced.basis,
  };
}

function unavailableComps(
  query: string,
  reason: string,
  details: Partial<CompData> = {}
): CompData {
  return summarize([], {
    source: "No verified marketplace prices found",
    sources: [],
    query,
    mocked: true,
    confidence: "none",
    failure_reason: reason,
    pricing_basis: "none",
    ...details,
  });
}

function queryTokens(query: string): string[] {
  return [
    ...new Set(
      query
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .filter((token) => token.length >= 2 && !TOKEN_STOP_WORDS.has(token))
    ),
  ];
}

function normalizeUrl(raw: string): string {
  try {
    const url = new URL(raw);
    for (const key of [...url.searchParams.keys()]) {
      if (/^(campid|customid|mkcid|mkevt|mkrid|toolid|utm_|tracking)/i.test(key)) {
        url.searchParams.delete(key);
      }
    }
    url.hash = "";
    return url.toString();
  } catch {
    return raw;
  }
}

function relevantTitle(
  title: string,
  query: string,
  requiredAny: string[] = [],
  requiredAll: string[] = []
): boolean {
  const tokens = queryTokens(query);
  if (tokens.length === 0) return false;
  const normalized = title.toLowerCase();
  const matches = tokens.filter((token) => tokenInTitle(normalized, token)).length;
  const required = tokens.length <= 2 ? 1 : 2;
  const hasRequired =
    requiredAny.length === 0 ||
    requiredAny.some((token) => tokenInTitle(normalized, token));
  const hasCategory =
    requiredAll.length === 0 ||
    requiredAll.every((token) => tokenInTitle(normalized, token));
  return matches >= required && hasRequired && hasCategory;
}

function cleanCompTitle(title: string): string {
  return title
    .replace(/About this result[\s\S]*$/i, "")
    .replace(/Report a violation[\s\S]*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function removeOutliers(rows: CompListing[]): CompListing[] {
  if (rows.length < 4) return rows;
  const prices = rows.map((row) => row.price).sort((a, b) => a - b);
  const q1 = prices[Math.floor((prices.length - 1) * 0.25)];
  const q3 = prices[Math.floor((prices.length - 1) * 0.75)];
  const iqr = Math.max(1, q3 - q1);
  const lower = Math.max(3, q1 - iqr * 1.5);
  const upper = q3 + iqr * 1.5;
  return rows.filter((row) => row.price >= lower && row.price <= upper);
}

export function verifyComps(
  comps: CompListing[],
  query: string,
  requiredAny: string[] = [],
  requiredAll: string[] = []
): CompListing[] {
  const unique = new Map<string, CompListing>();
  const seenOffer = new Set<string>();
  for (const comp of comps) {
    const title = cleanCompTitle(comp.title);
    const validUrl = /^https?:\/\//.test(comp.url);
    if (
      !validUrl ||
      title.length < 3 ||
      !relevantTitle(title, query, requiredAny, requiredAll) ||
      comp.price < 1 ||
      comp.price > 100_000
    ) {
      continue;
    }
    const url = normalizeUrl(comp.url);
    const key = `${comp.source}|${url.replace(/\/$/, "")}`;
    const offer = `${comp.source}|${comp.price}|${title.toLowerCase().slice(0, 48)}`;
    if (unique.has(key) || seenOffer.has(offer)) continue;
    unique.set(key, { ...comp, title, url });
    seenOffer.add(offer);
  }
  return removeOutliers([...unique.values()]);
}

export function requiredIdentityTokens(attributes: ItemAttributes): string[] {
  return [attributes.brand, attributes.model]
    .flatMap((value) => queryTokens(cleanTerm(value)))
    .filter(Boolean);
}

export function requiredCategoryTokens(attributes: ItemAttributes): string[] {
  return queryTokens(cleanTerm(attributes.category));
}

function verifySourceComps(
  comps: CompListing[],
  query: string,
  requiredAny: string[],
  requiredAll: string[]
): CompListing[] {
  const shopping = comps.filter((comp) => comp.source === "Web shopping");
  const rest = comps.filter((comp) => comp.source !== "Web shopping");
  return removeOutliers([
    ...verifyComps(rest, query, requiredAny, requiredAll),
    ...verifyComps(shopping, query, [], requiredAll),
  ]);
}

/** Stop once three sold comps can lock a median — matches hasSoldPriceLock. */
export function enoughVerifiedComps(comps: CompListing[]): boolean {
  return comps.filter((comp) => comp.sold).length >= 3;
}

/** Three URL-backed sold comps already lock the median — do not mix in retail asks. */
export function hasSoldPriceLock(comps: CompData): boolean {
  return (
    !comps.mocked &&
    comps.median != null &&
    comps.comps.filter((comp) => comp.sold).length >= 3
  );
}

/** Brand+model tokens beat generic category words that drop real sold titles. */
export function relevanceTokens(attributes: ItemAttributes): {
  any: string[];
  all: string[];
} {
  const any = requiredIdentityTokens(attributes);
  if (any.length >= 2) return { any, all: [] };
  if (any.length === 1) {
    return {
      any,
      all: categorySearchTerms(attributes.category || "", true),
    };
  }
  return { any, all: requiredCategoryTokens(attributes) };
}

export function mergeCompData(
  primary: CompData,
  extra: CompData,
  requiredAny: string[] = [],
  requiredAll: string[] = []
): CompData {
  const query = primary.query || extra.query;
  const verified = verifySourceComps(
    [...(primary.comps || []), ...(extra.comps || [])],
    query,
    requiredAny,
    requiredAll
  );
  const diagnostics = [
    ...(primary.diagnostics || []),
    ...(extra.diagnostics || []),
  ];
  const attempted = [
    ...new Set([
      ...(primary.attempted_sources || primary.sources || []),
      ...(extra.attempted_sources || extra.sources || []),
    ]),
  ];
  const successfulSources = [...new Set(verified.map((comp) => comp.source))];
  if (verified.length < 3) {
    const partial = summarize(verified, {
      source: "Insufficient verified marketplace evidence",
      sources: successfulSources,
      query,
      mocked: false,
      confidence: "none",
      failure_reason: `Only ${verified.length} trustworthy comparable${
        verified.length === 1 ? "" : "s"
      } found; at least 3 are required.`,
      session_url: primary.session_url || extra.session_url,
      attempted_sources: attempted,
      successful_sources: successfulSources,
      diagnostics,
      pricing_basis: "none",
    });
    return {
      ...partial,
      min: null,
      max: null,
      median: null,
      pricing_basis: "none",
    };
  }
  const selected = verified
    .sort((a, b) => Number(b.sold) - Number(a.sold))
    .slice(0, 24);
  const soldCount = selected.filter((comp) => comp.sold).length;
  const sourceCount = new Set(selected.map((comp) => comp.source)).size;
  return summarize(selected, {
    source: `Live comps: ${successfulSources.join(", ")}`,
    sources: successfulSources,
    query,
    mocked: false,
    confidence:
      soldCount >= 3 && selected.length >= 5
        ? "high"
        : soldCount >= 1 || sourceCount >= 2
          ? "medium"
          : "low",
    session_url: primary.session_url || extra.session_url,
    attempted_sources: attempted,
    successful_sources: successfulSources,
    diagnostics,
  });
}

export function parseMarketplacePrice(raw: string): number | null {
  if (
    !raw ||
    /shipping|delivery|postage|per month|\/mo\b|payments? of|financing|deposit/i.test(
      raw
    )
  ) {
    return null;
  }
  if (/\d\s*[-–—to]+\s*\$?\s*\d/i.test(raw) && !/was|usually|off/i.test(raw)) {
    return null;
  }
  const current = raw
    .replace(/was\s*(?:US\s*)?\$\s*[\d,]+(?:\.\d{1,2})?/gi, "")
    .replace(/usually\s*(?:US\s*)?\$\s*[\d,]+(?:\.\d{1,2})?/gi, "");
  const matches = [...current.matchAll(/(?:from\s+)?(?:US\s*)?\$\s*([\d,]+(?:\.\d{1,2})?)/gi)];
  if (matches.length === 0) return null;
  const value = Number.parseFloat(matches[0][1].replace(/,/g, ""));
  return Number.isFinite(value) && value > 0 ? Math.round(value) : null;
}

async function pageState(page: Page): Promise<{
  body: string;
  title: string;
}> {
  return page.evaluate(() => ({
    body: (document.body?.innerText || "").slice(0, 18_000),
    title: document.title || "",
  }));
}

function failureFromPage(body: string, title: string): string | null {
  const text = `${title}\n${body}`;
  if (BLOCK_TEXT.test(text)) return "Challenge or anti-bot page";
  if (LOGIN_TEXT.test(text)) return "Login required";
  if (NO_RESULTS_TEXT.test(text)) return "No results";
  if (CONSENT_TEXT.test(text)) return "Cookie consent blocked results";
  return null;
}

async function waitForEvidence(page: Page, site: Site): Promise<void> {
  await Promise.race([
    page.waitForSelector(site.readySelector, { timeout: 6500 }).catch(() => null),
    page
      .waitForFunction(
        (patterns) => {
          const text = document.body?.innerText || "";
          return patterns.some((pattern) => new RegExp(pattern, "i").test(text));
        },
        [
          BLOCK_TEXT.source,
          LOGIN_TEXT.source,
          CONSENT_TEXT.source,
          NO_RESULTS_TEXT.source,
        ],
        { timeout: 6500 }
      )
      .catch(() => null),
  ]);
}

async function clearConsent(page: Page, site: Site): Promise<boolean> {
  const clicked = await page
    .evaluate(() => {
      const label = (el: Element) =>
        (el.textContent || "").replace(/\s+/g, " ").trim();
      const match = (el: Element) =>
        /^(accept all( cookies)?|allow all( cookies)?|i agree|i accept|agree|accept)$/i.test(
          label(el)
        );
      const selectors = [
        "#onetrust-accept-btn-handler",
        "#gdpr-banner-accept",
        '[data-testid="gdpr-banner-accept"]',
        "button[id*='accept-all' i]",
        "button[id*='acceptAll' i]",
        "button[aria-label*='accept all' i]",
      ];
      for (const selector of selectors) {
        const el = document.querySelector(selector) as HTMLElement | null;
        if (el) {
          el.click();
          return true;
        }
      }
      const hit = [...document.querySelectorAll("button, [role='button']")].find(
        match
      ) as HTMLElement | undefined;
      if (hit) {
        hit.click();
        return true;
      }
      return false;
    })
    .catch(() => false);

  if (!clicked) {
    for (const frame of page.frames()) {
      const button = frame.getByRole("button", {
        name: /accept all|allow all|accept cookies|i accept|i agree|^accept$|^agree$/i,
      }).first();
      if (await button.isVisible().catch(() => false)) {
        await button.click({ timeout: 2500 }).catch(() => undefined);
        await page
          .waitForSelector(site.readySelector, { timeout: 4500 })
          .catch(() => null);
        return true;
      }
    }
    return false;
  }
  await page
    .waitForSelector(site.readySelector, { timeout: 4500 })
    .catch(() => null);
  return true;
}

async function extractSiteListings(
  page: Page,
  site: Site,
  soldOverride?: boolean
): Promise<CompListing[]> {
  const raw = await page.evaluate(
    ({ siteKey, itemLink, defaultSold }) => {
      type Candidate = {
        title: string;
        priceText: string;
        url: string;
        context: string;
        sold: boolean;
      };
      const strategies: Record<
        string,
        { cards: string; title: string; price: string; link: string }
      > = {
        ebay: {
          cards: "li.s-item, li.s-card",
          title: ".s-item__title, .s-card__title, h3",
          price: ".s-item__price, .s-card__price",
          link: 'a.s-item__link, a[href*="/itm/"]',
        },
        craigslist: {
          cards: ".cl-search-result, .cl-static-search-result",
          title: ".titlestring, .title, a.posting-title",
          price: ".priceinfo, .price",
          link: "a.posting-title, a.main, a[href$='.html']",
        },
        facebook: {
          cards:
            '[data-testid="marketplace_feed_item"], a[href*="/marketplace/item/"]',
          title:
            '[role="heading"], img[alt], span[dir="auto"], a[aria-label]',
          price: 'span[dir="auto"]',
          link: 'a[href*="/marketplace/item/"]',
        },
        mercari: {
          cards: '[data-testid="ItemContainer"], a[href*="/item/"]',
          title: '[data-testid*="ItemName"], [class*="title"], img[alt], p',
          price: '[data-testid*="ItemPrice"], [class*="price"], p',
          link: 'a[href*="/item/"]',
        },
        offerup: {
          cards: 'a[href*="/item/"], [data-test*="listing"], article',
          title: 'img[alt], [class*="title"], p, span',
          price: '[class*="price"], span',
          link: 'a[href*="/item/"]',
        },
        poshmark: {
          cards: 'a[href*="/listing/"], .tile, .card',
          title: 'img[alt], [class*="title"], p',
          price: '[class*="price"], span',
          link: 'a[href*="/listing/"]',
        },
        shopping: {
          cards:
            ".sh-dgr__grid-result, .sh-dgr__content, [data-docid], [class*='sh-dgr']",
          title:
            ".tAxDx, .Xjkr3b, [class*='product-title'], h3, img[alt]",
          price:
            ".a8Pemb, .HRLxBb, [class*='price'], [aria-label*='$']",
          link:
            'a[href*="/shopping/product/"], a[href^="http"]',
        },
      };
      const strategy = strategies[siteKey];
      const candidates: Candidate[] = [];
      const seen = new Set<Element>();

      // Google's current Shopping layout changes class names frequently. Price
      // text, product images, and links are more stable than those classes, so
      // recover cards by walking upward from exact price nodes.
      if (siteKey === "shopping") {
        const usefulShoppingUrl = (href: string) => {
          if (!/^https?:/i.test(href)) return false;
          if (/accounts\.google|support\.google|policies\.google/i.test(href)) {
            return false;
          }
          return (
            href.includes("/shopping/product/") ||
            href.includes("google.com/url?") ||
            /(?:tbm=shop|udm=28)/i.test(href) ||
            !/google\./i.test(href)
          );
        };
        const productCards = [
          ...document.querySelectorAll(".PhALMc, [jsname='luUKCc']"),
        ];
        const seenCards = new Set<string>();
        for (const card of productCards) {
          const titled = card.querySelector("[role='img'][title]");
          let title = (titled?.getAttribute("title") || "").replace(/\s+/g, " ").trim();
          const priceNode =
            card.querySelector(".lmQWe, .a8Pemb, .HRLxBb") ||
            [...card.querySelectorAll("span, div")].find((node) =>
              /^\$\s*[\d,]+(?:\.\d{1,2})?$/.test(
                (node.textContent || "").replace(/\s+/g, " ").trim()
              )
            );
          const priceText = (priceNode?.textContent || "").replace(/\s+/g, " ").trim();
          const text = (card.textContent || "").replace(/\s+/g, " ").trim();
          if (title.length < 3) {
            title = text
              .replace(/(?:\d+%\s*OFF)?/i, " ")
              .replace(/(?:from\s+)?(?:US\s*)?\$\s*[\d,]+(?:\.\d{1,2})?/gi, " ")
              .replace(/\b(was|usually|sale|off|& more|free delivery|returns?)\b/gi, " ")
              .replace(/\s+/g, " ")
              .trim()
              .slice(0, 140);
          }
          const key = `${title}|${priceText}`;
          if (title.length < 8 || !priceText || seenCards.has(key)) continue;
          seenCards.add(key);
          const link = [...card.querySelectorAll("a[href]")].find((anchor) =>
            usefulShoppingUrl((anchor as HTMLAnchorElement).href || "")
          ) as HTMLAnchorElement | undefined;
          const url =
            link?.href ||
            `${location.origin}/search?tbm=shop&udm=28&hl=en&gl=us&q=${encodeURIComponent(title)}`;
          candidates.push({
            title: title.slice(0, 180),
            priceText,
            url,
            context: text.slice(0, 260),
            sold: false,
          });
        }
        const priceNodes = candidates.length
          ? []
          : [...document.querySelectorAll("span, div, b, em, a")].filter(
          (node) => {
            const text = (node.textContent || "").replace(/\s+/g, " ").trim();
            if (text.length === 0 || text.length > 70) return false;
            if (!/(?:from\s+)?(?:US\s*)?\$\s*[\d,]+(?:\.\d{1,2})?/i.test(text)) return false;
            if (/shipping|delivery|\/mo\b|month/i.test(text)) return false;
            return ![...node.querySelectorAll("span, div, b, em")].some((child) =>
              /\$\s*[\d,]/.test((child.textContent || "").trim())
            );
          }
        );
        for (const priceNode of priceNodes) {
          let card: Element | null = priceNode;
          for (let depth = 0; depth < 12 && card; depth += 1) {
            const image = card.querySelector("img");
            const links = [...card.querySelectorAll("a[href]")] as HTMLAnchorElement[];
            const link =
              links.find((anchor) => usefulShoppingUrl(anchor.href || "")) ||
              links.find((anchor) => (anchor.href || "").includes("/shopping/product/"));
            const text = (card.textContent || "").replace(/\s+/g, " ").trim();
            if (text.length >= 8 && text.length <= 1200 && (image || link || card.querySelector("[title]"))) {
              const heading = card.querySelector(
                "h3, h4, [role='heading'], .tAxDx, .Xjkr3b, [role='img'][title]"
              );
              let title = (
                heading?.getAttribute("title") ||
                heading?.textContent ||
                image?.getAttribute("alt") ||
                image?.getAttribute("aria-label") ||
                link?.getAttribute("aria-label") ||
                ""
              )
                .replace(/\s+/g, " ")
                .trim();
              if (title.length < 3) {
                title = text
                  .replace(/(?:from\s+)?(?:US\s*)?\$\s*[\d,]+(?:\.\d{1,2})?/gi, " ")
                  .replace(/\b(was|usually|sale|off)\b/gi, " ")
                  .replace(/\s+/g, " ")
                  .trim()
                  .slice(0, 120);
              }
              let url =
                link?.href ||
                `${location.origin}/search?tbm=shop&udm=28&hl=en&gl=us&q=${encodeURIComponent(title)}`;
              try {
                const parsed = new URL(url);
                const target =
                  parsed.searchParams.get("q") || parsed.searchParams.get("url");
                if (parsed.pathname === "/url" && target) url = target;
              } catch {
                /* keep original */
              }
              if (title.length >= 3 && usefulShoppingUrl(url)) {
                candidates.push({
                  title: title.slice(0, 180),
                  priceText: (priceNode.textContent || "").trim(),
                  url,
                  context: text.slice(0, 260),
                  sold: false,
                });
                break;
              }
            }
            card = card.parentElement;
          }
        }
      }

      let cards = [...document.querySelectorAll(strategy.cards)];

      // Link-based site markup often puts content in a parent card.
      cards = cards.map((node) => {
        if (node.matches(itemLink)) {
          return (
            node.closest("article, li, [role='article'], [data-testid]") ||
            node.parentElement ||
            node
          );
        }
        return node;
      });

      const collect = (
        card: Element,
        selectors: typeof strategy,
        generic = false
      ) => {
        if (seen.has(card)) return;
        seen.add(card);
        const text = (card.textContent || "").replace(/\s+/g, " ").trim();
        const link =
          card.matches("a[href]")
            ? card
            : card.querySelector(selectors.link || itemLink);
        const url = (link as HTMLAnchorElement | null)?.href || "";
        if (!url) return;
        const titleNode = card.querySelector(selectors.title);
        const imageAlt = card.querySelector("img[alt]")?.getAttribute("alt") || "";
        const aria = link?.getAttribute("aria-label") || "";
        const title = (
          titleNode?.getAttribute("alt") ||
          titleNode?.textContent ||
          imageAlt ||
          aria ||
          ""
        )
          .replace(/New Listing/gi, "")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 180);
        const priceNodes = [...card.querySelectorAll(selectors.price)];
        const explicitPrice = priceNodes
          .map((node) => (node.textContent || "").trim())
          .find((value) => /\$\s*[\d,]+/.test(value));
        const priceText =
          explicitPrice || text.match(/(?:US\s*)?\$\s*[\d,]+(?:\.\d{1,2})?/)?.[0] || "";
        if (title.length < 3 || !priceText) return;
        candidates.push({
          title,
          priceText,
          url,
          context: generic ? `generic ${text.slice(0, 260)}` : text.slice(0, 260),
          sold: defaultSold || /\bsold\b/i.test(text),
        });
      };

      cards.forEach((card) => collect(card, strategy));
      if (candidates.length === 0) {
        const genericStrategy = {
          cards: "",
          title: "h2, h3, [role='heading'], img[alt], [class*='title']",
          price: "[class*='price'], [data-testid*='price']",
          link: itemLink,
        };
        document
          .querySelectorAll(
            `article, li, [role="article"], [data-testid*="product"], [class*="listing"]`
          )
          .forEach((card) => collect(card, genericStrategy, true));
      }
      return candidates.slice(0, 24);
    },
    {
      siteKey: site.key,
      itemLink: site.itemLink,
      defaultSold: soldOverride ?? site.sold,
    }
  );

  const comps: CompListing[] = [];
  for (const row of raw as RawListing[]) {
    if (
      /shop on ebay|results matching fewer words|sponsored results/i.test(row.title) ||
      /shipping|delivery|postage|payments? of|per month|\/mo\b|deposit/i.test(
        row.priceText
      )
    ) {
      continue;
    }
    const price = parseMarketplacePrice(row.priceText);
    if (!price) continue;
    const title =
      site.key === "shopping"
        ? row.title
            .replace(/\s+[A-Za-z0-9.&'+-]+\d(?:\.\d)?\(\d+\)\s*$/g, "")
            .replace(/\s+\d(?:\.\d)?\s*\(\d+\)\s*$/g, "")
            .replace(/\s+&\s*more\s*$/i, "")
            .trim()
        : row.title;
    if (title.length < 3) continue;
    comps.push({
      title,
      price,
      url: row.url,
      source: site.name,
      sold: row.sold,
    });
  }
  return comps.slice(0, 16);
}

function googleSearchUrl(site: Site, query: string): string {
  const host = site.host.split("/")[0];
  const term =
    site.key === "ebay"
      ? `site:ebay.com/itm ${query} sold`
      : site.key === "facebook"
        ? `site:facebook.com/marketplace/item ${query}`
        : site.key === "craigslist"
          ? `site:craigslist.org ${query} $`
          : `site:${host} ${query} price`;
  return `https://www.google.com/search?hl=en&gl=us&num=20&q=${encodeURIComponent(term)}`;
}

function googleShoppingUrl(query: string) {
  return `https://www.google.com/search?tbm=shop&udm=28&hl=en&gl=us&q=${encodeURIComponent(query)}`;
}

/** eBay sold comps via Google — more accurate than fighting eBay markup when query is sharp. */
function googleEbaySoldUrl(query: string) {
  return `https://www.google.com/search?hl=en&gl=us&num=20&q=${encodeURIComponent(
    `site:ebay.com/itm ${query} sold`
  )}`;
}

async function settleListings(page: Page) {
  await page
    .evaluate(async () => {
      const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
      window.scrollBy(0, 1800);
      await pause(350);
      window.scrollBy(0, 1800);
      await pause(250);
    })
    .catch(() => undefined);
}

async function extractSearchResults(page: Page, site: Site): Promise<CompListing[]> {
  const rows = await page.evaluate(
    ({ host, source, defaultSold }) => {
      const result: { title: string; priceText: string; url: string; sold: boolean }[] = [];
      document.querySelectorAll("div.MjjYud, div.g, .tF2Cxc").forEach((card) => {
        const link = card.querySelector("a[href]") as HTMLAnchorElement | null;
        const title = card.querySelector("h3")?.textContent?.trim() || "";
        const text = (card.textContent || "").replace(/\s+/g, " ");
        const price = text.match(/(?:US\s*)?\$\s*[\d,]+(?:\.\d{1,2})?/)?.[0] || "";
        let url = link?.href || "";
        try {
          const parsed = new URL(url);
          const target = parsed.searchParams.get("q") || parsed.searchParams.get("url");
          if (parsed.pathname === "/url" && target) url = target;
        } catch {
          /* keep original */
        }
        const hostToken = host.split("/")[0];
        if (url.includes(hostToken) && title && price) {
          result.push({
            title,
            priceText: price,
            url,
            sold: defaultSold || /\bsold\b/i.test(text),
          });
        }
      });
      return { rows: result.slice(0, 16), source };
    },
    { host: site.host, source: site.name, defaultSold: site.sold }
  );
  return rows.rows
    .map((row) => {
      const price = parseMarketplacePrice(row.priceText);
      return price
        ? {
            title: row.title,
            price,
            url: row.url,
            source: site.name,
            sold: row.sold,
          }
        : null;
    })
    .filter((row): row is CompListing => row !== null);
}

async function trySource(
  context: BrowserContext,
  site: Site,
  primary: string,
  alternate: string,
  signal: AbortSignal,
  googleQuery?: string
): Promise<SourceResult> {
  const page = await context.newPage();
  const shopQuery = (googleQuery || primary).trim() || primary;
  const diagnostic: CompSourceDiagnostic = {
    source: site.name,
    attempted: true,
    successful: false,
    attempts: 0,
    found: 0,
    reason: null,
  };
  let firstFailure: string | null = null;
  const stopOnAbort = () => {
    page.close().catch(() => undefined);
  };
  signal.addEventListener("abort", stopOnAbort, { once: true });

  try {
    const maxAttempts = 2;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      if (signal.aborted) {
        diagnostic.reason = "Stopped — enough verified comps or timeout";
        break;
      }
      diagnostic.attempts += 1;
      const blocked =
        /challenge|anti-bot|login|consent|cookie|navigation|timeout/i.test(
          firstFailure || ""
        );
      // Google does the heavy lifting: Shopping for retail asks, Google→eBay sold
      // for completed sales. Direct marketplace pages are fallbacks only.
      const preferGoogle =
        site.key === "shopping" ||
        site.key === "ebay" ||
        (site.key === "facebook" && attempt === 0) ||
        attempt === maxAttempts - 1 ||
        (attempt === 1 && blocked);
      const query = attempt === 0 ? shopQuery : alternate || shopQuery;
      let url: string;
      let viaGoogle = false;
      if (site.key === "shopping") {
        url = googleShoppingUrl(query);
        viaGoogle = true;
      } else if (site.key === "ebay" && attempt === 0) {
        url = googleEbaySoldUrl(query);
        viaGoogle = true;
      } else if (preferGoogle) {
        url = googleSearchUrl(site, query);
        viaGoogle = true;
      } else {
        url = site.url(query);
      }
      diagnostic.search_url = url;
      try {
        await page.goto(url, {
          waitUntil: "domcontentloaded",
          timeout: 12_000,
        });
        if (viaGoogle && site.key !== "shopping") {
          await page
            .waitForSelector("div.MjjYud, div.g, .tF2Cxc", { timeout: 6500 })
            .catch(() => null);
        } else {
          await waitForEvidence(page, site);
        }
        const dismissedConsent = viaGoogle
          ? false
          : await clearConsent(page, site);
        await page
          .waitForLoadState("domcontentloaded", { timeout: 3000 })
          .catch(() => undefined);
        if (site.key === "shopping") {
          await page
            .waitForFunction(
              () => /\$\s*\d/.test(document.body?.innerText || ""),
              null,
              { timeout: 6000 }
            )
            .catch(() => undefined);
        }
        await settleListings(page);
        const state = await pageState(page);
        const pageFailure = failureFromPage(state.body, state.title);
        const found = viaGoogle
          ? site.key === "shopping"
            ? await extractSiteListings(page, site)
            : await extractSearchResults(page, site)
          : await extractSiteListings(page, site);
        if (found.length > 0) {
          diagnostic.successful = true;
          diagnostic.found = found.length;
          diagnostic.reason = null;
          return { comps: found, diagnostic };
        }
        firstFailure =
          pageFailure &&
          !(dismissedConsent && pageFailure === "Cookie consent blocked results")
            ? pageFailure
            : page.url() === "about:blank"
              ? "Navigation did not complete"
              : "No URL-backed listing cards extracted";
        diagnostic.reason = firstFailure;
      } catch (error) {
        firstFailure =
          error instanceof Error && /timeout/i.test(error.message)
            ? "Navigation or extraction timeout"
            : `Navigation failed: ${error instanceof Error ? error.message.slice(0, 140) : "unknown error"}`;
        diagnostic.reason = firstFailure;
      }
    }
    return { comps: [], diagnostic };
  } finally {
    signal.removeEventListener("abort", stopOnAbort);
    await page.close().catch(() => undefined);
  }
}

export async function searchComps(
  attributes: ItemAttributes,
  progress?: {
    onSession?: (url: string | null) => Promise<void> | void;
    onSource?: (name: string, found: number, reason?: string | null) => Promise<void> | void;
  }
): Promise<CompData> {
  const queries = buildCompQueries(attributes);
  const apiKey = process.env.BROWSERBASE_API_KEY;

  if (!apiKey) {
    return unavailableComps(queries.primary, "Browserbase is not configured.", {
      attempted_sources: SITES.map((site) => site.name),
      diagnostics: SITES.map((site) => ({
        source: site.name,
        attempted: false,
        successful: false,
        attempts: 0,
        found: 0,
        reason: "Browserbase is not configured",
      })),
    });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 70_000);
  try {
    const tokens = relevanceTokens(attributes);
    // Google Shopping + Google→eBay sold do the heavy lifting from vision's query.
    return await scrapeMarkets(
      queries,
      tokens.any,
      tokens.all,
      controller.signal,
      progress
    );
  } catch (error) {
    return unavailableComps(
      queries.primary,
      `Marketplace search failed: ${error instanceof Error ? error.message : "unknown error"}`,
      { attempted_sources: SITES.map((site) => site.name) }
    );
  } finally {
    clearTimeout(timer);
  }
}

async function scrapeMarkets(
  queries: { primary: string; alternate: string; google: string },
  requiredAny: string[],
  requiredAll: string[],
  signal: AbortSignal,
  progress?: {
    onSession?: (url: string | null) => Promise<void> | void;
    onSource?: (name: string, found: number, reason?: string | null) => Promise<void> | void;
  }
): Promise<CompData> {
  let browser: Browser | null = null;
  let sessionId: string | null = null;
  let sessionUrl: string | null = null;
  // Wave 1: Google Shopping + Google→eBay sold. Wave 2 only if still short.
  const coreKeys = new Set<SiteKey>(["shopping", "ebay"]);
  const coreSites = SITES.filter((site) => coreKeys.has(site.key));
  const extraSites = SITES.filter((site) => !coreKeys.has(site.key));

    async function runWave(sites: Site[]): Promise<SourceResult[]> {
    const earlyStop = new AbortController();
    const sourceSignal = AbortSignal.any([signal, earlyStop.signal]);
    const partial: Array<SourceResult | undefined> = Array.from({
      length: sites.length,
    });
    const verifiedSoFar = () =>
      verifySourceComps(
        [
          ...waveResults.flatMap((result) => result.comps),
          ...partial.flatMap((result) => result?.comps || []),
        ],
        queries.google || queries.primary,
        requiredAny,
        requiredAll
      );

    const settled = await Promise.allSettled(
      sites.map((site, index) =>
        trySource(
          context!,
          site,
          queries.primary,
          queries.alternate,
          sourceSignal,
          queries.google
        ).then(async (result) => {
          partial[index] = result;
          await progress?.onSource?.(
            site.name,
            result.comps.length,
            result.diagnostic.reason
          );
          if (enoughVerifiedComps(verifiedSoFar())) {
            earlyStop.abort();
          }
          return result;
        })
      )
    );
    return settled.map((result, index) =>
      result.status === "fulfilled"
        ? result.value
        : {
            comps: [],
            diagnostic: {
              source: sites[index].name,
              attempted: true,
              successful: false,
              attempts: 1,
              found: 0,
              reason: `Source task failed: ${
                result.reason instanceof Error
                  ? result.reason.message.slice(0, 140)
                  : "unknown error"
              }`,
            },
          }
    );
  }

  let context: BrowserContext | null = null;
  let waveResults: SourceResult[] = [];

  try {
    const { createBrowserbaseSession } = await import("../marketplace/browserbase");
    const session = await withAbort(createBrowserbaseSession(), signal);
    sessionId = session.id;
    sessionUrl = `https://browserbase.com/sessions/${session.id}`;
    await progress?.onSession?.(sessionUrl);
    browser = await withAbort(
      chromium.connectOverCDP(session.connectUrl, { timeout: 15_000 }),
      signal
    );
    context = browser.contexts()[0] || (await browser.newContext());
    const starter = context.pages()[0];
    if (starter) await starter.close().catch(() => undefined);

    waveResults = await runWave(coreSites);
    if (
      extraSites.length &&
      !enoughVerifiedComps(
        verifySourceComps(
          waveResults.flatMap((result) => result.comps),
          queries.google || queries.primary,
          requiredAny,
          requiredAll
        )
      )
    ) {
      waveResults = [...waveResults, ...(await runWave(extraSites))];
    } else if (extraSites.length) {
      waveResults = [
        ...waveResults,
        ...extraSites.map((site) => ({
          comps: [] as CompListing[],
          diagnostic: {
            source: site.name,
            attempted: false,
            successful: false,
            attempts: 0,
            found: 0,
            reason: "Skipped — Google Shopping / eBay sold comps already locked a price",
          } satisfies CompSourceDiagnostic,
        })),
      ];
    }

    const results = waveResults;
    const diagnostics = results.map((result) => result.diagnostic);
    const verified = verifySourceComps(
      results.flatMap((result) => result.comps),
      queries.google || queries.primary,
      requiredAny,
      requiredAll
    );
    for (const diagnostic of diagnostics) {
      const rawCount = diagnostic.found;
      const verifiedCount = verified.filter(
        (comp) => comp.source === diagnostic.source
      ).length;
      diagnostic.found = verifiedCount;
      diagnostic.successful = verifiedCount > 0;
      if (rawCount > 0 && verifiedCount === 0) {
        diagnostic.reason = `${rawCount} candidates extracted, but none passed relevance and price checks`;
      }
    }
    const successfulSources = [
      ...new Set(verified.map((comp) => comp.source)),
    ];
    const attempted = results
      .filter((result) => result.diagnostic.attempted)
      .map((result) => result.diagnostic.source);

    if (verified.length < 3) {
      const details = diagnostics
        .filter((diagnostic) => !diagnostic.successful && diagnostic.attempted)
        .map((diagnostic) => `${diagnostic.source}: ${diagnostic.reason}`)
        .join("; ");
      const reason = `Only ${verified.length} trustworthy comparable${
          verified.length === 1 ? "" : "s"
        } found; at least 3 are required.${details ? ` ${details}` : ""}`;
      const partial = summarize(verified, {
        source: "Insufficient verified marketplace evidence",
        sources: successfulSources,
        query: queries.google || queries.primary,
        mocked: false,
        confidence: "none",
        failure_reason: reason,
        session_url: sessionUrl,
        attempted_sources: attempted.length ? attempted : SITES.map((site) => site.name),
        successful_sources: successfulSources,
        diagnostics,
        pricing_basis: "none",
      });
      return {
        ...partial,
        min: null,
        max: null,
        median: null,
        pricing_basis: "none",
      };
    }

    const selected = verified
      .sort((a, b) => Number(b.sold) - Number(a.sold))
      .slice(0, 24);
    const soldCount = selected.filter((comp) => comp.sold).length;
    const sourceCount = new Set(selected.map((comp) => comp.source)).size;
    const confidence: CompData["confidence"] =
      soldCount >= 3 && selected.length >= 5
        ? "high"
        : soldCount >= 1 || sourceCount >= 2
          ? "medium"
          : "low";

    return summarize(selected, {
      source: `Google comps: ${successfulSources.join(", ")}`,
      sources: successfulSources,
      query: queries.google || queries.primary,
      mocked: false,
      confidence,
      failure_reason: null,
      session_url: sessionUrl,
      attempted_sources: attempted.length ? attempted : SITES.map((site) => site.name),
      successful_sources: successfulSources,
      diagnostics,
    });
  } finally {
    if (browser) await browser.close().catch(() => undefined);
    if (sessionId) {
      try {
        const { releaseSession } = await import("../marketplace/browserbase");
        await releaseSession(sessionId);
      } catch {
        /* session may already be gone */
      }
    }
  }
}
