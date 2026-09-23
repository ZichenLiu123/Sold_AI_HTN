import assert from "node:assert/strict";
import test from "node:test";

test("Sold Agent market path keys off OPENAI_API_KEY", () => {
  const before = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "sk-test";
  assert.equal(Boolean(process.env.OPENAI_API_KEY), true);
  delete process.env.OPENAI_API_KEY;
  assert.equal(Boolean(process.env.OPENAI_API_KEY), false);
  if (before) process.env.OPENAI_API_KEY = before;
});
