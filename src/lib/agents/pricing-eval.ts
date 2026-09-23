import { normalizeGoogleQuery } from "./search-query.ts";
import type { ItemAttributes } from "../types.ts";

export type PricingEvalCase = {
  id: string;
  note?: string;
  /** Attributes as if vision already ran (or a mock). */
  attributes: ItemAttributes;
  expected: {
    /** Ideal Google Shopping query. */
    search_query: string;
    /** Tokens that must appear in the normalized Google query. */
    must_include: string[];
    /** Tokens that must not appear. */
    must_exclude?: string[];
    /** Optional sold-median sanity band for later live evals. */
    median_band?: [number, number];
  };
};

export type QueryScore = {
  id: string;
  predicted: string;
  expected: string;
  jaccard: number;
  missing_required: string[];
  forbidden_hits: string[];
  pass: boolean;
};

function tokens(text: string): string[] {
  return [
    ...new Set(
      text
        .toLowerCase()
        .replace(/[^a-z0-9.\s]/g, " ")
        .split(/\s+/)
        .filter((token) => token.length >= 2)
    ),
  ];
}

export function jaccard(a: string, b: string): number {
  const left = new Set(tokens(a));
  const right = new Set(tokens(b));
  if (!left.size && !right.size) return 1;
  let overlap = 0;
  for (const token of left) if (right.has(token)) overlap += 1;
  const union = left.size + right.size - overlap;
  return union ? overlap / union : 0;
}

/** Score a vision/search_query (or buildCompQueries.google) against a labeled case. */
export function scoreSearchQuery(
  predictedRaw: string,
  expected: PricingEvalCase["expected"],
  id: string
): QueryScore {
  const predicted = normalizeGoogleQuery(predictedRaw, []);
  const expectedQuery = normalizeGoogleQuery(expected.search_query, []);
  const predictedTokens = new Set(tokens(predicted));
  const missing_required = expected.must_include
    .map((token) => token.toLowerCase())
    .filter((token) => ![...predictedTokens].some((part) => part.includes(token) || token.includes(part)));
  const forbidden_hits = (expected.must_exclude || [])
    .map((token) => token.toLowerCase())
    .filter((token) => predictedTokens.has(token) || predicted.toLowerCase().includes(token));
  const overlap = jaccard(predicted, expectedQuery);
  const pass =
    missing_required.length === 0 &&
    forbidden_hits.length === 0 &&
    overlap >= 0.45;
  return {
    id,
    predicted,
    expected: expectedQuery,
    jaccard: Math.round(overlap * 1000) / 1000,
    missing_required,
    forbidden_hits,
    pass,
  };
}

export function scoreCase(
  attributes: ItemAttributes,
  expected: PricingEvalCase["expected"],
  id: string
): QueryScore {
  const predicted =
    attributes.search_query ||
    [attributes.brand, attributes.model, attributes.category].filter(Boolean).join(" ");
  return scoreSearchQuery(predicted, expected, id);
}

export function summarizeScores(scores: QueryScore[]) {
  const passed = scores.filter((score) => score.pass).length;
  return {
    total: scores.length,
    passed,
    failed: scores.length - passed,
    pass_rate: scores.length ? passed / scores.length : 0,
    mean_jaccard:
      scores.length === 0
        ? 0
        : Math.round(
            (scores.reduce((sum, score) => sum + score.jaccard, 0) / scores.length) * 1000
          ) / 1000,
  };
}
