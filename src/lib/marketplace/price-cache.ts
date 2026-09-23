import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { CompData } from "../types";
import { normalizeGoogleQuery } from "../agents/search-query";

type CacheRow = {
  query: string;
  saved_at: string;
  comps: CompData;
};

const CACHE_PATH = path.join(process.cwd(), "data", "price-cache.json");
const TTL_MS = 7 * 24 * 60 * 60 * 1000;

function load(): Record<string, CacheRow> {
  try {
    if (!existsSync(CACHE_PATH)) return {};
    return JSON.parse(readFileSync(CACHE_PATH, "utf8")) as Record<string, CacheRow>;
  } catch {
    return {};
  }
}

function save(rows: Record<string, CacheRow>) {
  try {
    mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
    writeFileSync(CACHE_PATH, JSON.stringify(rows, null, 2));
  } catch {
    /* best-effort cache */
  }
}

export function priceCacheKey(query: string) {
  return normalizeGoogleQuery(query, []).toLowerCase();
}

/** Return a fresh cached comps pack when Google already priced this query recently. */
export function readPriceCache(query: string): CompData | null {
  const key = priceCacheKey(query);
  if (!key || key === "product") return null;
  const row = load()[key];
  if (!row?.comps?.median) return null;
  const age = Date.now() - Date.parse(row.saved_at);
  if (!Number.isFinite(age) || age > TTL_MS) return null;
  if (row.comps.mocked || row.comps.comps.length < 3) return null;
  return {
    ...row.comps,
    source: `${row.comps.source} (cached)`,
    session_url: null,
  };
}

export function writePriceCache(query: string, comps: CompData) {
  if (comps.mocked || comps.median == null || comps.comps.length < 3) return;
  const key = priceCacheKey(query);
  if (!key || key === "product") return;
  const rows = load();
  rows[key] = {
    query: key,
    saved_at: new Date().toISOString(),
    comps: {
      ...comps,
      session_url: null,
    },
  };
  save(rows);
}
