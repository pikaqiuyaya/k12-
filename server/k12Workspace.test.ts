import assert from "node:assert/strict";
import {test} from "node:test";

import {
  authWorkspaceSelectionCandidates,
  isUnavailableWorkspaceSelectError,
  isRecoverableWorkspaceSwitchAuthStep,
  isRecoverableWorkspaceSelectError,
  isSameDomainWorkspaceError,
  mergeWorkspaceFallbackIds,
  classifyK12WorkspaceProbeResult,
  removeWorkspaceId,
  shouldRemoveWorkspaceAfterProbe,
  shouldRetryK12Invite,
} from "./k12Workspace";

test("detects same-domain workspace restriction responses", () => {
  assert.equal(
    isSameDomainWorkspaceError(401, '{"detail":"Only users with emails on the same domain can request access to a workspace"}'),
    true,
  );
  assert.equal(isSameDomainWorkspaceError(403, "forbidden"), false);
});

test("does not retry workspace request when the workspace rejects cross-domain email", () => {
  assert.equal(
    shouldRetryK12Invite(1, 3, 401, '{"detail":"Only users with emails on the same domain can request access to a workspace"}'),
    false,
  );
});

test("does not retry workspace request when the workspace id is invalid", () => {
  assert.equal(shouldRetryK12Invite(1, 3, 401, '{"code":"invalid_workspace_selected"}'), false);
});

test("classifies live workspace probe results without using local task history", () => {
  assert.equal(classifyK12WorkspaceProbeResult({ok: true, status: 200, body: ""}), "usable");
  assert.equal(
    classifyK12WorkspaceProbeResult({
      ok: false,
      status: 401,
      body: '{"detail":"Only users with emails on the same domain can request access to a workspace"}',
    }),
    "exists",
  );
  assert.equal(
    classifyK12WorkspaceProbeResult({
      ok: false,
      status: 401,
      body: '{"error":{"code":"invalid_workspace_selected"}}',
    }),
    "invalid",
  );
  assert.equal(
    classifyK12WorkspaceProbeResult({
      ok: false,
      status: 400,
      body: '{"error":{"code":"no_valid_workspaces"}}',
    }),
    "invalid",
  );
  assert.equal(
    classifyK12WorkspaceProbeResult({
      ok: false,
      status: 403,
      body: '{"message":"Unauthorized: Contact your ChatGPT workspace administrator for access.","code":"codex_workspace_access_denied"}',
    }),
    "account-denied",
  );
  assert.equal(classifyK12WorkspaceProbeResult({ok: false, status: 429, body: "rate limit exceeded"}), "rate-limited");
});

test("removes only workspace ids proven invalid by a live probe", () => {
  assert.equal(shouldRemoveWorkspaceAfterProbe("invalid"), true);
  assert.equal(shouldRemoveWorkspaceAfterProbe("exists"), false);
  assert.equal(shouldRemoveWorkspaceAfterProbe("account-denied"), false);
  assert.equal(shouldRemoveWorkspaceAfterProbe("usable"), false);
  assert.equal(shouldRemoveWorkspaceAfterProbe("unknown"), false);
});

test("noRT fallback tries task workspace first, then remaining configured workspaces", () => {
  assert.deepEqual(
    mergeWorkspaceFallbackIds(
      ["631e1603-06cf-4f0b-b79b-d09fbfcfe98d"],
      [
        "631e1603-06cf-4f0b-b79b-d09fbfcfe98d",
        "ff598c4d-ccaf-40c1-bfaa-cb94565764b1",
        "83bec9de-395a-44e6-9a30-189508c22b99",
      ],
    ),
    [
      "631e1603-06cf-4f0b-b79b-d09fbfcfe98d",
      "ff598c4d-ccaf-40c1-bfaa-cb94565764b1",
      "83bec9de-395a-44e6-9a30-189508c22b99",
    ],
  );
});

test("workspace switch can recover from email verification auth step", () => {
  assert.equal(isRecoverableWorkspaceSwitchAuthStep("https://auth.openai.com/email-verification"), true);
  assert.equal(isRecoverableWorkspaceSwitchAuthStep("https://auth.openai.com/about-you"), true);
  assert.equal(isRecoverableWorkspaceSwitchAuthStep("https://auth.openai.com/add-phone"), false);
});

test("auth workspace selection uses actual session workspace ids before literal fallbacks", () => {
  assert.deepEqual(
    authWorkspaceSelectionCandidates(
      [{workspaces: [{id: "personal-account-id", kind: "personal"}]}],
      ["83bec9de-395a-44e6-9a30-189508c22b99"],
    ),
    ["personal-account-id"],
  );
});

test("auth workspace selection prefers configured K12 only when it is available in the auth session", () => {
  assert.deepEqual(
    authWorkspaceSelectionCandidates(
      [{workspaces: [
        {id: "personal-account-id", kind: "personal"},
        {id: "83bec9de-395a-44e6-9a30-189508c22b99", kind: "workspace"},
      ]}],
      ["83bec9de-395a-44e6-9a30-189508c22b99"],
    ),
    ["83bec9de-395a-44e6-9a30-189508c22b99", "personal-account-id"],
  );
});

test("no valid workspaces from workspace select is recoverable by refreshing auth session", () => {
  assert.equal(isRecoverableWorkspaceSelectError('{"code":"no_valid_workspaces"}'), true);
  assert.equal(isRecoverableWorkspaceSelectError("invalid_state"), true);
  assert.equal(isRecoverableWorkspaceSelectError("invalid_workspace_selected"), false);
});

test("detects workspace select errors that invalidate a configured workspace id", () => {
  assert.equal(isUnavailableWorkspaceSelectError(401, '{"code":"invalid_workspace_selected"}'), true);
  assert.equal(isUnavailableWorkspaceSelectError(400, '{"code":"no_valid_workspaces"}'), true);
  assert.equal(isUnavailableWorkspaceSelectError(401, '{"code":"invalid_state"}'), false);
  assert.equal(isUnavailableWorkspaceSelectError(0, "network timeout"), false);
});

test("removes unavailable workspace ids case-insensitively while preserving the rest", () => {
  assert.deepEqual(removeWorkspaceId(["A", "b", "C"], "B"), ["A", "C"]);
  assert.deepEqual(removeWorkspaceId(["A", "C"], "missing"), ["A", "C"]);
});
