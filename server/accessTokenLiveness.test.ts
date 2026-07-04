import assert from "node:assert/strict";
import {test} from "node:test";

import {
  combineDirectAndSub2Liveness,
  k12PlanMismatchReason,
  shouldTrySub2LivenessAfterDirectFailure,
} from "./accessTokenLiveness";

test("tries Sub2API liveness when direct AT check returns auth failure", () => {
  assert.equal(shouldTrySub2LivenessAfterDirectFailure({
    ok: false,
    status: 401,
    message: "AT 失效/不可用: HTTP 401",
    latencyMs: 120,
  }), true);

  assert.equal(shouldTrySub2LivenessAfterDirectFailure({
    ok: false,
    status: 403,
    message: "AT 失效/不可用: HTTP 403",
    latencyMs: 120,
  }), true);
});

test("does not hide banned direct AT results behind Sub2API fallback", () => {
  assert.equal(shouldTrySub2LivenessAfterDirectFailure({
    ok: false,
    status: 401,
    message: "account deactivated",
    latencyMs: 120,
    banned: true,
  }), false);
});

test("trusts Sub2API liveness when direct AT auth check failed but Sub2API test passes", () => {
  const result = combineDirectAndSub2Liveness(
    {ok: false, status: 401, message: "AT 失效/不可用: HTTP 401", latencyMs: 120},
    {ok: true, status: 200, message: "Sub2API 测活通过 / 900ms", latencyMs: 900},
  );

  assert.equal(result.ok, true);
  assert.equal(result.status, 200);
  assert.match(result.message, /Sub2API 测活通过/);
  assert.match(result.message, /直接 AT 返回 401/);
  assert.equal(result.latencyMs, 1020);
});

test("keeps failure when both direct AT and Sub2API checks fail", () => {
  const result = combineDirectAndSub2Liveness(
    {ok: false, status: 401, message: "AT 失效/不可用: HTTP 401", latencyMs: 120},
    {ok: false, status: 0, message: "Sub2API 测活失败", latencyMs: 900},
  );

  assert.equal(result.ok, false);
  assert.equal(result.status, 401);
  assert.match(result.message, /AT 失效/);
  assert.match(result.message, /Sub2API 测活失败/);
});

test("detects Sub2API account plans that are not K12", () => {
  assert.equal(k12PlanMismatchReason({
    planType: "free",
    accountId: "7518923d-5e51-4fdf-b7e8-c49a5ef6333f",
    workspaceIds: ["ff598c4d-ccaf-40c1-bfaa-cb94565764b1"],
  }), "Sub2API 账号套餐不是 K12: plan=free account=7518923d-5e51-4fdf-b7e8-c49a5ef6333f");

  assert.equal(k12PlanMismatchReason({
    planType: "k12",
    accountId: "7518923d-5e51-4fdf-b7e8-c49a5ef6333f",
    workspaceIds: ["ff598c4d-ccaf-40c1-bfaa-cb94565764b1"],
  }), undefined);

  assert.equal(k12PlanMismatchReason({
    planType: "free",
    accountId: "ff598c4d-ccaf-40c1-bfaa-cb94565764b1",
    workspaceIds: ["ff598c4d-ccaf-40c1-bfaa-cb94565764b1"],
  }), undefined);
});
