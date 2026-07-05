import assert from "node:assert/strict";
import {test} from "node:test";

import {
  dynamicSmsLaunchTaskTotal,
  isRunnableMotherEmail,
  launchTaskTotal,
  summarizeLaunchSelection,
  workspaceLaunchMultiplier,
} from "./emailLaunch";

test("allows successful mother emails to launch new workspace tasks", () => {
  assert.equal(isRunnableMotherEmail({status: "success"}), true);
  assert.equal(isRunnableMotherEmail({status: "failed"}), true);
  assert.equal(isRunnableMotherEmail({status: "free"}), true);
  assert.equal(isRunnableMotherEmail({status: "banned"}), true);
});

test("blocks child and running emails from mother task launching", () => {
  assert.equal(isRunnableMotherEmail({status: "success", parentEmail: "mother@gmail.com"}), false);
  assert.equal(isRunnableMotherEmail({status: "running"}), false);
});

test("counts launch tasks as mother count times workspace count", () => {
  assert.equal(workspaceLaunchMultiplier(0), 1);
  assert.equal(workspaceLaunchMultiplier(5), 5);
  assert.equal(launchTaskTotal(2, 5), 10);
});

test("counts launch tasks as one workspace per mother in random-one mode", () => {
  assert.equal(workspaceLaunchMultiplier(5, "random-one"), 1);
  assert.equal(launchTaskTotal(2, 5, "random-one"), 2);
  assert.equal(launchTaskTotal(2, 5, "all"), 10);
});

test("counts dynamic SMSBower launch by requested SMS target instead of workspace multiplier", () => {
  assert.equal(dynamicSmsLaunchTaskTotal(7), 7);
  assert.equal(dynamicSmsLaunchTaskTotal(0), 0);
  assert.equal(dynamicSmsLaunchTaskTotal("7" as unknown as number), 7);
});

test("summarizes selected launch count and skipped emails", () => {
  assert.deepEqual(summarizeLaunchSelection({
    selectedCount: 17,
    runnableMotherCount: 13,
    workspaceCount: 5,
    workspaceLaunchMode: "all",
  }), {
    selectedCount: 17,
    runnableMotherCount: 13,
    workspaceMultiplier: 5,
    taskCount: 65,
    skippedCount: 4,
  });

  assert.deepEqual(summarizeLaunchSelection({
    selectedCount: 17,
    runnableMotherCount: 13,
    workspaceCount: 5,
    workspaceLaunchMode: "random-one",
  }), {
    selectedCount: 17,
    runnableMotherCount: 13,
    workspaceMultiplier: 1,
    taskCount: 13,
    skippedCount: 4,
  });
});
