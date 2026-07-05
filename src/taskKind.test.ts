import assert from "node:assert/strict";
import {test} from "node:test";

import {isAtRepairTask, isMainK12Task, splitTasksByKind} from "./taskKind";

test("splits at-repair tasks away from main K12 tasks", () => {
  const tasks = [
    {id: "k12-1"},
    {id: "at-1", kind: "at-repair"},
    {id: "k12-2", kind: "k12"},
  ];

  assert.equal(isAtRepairTask(tasks[1]), true);
  assert.equal(isMainK12Task(tasks[0]), true);
  assert.deepEqual(splitTasksByKind(tasks), {
    mainTasks: [tasks[0], tasks[2]],
    atRepairTasks: [tasks[1]],
  });
});
