import assert from "node:assert/strict";
import {test} from "node:test";

import {mergeTaskDetailWithListTask} from "./taskDetailMerge";

test("keeps detailed logs when a lightweight task list row has no logs", () => {
  const detailed = {
    id: "task-1",
    status: "running",
    logs: [{at: "1", level: "info", message: "started"}],
    accessToken: "secret",
  };
  const listRow = {
    id: "task-1",
    status: "success",
    logs: [],
    accessTokenPreview: "abc...xyz",
  };

  assert.deepEqual(mergeTaskDetailWithListTask(detailed, listRow), {
    id: "task-1",
    status: "success",
    logs: [{at: "1", level: "info", message: "started"}],
    accessToken: "secret",
    accessTokenPreview: "abc...xyz",
  });
});

test("appends list logs without truncating detailed logs", () => {
  const detailed = {
    id: "task-1",
    logs: [
      {at: "1", level: "info", message: "old"},
      {at: "2", level: "info", message: "middle"},
    ],
  };
  const listRow = {
    id: "task-1",
    logs: [
      {at: "2", level: "info", message: "middle"},
      {at: "3", level: "info", message: "new"},
    ],
  };

  assert.deepEqual(mergeTaskDetailWithListTask(detailed, listRow).logs, [
    {at: "1", level: "info", message: "old"},
    {at: "2", level: "info", message: "middle"},
    {at: "3", level: "info", message: "new"},
  ]);
});
