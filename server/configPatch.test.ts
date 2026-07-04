import assert from "node:assert/strict";
import {test} from "node:test";

import {validateSub2ApiPasswordPatch} from "./configPatch";

test("rejects changed Sub2API password when authentication fails", async () => {
  let calls = 0;

  await assert.rejects(
    validateSub2ApiPasswordPatch({
      currentPassword: "current-good-password",
      nextPassword: "stale-browser-password",
      nextUrl: "https://sub.example.test",
      nextEmail: "admin@example.test",
      authenticate: async () => {
        calls += 1;
        throw new Error("invalid email or password");
      },
    }),
    /Sub2API 密码验证失败/,
  );

  assert.equal(calls, 1);
});

test("keeps saved Sub2API password when password patch is blank", async () => {
  let calls = 0;

  await validateSub2ApiPasswordPatch({
    currentPassword: "current-good-password",
    nextPassword: "",
    nextUrl: "https://sub.example.test",
    nextEmail: "admin@example.test",
    authenticate: async () => {
      calls += 1;
    },
  });

  assert.equal(calls, 0);
});

test("does not revalidate an unchanged Sub2API password", async () => {
  let calls = 0;

  await validateSub2ApiPasswordPatch({
    currentPassword: "current-good-password",
    nextPassword: "current-good-password",
    nextUrl: "https://sub.example.test",
    nextEmail: "admin@example.test",
    authenticate: async () => {
      calls += 1;
    },
  });

  assert.equal(calls, 0);
});
