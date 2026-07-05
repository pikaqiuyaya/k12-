import assert from "node:assert/strict";
import {test} from "node:test";

import {
  isTerminalK12AccessDeniedMessage,
  shouldCreateAutoAtRepairTask,
  isAutoAtRepairIssue,
  isK12AccountContext,
  sub2ApiAccountEmailCandidatesFromName,
  sub2ApiK12LivenessIssue,
  sub2ApiK12StatusErrorReason,
  sub2ApiAccountNameMatchesGroupScope,
  sub2ApiResumeSchedulingBody,
  sub2ApiResumeSchedulingRequests,
  workspaceIdsForAtRepairTask,
  workspaceIdsFromSub2ApiAccountName,
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

test("matches Sub2API account names by group scope when group list is unavailable", () => {
  assert.equal(
    sub2ApiAccountNameMatchesGroupScope("ngray56753275+iyffbf@gmail.com---GPTFREE", "GPTFREE"),
    true,
  );
  assert.equal(
    sub2ApiAccountNameMatchesGroupScope("ngray56753275+iyffbf@gmail.com---低价区", "GPTFREE"),
    false,
  );
  assert.equal(
    sub2ApiAccountNameMatchesGroupScope(
      "ngray56753275+iyffbf@gmail.com--noRT--ws-ff598c4d-ccaf-40c1-bfaa-cb94565764b1",
      "GPTFREE",
    ),
    true,
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
  }), true);

  assert.equal(shouldCreateAutoAtRepairTask({
    issue: "sub2api-k12-status-error",
    matchedLocalEmail: true,
    emailStatus: "running",
    hasActiveTask: true,
  }), false);
});

test("extracts workspace suffix from Sub2API account name even after config removal", () => {
  assert.deepEqual(
    workspaceIdsFromSub2ApiAccountName("martinezkenneth8507422003@gmail.com--noRT--ws-444437a7-c08b-423e-a2c8-65c17383ba24"),
    ["444437a7-c08b-423e-a2c8-65c17383ba24"],
  );
  assert.deepEqual(workspaceIdsFromSub2ApiAccountName("plain@gmail.com--noRT"), []);
});

test("AT repair task workspace is narrowed by Sub2API account suffix", () => {
  assert.deepEqual(
    workspaceIdsForAtRepairTask({
      sub2apiAccount: "martinezkenneth8507422003@gmail.com--noRT--ws-444437a7-c08b-423e-a2c8-65c17383ba24",
      workspaceIds: [
        "ff598c4d-ccaf-40c1-bfaa-cb94565764b1",
        "444437a7-c08b-423e-a2c8-65c17383ba24",
        "696cc59b-a475-44b0-b206-4e03593e658f",
      ],
    }),
    ["444437a7-c08b-423e-a2c8-65c17383ba24"],
  );

  assert.deepEqual(
    workspaceIdsForAtRepairTask({
      sub2apiAccount: "plain@gmail.com--noRT",
      workspaceIds: ["ff598c4d-ccaf-40c1-bfaa-cb94565764b1"],
    }),
    ["ff598c4d-ccaf-40c1-bfaa-cb94565764b1"],
  );
});

test("auto AT repair skips terminal OpenAI workspace access denied errors", () => {
  const message = 'Sub2API test failed: API returned 403: {"detail":{"message":"Unauthorized: Contact your ChatGPT workspace administrator for access.","code":"codex_workspace_access_denied"}}';

  assert.equal(isTerminalK12AccessDeniedMessage(message), true);
  assert.match(sub2ApiK12StatusErrorReason({
    planType: "k12",
    status: "temporary_cooldown",
    errorMessage: message,
    workspaceIds,
  }) || "", /codex_workspace_access_denied|workspace administrator/);
  assert.equal(shouldCreateAutoAtRepairTask({
    issue: "sub2api-k12-status-error",
    matchedLocalEmail: true,
    emailStatus: "success",
    hasActiveTask: false,
    message,
  }), false);
});

test("Sub2API liveness workspace 403 becomes terminal K12 sync issue", () => {
  const issue = sub2ApiK12LivenessIssue({
    planMismatch: undefined,
    liveness: {
      ok: false,
      status: 403,
      message: 'Sub2API 测活失败: Access forbidden (403): {"message":"Unauthorized: Contact your ChatGPT workspace administrator for access.","code":"codex_workspace_access_denied"}',
      latencyMs: 800,
      banned: true,
    },
  });

  assert.equal(issue?.issue, "sub2api-k12-status-error");
  assert.equal(issue?.repairable, false);
  assert.match(issue?.message || "", /codex_workspace_access_denied|workspace administrator/);

  assert.equal(sub2ApiK12LivenessIssue({
    planMismatch: "plan=free",
    liveness: {
      ok: false,
      status: 403,
      message: 'codex_workspace_access_denied',
      latencyMs: 800,
      banned: true,
    },
  }), null);
});

test("Sub2API liveness token revoked 401 becomes repairable AT issue", () => {
  const issue = sub2ApiK12LivenessIssue({
    planMismatch: undefined,
    liveness: {
      ok: false,
      status: 401,
      message: "Sub2API test failed: Token revoked (401): Encountered invalidated oauth token for user",
      latencyMs: 500,
    },
  });

  assert.equal(issue?.issue, "sub2api-k12-status-error");
  assert.equal(issue?.repairable, true);
  assert.match(issue?.message || "", /Token revoked|401|AT/i);

  assert.equal(shouldCreateAutoAtRepairTask({
    issue: issue?.issue,
    repairable: issue?.repairable,
    matchedLocalEmail: true,
    emailStatus: "success",
    hasActiveTask: false,
    message: issue?.message,
  }), true);
});

test("resume scheduling body clears common paused and disabled flags", () => {
  assert.deepEqual(sub2ApiResumeSchedulingBody(), {
    status: "active",
    enabled: true,
    active: true,
    disabled: false,
    paused: false,
    is_disabled: false,
    is_paused: false,
  });
});

test("resume scheduling requests clear temporary and manual scheduling blocks", () => {
  assert.deepEqual(sub2ApiResumeSchedulingRequests("25340"), [
    {
      method: "DELETE",
      path: "/api/v1/admin/accounts/25340/temp-unschedulable",
    },
    {
      method: "POST",
      path: "/api/v1/admin/accounts/25340/schedulable",
      body: {schedulable: true},
    },
    {
      method: "PUT",
      path: "/api/v1/admin/accounts/25340",
      body: sub2ApiResumeSchedulingBody(),
    },
  ]);
});
