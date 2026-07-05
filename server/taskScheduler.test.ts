import assert from "node:assert/strict";
import test from "node:test";

import {
  canStartTaskInWorkerPool,
  incrementWorkerPool,
  isRootActiveInWorkerPool,
  workerPoolLimits,
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

test("AT repair worker limit uses the configured normal task concurrency", () => {
  assert.deepEqual(workerPoolLimits({taskConcurrency: 5}), {
    mainLimit: 5,
    atRepairLimit: 5,
  });
  assert.deepEqual(workerPoolLimits({taskConcurrency: 0}), {
    mainLimit: 1,
    atRepairLimit: 1,
  });
});

test("root locks are separated between normal and AT repair worker pools", () => {
  assert.equal(isRootActiveInWorkerPool({
    taskKind: "at-repair",
    root: "root@gmail.com",
    activeMainRoots: new Set(["root@gmail.com"]),
    activeAtRepairRoots: new Set(),
  }), false);

  assert.equal(isRootActiveInWorkerPool({
    taskKind: "at-repair",
    root: "root@gmail.com",
    activeMainRoots: new Set(),
    activeAtRepairRoots: new Set(["root@gmail.com"]),
  }), true);

  assert.equal(isRootActiveInWorkerPool({
    taskKind: "k12",
    root: "root@gmail.com",
    activeMainRoots: new Set(["root@gmail.com"]),
    activeAtRepairRoots: new Set(),
  }), true);
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
