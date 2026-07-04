import assert from "node:assert/strict";
import {test} from "node:test";

import {poolFissionCooldownDelayMs} from "./poolFissionCooldown";

test("adds cooldown for ordinary pool fission child tasks", () => {
  assert.equal(poolFissionCooldownDelayMs({
    isChildEmail: true,
    isSmsBowerMail: false,
    nowMs: 1700,
    cooldownMs: 1000,
    lastFinishedAtMs: 1000,
  }), 300);
});

test("does not add cooldown for root, SMSBower, or already cooled tasks", () => {
  assert.equal(poolFissionCooldownDelayMs({
    isChildEmail: false,
    isSmsBowerMail: false,
    nowMs: 1200,
    cooldownMs: 1000,
    lastFinishedAtMs: 1000,
  }), 0);

  assert.equal(poolFissionCooldownDelayMs({
    isChildEmail: true,
    isSmsBowerMail: true,
    nowMs: 1200,
    cooldownMs: 1000,
    lastFinishedAtMs: 1000,
  }), 0);

  assert.equal(poolFissionCooldownDelayMs({
    isChildEmail: true,
    isSmsBowerMail: false,
    nowMs: 2300,
    cooldownMs: 1000,
    lastFinishedAtMs: 1000,
  }), 0);
});
