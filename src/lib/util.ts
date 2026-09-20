export function extractJson<T>(text: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = (fenced ? fenced[1] : text).trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1) {
    throw new Error("Model did not return JSON");
  }
  return JSON.parse(raw.slice(start, end + 1)) as T;
}

export function parsePrice(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[^\d.]/g, "");
  if (!cleaned) return null;
  const value = Number.parseFloat(cleaned);
  return Number.isFinite(value) && value > 0 ? Math.round(value) : null;
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return Math.round((sorted[mid - 1] + sorted[mid]) / 2);
  }
  return sorted[mid];
}

export function roundClean(value: number): number {
  if (value >= 200) return Math.round(value / 10) * 10;
  if (value >= 50) return Math.round(value / 5) * 5;
  return Math.round(value);
}

export function itemSize(model: string | null | undefined, extra: string[] = []): string {
  for (const line of [model, ...extra]) {
    const match = String(line || "").match(
      /\b\d+(?:\.\d+)?\s*(?:fl\s*)?(?:ml|oz|l)\b/i
    );
    if (match) return match[0].replace(/\s+/g, " ");
  }
  return "";
}

export function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function filterCitedListings<T extends { url: string }>(
  rows: T[],
  citationUrls: string[]
): T[] {
  const hosts = new Set(citationUrls.map(hostnameOf).filter(Boolean));
  return rows.filter((row) => {
    if (!/^https:\/\//i.test(row.url)) return false;
    if (/example\.com|placeholder/i.test(row.url)) return false;
    // No citations means the model may have invented URLs — drop them.
    if (hosts.size === 0) return false;
    return hosts.has(hostnameOf(row.url));
  });
}
