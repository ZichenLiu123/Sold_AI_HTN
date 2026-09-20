import assert from "node:assert/strict";
import test from "node:test";
import {
  AgentCancelled,
  clearCancel,
  isAgentCancelled,
  isCancelled,
  requestCancel,
  throwIfCancelled,
} from "../src/lib/agents/cancel.ts";

test("throwIfCancelled only fires after requestCancel", () => {
  const id = "listing-stop";
  clearCancel(id);
  assert.equal(isCancelled(id), false);
  throwIfCancelled(id);
  requestCancel(id);
  assert.equal(isCancelled(id), true);
  assert.throws(() => throwIfCancelled(id), AgentCancelled);
  assert.equal(isAgentCancelled(new AgentCancelled()), true);
  clearCancel(id);
  throwIfCancelled(id);
});
