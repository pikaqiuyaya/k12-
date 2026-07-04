import assert from "node:assert/strict";
import {test} from "node:test";

import {createSub2ApiAdminLoginManager, isSub2ApiLoginRateLimitError} from "./sub2ApiAdminAuth";

const input = {
  origin: "https://sub.example.test",
  email: "admin@example.test",
  password: "secret",
};

test("caches successful Sub2API admin login tokens", async () => {
  let calls = 0;
  let time = 1_000;
  const manager = createSub2ApiAdminLoginManager({
    now: () => time,
    cacheMs: 10_000,
    authenticate: async () => {
      calls += 1;
      return `token-${calls}`;
    },
  });

  assert.equal(await manager.login(input), "token-1");
  assert.equal(await manager.login(input), "token-1");
  assert.equal(calls, 1);

  time += 11_000;
  assert.equal(await manager.login(input), "token-2");
  assert.equal(calls, 2);
});

test("shares concurrent Sub2API admin login attempts", async () => {
  let calls = 0;
  let resolveLogin: (token: string) => void = () => {};
  const manager = createSub2ApiAdminLoginManager({
    authenticate: () => {
      calls += 1;
      return new Promise<string>((resolve) => {
        resolveLogin = resolve;
      });
    },
  });

  const first = manager.login(input);
  const second = manager.login(input);
  resolveLogin("token-shared");

  assert.equal(await first, "token-shared");
  assert.equal(await second, "token-shared");
  assert.equal(calls, 1);
});

test("cools down Sub2API admin login after rate limit", async () => {
  let calls = 0;
  let time = 1_000;
  const manager = createSub2ApiAdminLoginManager({
    now: () => time,
    cooldownMs: 30_000,
    authenticate: async () => {
      calls += 1;
      throw new Error('Sub2API /api/v1/auth/login HTTP 429: {"message":"Too many requests"}');
    },
  });

  await assert.rejects(manager.login(input), /已冷却 30 秒/);
  await assert.rejects(manager.login(input), /冷却中，请 30 秒后重试/);
  assert.equal(calls, 1);

  time += 31_000;
  await assert.rejects(manager.login(input), /已冷却 30 秒/);
  assert.equal(calls, 2);
});

test("detects common Sub2API login rate-limit messages", () => {
  assert.equal(isSub2ApiLoginRateLimitError(new Error("HTTP 429")), true);
  assert.equal(isSub2ApiLoginRateLimitError(new Error("Too many requests, please try again later")), true);
  assert.equal(isSub2ApiLoginRateLimitError(new Error("invalid email or password")), false);
});
