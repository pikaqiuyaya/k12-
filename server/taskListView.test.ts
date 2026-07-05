import assert from "node:assert/strict";
import {test} from "node:test";

import {selectDefaultVisibleTasks} from "./taskListView";

test("default task list keeps active tasks and trims old canceled history", () => {
  const tasks = [
    {id: "canceled-new", status: "canceled", createdAt: "2026-07-05T10:00:00.000Z"},
    {id: "running-old", status: "running", createdAt: "2026-07-01T10:00:00.000Z"},
    {id: "queued-old", status: "queued", createdAt: "2026-07-01T11:00:00.000Z"},
    {id: "failed-new", status: "failed", createdAt: "2026-07-05T09:00:00.000Z"},
    {id: "success-old", status: "success", createdAt: "2026-07-04T09:00:00.000Z"},
  ];

  const visible = selectDefaultVisibleTasks(tasks, 1);

  assert.deepEqual(visible.map((task) => task.id), ["running-old", "queued-old", "failed-new"]);
});
