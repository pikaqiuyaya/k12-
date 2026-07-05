import assert from "node:assert/strict";
import test from "node:test";

import {
  canStartTaskInWorkerPool,
  incrementWorkerPool,
  workerPoolForTaskKind,
} from "./taskScheduler";

test("routes AT repair tasks to a separate worker pool", () => {
  assert.equal(workerPoolForTaskKind("at-repair"), "at-repair");
  assert.equal(workerPoolForTaskKind("k12"), "main");
  assert.equal(workerPoolForTaskKind(undefined), "main");
});

test("AT repair worker limit is independent from normal task worker limit", () => {
  assert.equal(canStartTaskInWorkerPool({
    taskKind: "k12",
    activeMainWorkers: 5,
    mainLimit: 5,
    activeAtRepairWorkers: 0,
    atRepairLimit: 1,
  }), false);

  assert.equal(canStartTaskInWorkerPool({
    taskKind: "at-repair",
    activeMainWorkers: 5,
    mainLimit: 5,
    activeAtRepairWorkers: 0,
    atRepairLimit: 1,
  }), true);

  assert.equal(canStartTaskInWorkerPool({
    taskKind: "at-repair",
    activeMainWorkers: 0,
    mainLimit: 5,
    activeAtRepairWorkers: 1,
    atRepairLimit: 1,
  }), false);
});

test("increments only the selected worker pool", () => {
  assert.deepEqual(incrementWorkerPool({
    taskKind: "at-repair",
    activeMainWorkers: 3,
    activeAtRepairWorkers: 0,
  }), {
    activeMainWorkers: 3,
    activeAtRepairWorkers: 1,
  });

  assert.deepEqual(incrementWorkerPool({
    taskKind: "k12",
    activeMainWorkers: 3,
    activeAtRepairWorkers: 1,
  }), {
    activeMainWorkers: 4,
    activeAtRepairWorkers: 1,
  });
});
