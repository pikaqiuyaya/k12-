import assert from "node:assert/strict";
import {test} from "node:test";

import {
  DEFAULT_POOL_FISSION_CHILD_COOLDOWN_MS,
  DEFAULT_POOL_FISSION_MAILBOX_OTP_COOLDOWN_MS,
  poolFissionCooldownDelayMs,
  poolFissionMailboxOtpCooldownDelayMs,
} from "./poolFissionCooldown";

test("uses 15 seconds as ordinary mailbox fission cooldown", () => {
  assert.equal(DEFAULT_POOL_FISSION_CHILD_COOLDOWN_MS, 15_000);
});

test("uses 5 minutes as ordinary mailbox OTP delivery cooldown", () => {
  assert.equal(DEFAULT_POOL_FISSION_MAILBOX_OTP_COOLDOWN_MS, 300_000);
});

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

test("cooldowns ordinary mailbox fission workspace after OTP delivery timeout", () => {
  assert.equal(poolFissionMailboxOtpCooldownDelayMs({
    isChildEmail: true,
    isSmsBowerMail: false,
    mailboxOtpDeliveryTimeout: true,
    nowMs: 1_120_000,
    finishedAtMs: 1_000_000,
    cooldownMs: 300_000,
  }), 180_000);

  assert.equal(poolFissionMailboxOtpCooldownDelayMs({
    isChildEmail: true,
    isSmsBowerMail: false,
    mailboxOtpDeliveryTimeout: true,
    nowMs: 1_400_000,
    finishedAtMs: 1_000_000,
    cooldownMs: 300_000,
  }), 0);

  assert.equal(poolFissionMailboxOtpCooldownDelayMs({
    isChildEmail: true,
    isSmsBowerMail: true,
    mailboxOtpDeliveryTimeout: true,
    nowMs: 1_120_000,
    finishedAtMs: 1_000_000,
    cooldownMs: 300_000,
  }), 0);
});
