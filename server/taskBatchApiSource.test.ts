import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";

const source = readFileSync("server/index.ts", "utf8");

test("task batch routes are handled before the generic task-id route", () => {
  const batchesIndex = source.indexOf('pathname === "/api/tasks/batches"');
  const detailIndex = source.indexOf('pathname.match(/^\\/api\\/tasks\\/([^/]+)');
  assert.ok(batchesIndex > 0, "missing /api/tasks/batches route");
  assert.ok(detailIndex > 0, "missing generic task-id route");
  assert.ok(batchesIndex < detailIndex, "batch route must be before generic task-id route");
});

test("task batch detail route exists before the generic task-id route", () => {
  const detailBatchIndex = source.indexOf('pathname.match(/^\\/api\\/tasks\\/batches\\/([^/]+)$/)');
  const taskIdIndex = source.indexOf('pathname.match(/^\\/api\\/tasks\\/([^/]+)');
  assert.ok(detailBatchIndex > 0, "missing /api/tasks/batches/:id route");
  assert.ok(taskIdIndex > 0, "missing generic task-id route");
  assert.ok(detailBatchIndex < taskIdIndex, "batch detail route must be before generic task-id route");
});
