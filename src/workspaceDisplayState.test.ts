import assert from "node:assert/strict";
import {test} from "node:test";

import {workspaceStateFromRootGroup, workspaceStateFromStatus, workspaceStateFromTask} from "./workspaceDisplayState";

test("does not mirror routine task status in the workspace status column", () => {
  assert.deepEqual(workspaceStateFromStatus("running"), {kind: "quiet", text: "-", title: "无空间异常"});
  assert.deepEqual(workspaceStateFromStatus("queued"), {kind: "quiet", text: "-", title: "无空间异常"});
  assert.deepEqual(workspaceStateFromStatus("success"), {kind: "quiet", text: "-", title: "无空间异常"});
});

test("keeps actionable workspace states visible", () => {
  assert.deepEqual(workspaceStateFromStatus("partial"), {kind: "partial", text: "部分", title: "该空间部分成功"});
  assert.deepEqual(workspaceStateFromStatus("failed"), {kind: "todo", text: "可处理", title: "该空间未被 403 拉黑，可重试或补分裂"});
  assert.deepEqual(workspaceStateFromStatus("canceled", "manual stop"), {kind: "todo", text: "可处理", title: "manual stop"});
});

test("marks OpenAI 400 alias collisions and mailbox OTP delivery timeouts as cooldowns in front status column", () => {
  assert.deepEqual(
    workspaceStateFromTask("success", "CreateAccount 请求失败: HTTP 400 code=user_already_exists"),
    {kind: "account-exists-cooldown", text: "400冷却", title: "CreateAccount 请求失败: HTTP 400 code=user_already_exists"},
  );
  assert.deepEqual(
    workspaceStateFromTask("failed", "mailbox code timeout: mailbox still returns baseline code"),
    {kind: "mailbox-cooldown", text: "收码冷却", title: "mailbox code timeout: mailbox still returns baseline code"},
  );
});

test("does not promote workspace-specific limit states to the mother root row", () => {
  assert.deepEqual(
    workspaceStateFromRootGroup("success", "CreateAccount 请求失败: HTTP 400 code=user_already_exists"),
    {kind: "quiet", text: "-", title: "无空间异常"},
  );
  assert.deepEqual(
    workspaceStateFromRootGroup("partial", "403 workspace access denied"),
    {kind: "quiet", text: "-", title: "无空间异常"},
  );
});
