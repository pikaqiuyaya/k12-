import assert from "node:assert/strict";
import {test} from "node:test";

import {summarizeLaunchBatches} from "./launchBatchSummary";

test("summarizes launch batches before falling back to SMSBower batches", () => {
  const rows = summarizeLaunchBatches([
    {id: "t1", status: "success", launchBatchId: "launch_a", launchBatchTargetTasks: 3, smsBowerBatchId: "sms_old"},
    {id: "t2", status: "failed", launchBatchId: "launch_a", launchBatchTargetTasks: 3},
    {id: "t3", status: "queued", launchBatchId: "launch_a", launchBatchTargetTasks: 3},
    {id: "t4", status: "running", smsBowerBatchId: "sms_b", smsBowerBatchTargetSuccesses: 2},
  ]);

  assert.equal(rows.length, 2);
  const byId = new Map(rows.map((item) => [item.id, item]));
  assert.deepEqual(byId.get("launch_a"), {
    id: "launch_a",
    target: 3,
    total: 3,
    success: 1,
    failed: 1,
    running: 0,
    queued: 1,
    canceled: 0,
  });
  assert.deepEqual(byId.get("sms_b"), {
    id: "sms_b",
    target: 2,
    total: 1,
    success: 0,
    failed: 0,
    running: 1,
    queued: 0,
    canceled: 0,
  });
});
