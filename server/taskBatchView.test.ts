import assert from "node:assert/strict";
import {test} from "node:test";

import {batchDetailView, batchSummaryView} from "./taskBatchView";

const tasks = [
  {
    id: "visible-running",
    email: "a@example.com",
    status: "running",
    launchBatchId: "launch_a",
    launchBatchTargetTasks: 3,
    workspaceIds: ["ff598c4d-ccaf-40c1-bfaa-cb94565764b1"],
    workspaceResults: [],
    updatedAt: "2026-07-05T00:03:00.000Z",
  },
  {
    id: "hidden-success",
    email: "b@example.com",
    status: "success",
    launchBatchId: "launch_a",
    launchBatchTargetTasks: 3,
    workspaceIds: ["6ad7af02-22ca-4982-bdab-c0c142fb17c5"],
    workspaceResults: [{ok: true}],
    updatedAt: "2026-07-05T00:02:00.000Z",
  },
  {
    id: "hidden-failed",
    email: "c@example.com",
    status: "failed",
    launchBatchId: "launch_a",
    launchBatchTargetTasks: 3,
    workspaceIds: ["444437a7-c08b-423e-a2c8-65c17383ba24"],
    workspaceResults: [],
    error: "mailbox timeout",
    updatedAt: "2026-07-05T00:01:00.000Z",
  },
];

test("batchSummaryView summarizes all tasks, including rows hidden from the default task list", () => {
  const rows = batchSummaryView(tasks);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], {
    id: "launch_a",
    target: 3,
    total: 3,
    success: 1,
    failed: 1,
    running: 1,
    queued: 0,
    canceled: 0,
  });
});

test("batchDetailView returns full batch details on demand", () => {
  const detail = batchDetailView(tasks, "launch_a", 10);
  assert.equal(detail.total, 3);
  assert.equal(detail.limited, false);
  assert.deepEqual(new Set(detail.rows.map((row) => row.id)), new Set(["visible-running", "hidden-success", "hidden-failed"]));
});
