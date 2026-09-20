import assert from "node:assert/strict";
import test from "node:test";
import { isRemoteMinutesError } from "../src/lib/marketplace/rate-limit.ts";

test("treats Browserbase minute limits as spent", () => {
  assert.equal(
    isRemoteMinutesError(
      new Error("402 Free plan browser minutes limit reached. Please upgrade your account")
    ),
    true
  );
  assert.equal(isRemoteMinutesError(new Error("Navigation timeout")), false);
});
