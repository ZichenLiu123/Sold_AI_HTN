const QUERY_NOISE =
  /\b(for sale|used|pre[- ]?owned|like new|good condition|excellent|cheap|best|deal|fs|obo|local pickup|free shipping)\b/gi;

/** Turn vision output into a clean Google Shopping / web query. */
export function normalizeGoogleQuery(
  raw: string | null | undefined,
  fallbackParts: Array<string | null | undefined>
): string {
  const fromVision = String(raw || "")
    .replace(QUERY_NOISE, " ")
    .replace(/[“”"']/g, "")
    .replace(/[^a-zA-Z0-9+.%\-\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (fromVision.split(" ").filter(Boolean).length >= 2) {
    return fromVision.split(" ").slice(0, 8).join(" ");
  }
  const fallback = fallbackParts
    .map((part) => String(part || "").replace(QUERY_NOISE, " ").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  return fallback.split(" ").slice(0, 8).join(" ") || "product";
}
