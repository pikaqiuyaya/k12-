import assert from "node:assert/strict";
import {test} from "node:test";

import {
  atRepairRecentStatusText,
  refillHistoryOutcome,
  refillRecentStatusText,
} from "./refillHistoryView";

test("refill history ok=true with deep failures is shown as warning instead of success", () => {
  assert.deepEqual(refillHistoryOutcome({
    kind: "refill",
    ok: true,
    deepCheckEnabled: true,
    deepFailed: 115,
  }), {text: "有失败", className: "warn"});
});

test("AT repair history with discovered issues is shown as warning instead of success", () => {
  assert.deepEqual(refillHistoryOutcome({
    kind: "at-repair",
    ok: true,
    issueAccounts: 22,
  }), {text: "发现错误", className: "warn"});
});

test("workspace delete history is shown as warning", () => {
  assert.deepEqual(refillHistoryOutcome({
    kind: "workspace-delete",
    ok: true,
  }), {text: "已删除", className: "warn"});
});

test("recent status distinguishes completed scans from clean success", () => {
  assert.equal(refillRecentStatusText("", {kind: "refill", deepFailed: 12}), "检测完成，有失败 12");
  assert.equal(refillRecentStatusText("", {kind: "refill", deepFailed: 0}), "检测完成");
  assert.equal(atRepairRecentStatusText("", {kind: "at-repair", issueAccounts: 3}), "扫描完成，错误 3");
});
