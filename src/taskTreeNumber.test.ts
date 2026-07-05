import assert from "node:assert/strict";
import {test} from "node:test";

import {taskDetailNumber, taskRootNumber, taskWorkspaceNumber} from "./taskTreeNumber";

test("formats task tree numbers from page and row indexes", () => {
  assert.equal(taskRootNumber(0, 0), "#1");
  assert.equal(taskRootNumber(20, 2), "#23");
  assert.equal(taskWorkspaceNumber(0, 0, 0), "#1.1");
  assert.equal(taskWorkspaceNumber(20, 2, 1), "#23.2");
  assert.equal(taskDetailNumber(20, 2, 1, 4), "#23.2.5");
});

test("falls back to the first visible item for invalid task tree indexes", () => {
  assert.equal(taskRootNumber(Number.NaN, -1), "#1");
  assert.equal(taskWorkspaceNumber(Number.NaN, -1, Number.NaN), "#1.1");
  assert.equal(taskDetailNumber(Number.NaN, -1, Number.NaN, -3), "#1.1.1");
});
