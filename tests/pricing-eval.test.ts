import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { buildCompQueries } from "../src/lib/agents/browser.ts";
import {
  scoreCase,
  scoreSearchQuery,
  summarizeScores,
  type PricingEvalCase,
} from "../src/lib/agents/pricing-eval.ts";

const fixturePath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "pricing-eval.json"
);
const cases = JSON.parse(readFileSync(fixturePath, "utf8")) as PricingEvalCase[];

test("pricing eval fixtures score vision search_query quality", () => {
  const scores = cases.map((row) => scoreCase(row.attributes, row.expected, row.id));
  const summary = summarizeScores(scores);
  assert.equal(summary.total, cases.length);
  assert.ok(
    summary.pass_rate >= 0.8,
    `pass_rate ${summary.pass_rate} too low: ${JSON.stringify(scores.filter((s) => !s.pass), null, 2)}`
  );
  assert.ok(summary.mean_jaccard >= 0.5, `mean_jaccard ${summary.mean_jaccard}`);
});

test("buildCompQueries.google matches labeled Google prompts", () => {
  const scores = cases.map((row) => {
    const built = buildCompQueries(row.attributes);
    return scoreSearchQuery(built.google, row.expected, row.id);
  });
  const failed = scores.filter((score) => !score.pass);
  assert.equal(
    failed.length,
    0,
    failed.map((score) => `${score.id}: got “${score.predicted}” missing=${score.missing_required}`).join("; ")
  );
});

test("noisy sale fluff is stripped before Google", () => {
  const noisy = cases.find((row) => row.id === "noisy-vision-query");
  assert.ok(noisy);
  const score = scoreCase(noisy!.attributes, noisy!.expected, noisy!.id);
  assert.equal(score.pass, true);
  assert.doesNotMatch(score.predicted, /sale|used|cheap/i);
});
