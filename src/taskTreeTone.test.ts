import assert from "node:assert/strict";
import {test} from "node:test";

import {taskTreeToneClass, taskWorkspaceToneClass} from "./taskTreeTone";

test("cycles task tree tone classes by root group index", () => {
  assert.equal(taskTreeToneClass(0), "task-tree-tone-0");
  assert.equal(taskTreeToneClass(1), "task-tree-tone-1");
  assert.equal(taskTreeToneClass(2), "task-tree-tone-2");
  assert.equal(taskTreeToneClass(3), "task-tree-tone-0");
  assert.equal(taskTreeToneClass(4), "task-tree-tone-1");
});

test("falls back to the first task tree tone for invalid indexes", () => {
  assert.equal(taskTreeToneClass(-1), "task-tree-tone-0");
  assert.equal(taskTreeToneClass(Number.NaN), "task-tree-tone-0");
});

test("cycles workspace branch tone classes inside a root task tree", () => {
  assert.equal(taskWorkspaceToneClass(0), "task-workspace-tone-0");
  assert.equal(taskWorkspaceToneClass(1), "task-workspace-tone-1");
  assert.equal(taskWorkspaceToneClass(2), "task-workspace-tone-2");
  assert.equal(taskWorkspaceToneClass(3), "task-workspace-tone-3");
  assert.equal(taskWorkspaceToneClass(4), "task-workspace-tone-0");
});

test("falls back to the first workspace branch tone for invalid indexes", () => {
  assert.equal(taskWorkspaceToneClass(-1), "task-workspace-tone-0");
  assert.equal(taskWorkspaceToneClass(Number.NaN), "task-workspace-tone-0");
});
