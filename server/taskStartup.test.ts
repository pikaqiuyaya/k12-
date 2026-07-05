import assert from "node:assert/strict";
import {test} from "node:test";

import {buildTasksByEmailId, shouldHydrateAccessTokensFromTokenOut} from "./taskStartup";

test("skips tokenOut hydration when no task can use a saved token", () => {
  assert.equal(shouldHydrateAccessTokensFromTokenOut([
    {id: "with-token", emailId: "a", accessToken: "at", accessTokenHash: "h"},
    {id: "no-preview", emailId: "b"},
  ]), false);

  assert.equal(shouldHydrateAccessTokensFromTokenOut([
    {id: "missing-token", emailId: "a", accessTokenHash: "hash-only"},
  ]), true);
});

test("indexes tasks by email id with newest tasks first", () => {
  const tasks = [
    {id: "old", emailId: "a", createdAt: "2026-01-01T00:00:00.000Z"},
    {id: "new", emailId: "a", updatedAt: "2026-01-02T00:00:00.000Z"},
    {id: "other", emailId: "b", createdAt: "2026-01-03T00:00:00.000Z"},
  ];

  const grouped = buildTasksByEmailId(tasks);

  assert.deepEqual(grouped.get("a")?.map((item) => item.id), ["new", "old"]);
  assert.deepEqual(grouped.get("b")?.map((item) => item.id), ["other"]);
});
