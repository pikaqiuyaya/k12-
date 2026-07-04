import assert from "node:assert/strict";
import {test} from "node:test";

import {
  shouldCreateAutoAtRepairTask,
  isAutoAtRepairIssue,
  isK12AccountContext,
  sub2ApiAccountEmailCandidatesFromName,
  sub2ApiK12StatusErrorReason,
} from "./sub2ApiAccountRepair";

const workspaceIds = ["ff598c4d-ccaf-40c1-bfaa-cb94565764b1"];

test("recognizes K12 account context by plan or workspace account id", () => {
  assert.equal(isK12AccountContext({planType: "k12", workspaceIds}), true);
  assert.equal(isK12AccountContext({planType: "free", accountId: workspaceIds[0], workspaceIds}), true);
  assert.equal(isK12AccountContext({planType: "free", accountId: "personal-account", workspaceIds}), false);
});

test("detects Sub2API error status only for K12 accounts", () => {
  assert.match(sub2ApiK12StatusErrorReason({
    planType: "k12",
    status: "error",
    workspaceIds,
  }) || "", /status=error/);

  assert.equal(sub2ApiK12StatusErrorReason({
    planType: "free",
    status: "error",
    workspaceIds,
  }), undefined);
});

test("detects disabled K12 accounts and ignores normal K12 accounts", () => {
  assert.match(sub2ApiK12StatusErrorReason({
    planType: "k12",
    enabled: false,
    workspaceIds,
  }) || "", /enabled=false/);

  assert.equal(sub2ApiK12StatusErrorReason({
    planType: "k12",
    status: "active",
    enabled: true,
    workspaceIds,
  }), undefined);
});

test("extracts local email candidates from Sub2API account names", () => {
  assert.deepEqual(
    sub2ApiAccountEmailCandidatesFromName("ngray56753275+iyffbf@gmail.com--noRT"),
    ["ngray56753275+iyffbf@gmail.com"],
  );
  assert.deepEqual(
    sub2ApiAccountEmailCandidatesFromName("ngray56753275+iyffbf@gmail.com---GPTFREE"),
    ["ngray56753275+iyffbf@gmail.com"],
  );
});

test("auto AT repair only queues matched idle K12 repair issues", () => {
  assert.equal(isAutoAtRepairIssue("sub2api-k12-status-error"), true);
  assert.equal(isAutoAtRepairIssue("k12-plan-mismatch"), false);

  assert.equal(shouldCreateAutoAtRepairTask({
    issue: "sub2api-k12-status-error",
    matchedLocalEmail: true,
    emailStatus: "success",
    hasActiveTask: false,
  }), true);

  assert.equal(shouldCreateAutoAtRepairTask({
    issue: "k12-plan-mismatch",
    matchedLocalEmail: true,
    emailStatus: "failed",
    hasActiveTask: false,
  }), false);

  assert.equal(shouldCreateAutoAtRepairTask({
    issue: undefined,
    matchedLocalEmail: true,
    emailStatus: "success",
    hasActiveTask: false,
  }), false);

  assert.equal(shouldCreateAutoAtRepairTask({
    issue: "sub2api-k12-status-error",
    matchedLocalEmail: false,
    emailStatus: "success",
    hasActiveTask: false,
  }), false);

  assert.equal(shouldCreateAutoAtRepairTask({
    issue: "sub2api-k12-status-error",
    matchedLocalEmail: true,
    emailStatus: "running",
    hasActiveTask: false,
  }), false);
});
