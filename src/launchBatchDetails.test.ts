import assert from "node:assert/strict";
import {test} from "node:test";

import {launchBatchDetailRows} from "./launchBatchDetails";

test("builds detail rows for launch and SMSBower batch ids", () => {
  const result = launchBatchDetailRows([
    {
      id: "queued",
      email: "a@example.com",
      status: "queued",
      launchBatchId: "batch-a",
      workspaceIds: ["ff598c4d-ccaf-40c1-bfaa-cb94565764b1"],
      workspaceResults: [],
      createdAt: "2026-07-05T00:00:00.000Z",
    },
    {
      id: "success",
      email: "b@example.com",
      status: "success",
      smsBowerBatchId: "batch-a",
      workspaceIds: ["6ad7af02-22ca-4982-bdab-c0c142fb17c5"],
      workspaceResults: [{ok: true}],
      updatedAt: "2026-07-05T00:01:00.000Z",
    },
    {
      id: "other",
      email: "c@example.com",
      status: "failed",
      launchBatchId: "batch-b",
      workspaceIds: [],
      workspaceResults: [],
    },
  ], "batch-a");

  assert.equal(result.total, 2);
  assert.equal(result.limited, false);
  assert.deepEqual(result.rows.map((row) => row.id), ["queued", "success"]);
  assert.equal(result.rows[0].workspace, "ff598c4d");
  assert.equal(result.rows[1].k12, "1/1");
});

test("limits large batch detail rows", () => {
  const result = launchBatchDetailRows([
    {id: "a", email: "a@example.com", status: "success", launchBatchId: "batch-a", workspaceIds: [], workspaceResults: []},
    {id: "b", email: "b@example.com", status: "success", launchBatchId: "batch-a", workspaceIds: [], workspaceResults: []},
  ], "batch-a", 1);

  assert.equal(result.total, 2);
  assert.equal(result.limited, true);
  assert.deepEqual(result.rows.map((row) => row.id), ["a"]);
});
