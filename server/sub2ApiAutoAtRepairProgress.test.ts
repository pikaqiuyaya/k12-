import assert from "node:assert/strict";
import test from "node:test";

import {autoAtRepairProgressMessage, shouldPublishAutoAtRepairProgress} from "./sub2ApiAutoAtRepairProgress";

test("formats running auto AT repair progress with discovered issues", () => {
  assert.equal(
    autoAtRepairProgressMessage({
      processedAccounts: 37,
      totalAccounts: 274,
      issueAccounts: 6,
      createdTasks: 4,
      skippedRunning: 1,
      skippedUnmatched: 1,
      skippedTerminal: 0,
    }),
    "自动补 AT 扫描中 37/274，已发现可补 K12 错误 6 个，已创建修复任务 4 个，跳过已有任务/邮箱不可用 1 个，跳过未匹配邮箱 1 个",
  );
});

test("publishes auto AT repair progress on issues, batches, and completion", () => {
  assert.equal(shouldPublishAutoAtRepairProgress({processedAccounts: 7, totalAccounts: 100, issueChanged: true}), true);
  assert.equal(shouldPublishAutoAtRepairProgress({processedAccounts: 10, totalAccounts: 100, issueChanged: false}), true);
  assert.equal(shouldPublishAutoAtRepairProgress({processedAccounts: 100, totalAccounts: 100, issueChanged: false}), true);
  assert.equal(shouldPublishAutoAtRepairProgress({processedAccounts: 7, totalAccounts: 100, issueChanged: false}), false);
});
