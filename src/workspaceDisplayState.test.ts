import assert from "node:assert/strict";
import {test} from "node:test";

import {workspaceStateFromRootGroup, workspaceStateFromStatus, workspaceStateFromTask} from "./workspaceDisplayState";

test("does not mirror routine task status in the workspace status column", () => {
  assert.equal(workspaceStateFromStatus("running").kind, "quiet");
  assert.equal(workspaceStateFromStatus("queued").kind, "quiet");
  assert.equal(workspaceStateFromStatus("success").kind, "quiet");
});

test("keeps actionable workspace states visible", () => {
  assert.equal(workspaceStateFromStatus("partial").kind, "partial");
  assert.equal(workspaceStateFromStatus("failed").kind, "todo");
  assert.equal(workspaceStateFromStatus("canceled", "manual stop").title, "manual stop");
});

test("marks OpenAI 400 alias collisions and mailbox OTP delivery timeouts as cooldowns in front status column", () => {
  const accountExists = workspaceStateFromTask("success", "CreateAccount failed: HTTP 400 code=user_already_exists");
  assert.equal(accountExists.kind, "account-exists-cooldown");

  const baselineTimeout = workspaceStateFromTask("failed", "mailbox code timeout: mailbox still returns baseline code");
  assert.equal(baselineTimeout.kind, "mailbox-cooldown");

  const mailboxRequestTimeout = workspaceStateFromTask("failed", "mailbox code timeout: mailbox_url request timeout after 10000ms");
  assert.equal(mailboxRequestTimeout.kind, "mailbox-cooldown");
  assert.equal(mailboxRequestTimeout.title, "mailbox code timeout: mailbox_url request timeout after 10000ms");
});

test("does not promote workspace-specific limit states to the mother root row", () => {
  assert.equal(workspaceStateFromRootGroup("success", "CreateAccount failed: HTTP 400 code=user_already_exists").kind, "quiet");
  assert.equal(workspaceStateFromRootGroup("partial", "403 workspace access denied").kind, "quiet");
});
