import assert from "node:assert/strict";
import {test} from "node:test";

import {activeTaskIdsOfGroup, buildTaskGroups, buildTaskRootGroups, canTopUpTaskGroupFission, visibleTaskTreeKeys, visibleTasksForWorkspaceIds, type TaskGroupInput} from "./taskGroups";

function task(input: Partial<TaskGroupInput> & Pick<TaskGroupInput, "id" | "email" | "status">): TaskGroupInput {
  return {
    route: "request",
    workspaceIds: [],
    workspaceResults: [],
    ...input,
  };
}

test("groups email-pool fission children under the mother task and counts successful child emails", () => {
  const rows = buildTaskGroups([
    task({id: "root", email: "mother@gmail.com", status: "success", smsBowerFissionRemainingAfterThis: 5}),
    task({id: "c1", email: "mother+one@gmail.com", parentEmail: "mother@gmail.com", status: "success", smsBowerFissionRemainingAfterThis: 4}),
    task({id: "c1-retry", email: "mother+one@gmail.com", parentEmail: "mother@gmail.com", status: "success", smsBowerFissionRemainingAfterThis: 4}),
    task({id: "c2", email: "mother+two@gmail.com", parentEmail: "mother@gmail.com", status: "success", smsBowerFissionRemainingAfterThis: 3}),
    task({id: "c3", email: "mother+three@gmail.com", parentEmail: "mother@gmail.com", status: "failed", smsBowerFissionRemainingAfterThis: 3}),
    task({id: "c3-replacement", email: "mother+four@gmail.com", parentEmail: "mother@gmail.com", status: "success", smsBowerFissionRemainingAfterThis: 2}),
  ]);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].rootEmail, "mother@gmail.com");
  assert.equal(rows[0].source, "pool");
  assert.equal(rows[0].sourceLabel, "邮箱池");
  assert.equal(rows[0].fissionSuccessChildren, 3);
  assert.equal(rows[0].fissionTargetChildren, 5);
  assert.equal(rows[0].detailTasks.length, 5);
});

test("marks an unfinished group with successful children as partial instead of failed", () => {
  const rows = buildTaskGroups([
    task({id: "root", email: "mother@gmail.com", status: "success", smsBowerFissionRemainingAfterThis: 5}),
    task({id: "c1", email: "mother+one@gmail.com", parentEmail: "mother@gmail.com", status: "success", smsBowerFissionRemainingAfterThis: 4}),
    task({id: "c2", email: "mother+two@gmail.com", parentEmail: "mother@gmail.com", status: "success", smsBowerFissionRemainingAfterThis: 3}),
    task({id: "c3", email: "mother+three@gmail.com", parentEmail: "mother@gmail.com", status: "success", smsBowerFissionRemainingAfterThis: 2}),
    task({id: "c4", email: "mother+four@gmail.com", parentEmail: "mother@gmail.com", status: "success", smsBowerFissionRemainingAfterThis: 1}),
    task({id: "failed", email: "mother+five@gmail.com", parentEmail: "mother@gmail.com", status: "failed", smsBowerFissionRemainingAfterThis: 1}),
  ]);

  assert.equal(rows[0].status, "partial");
  assert.equal(rows[0].fissionSuccessChildren, 4);
  assert.equal(rows[0].fissionTargetChildren, 5);
  assert.equal(rows[0].fissionFailedChildren, 1);
});

test("keeps email-pool fission refillable after one user-already-exists child failure", () => {
  const rows = buildTaskGroups([
    task({id: "root", email: "mother@gmail.com", status: "success", smsBowerFissionRemainingAfterThis: 5}),
    task({id: "c1", email: "mother+one@gmail.com", parentEmail: "mother@gmail.com", status: "success", smsBowerFissionRemainingAfterThis: 4}),
    task({id: "c2", email: "mother+two@gmail.com", parentEmail: "mother@gmail.com", status: "success", smsBowerFissionRemainingAfterThis: 3}),
    task({id: "c3", email: "mother+three@gmail.com", parentEmail: "mother@gmail.com", status: "success", smsBowerFissionRemainingAfterThis: 2}),
    task({id: "c4", email: "mother+four@gmail.com", parentEmail: "mother@gmail.com", status: "success", smsBowerFissionRemainingAfterThis: 1}),
    task({id: "f1", email: "mother+five@gmail.com", parentEmail: "mother@gmail.com", status: "failed", smsBowerFissionRemainingAfterThis: 0, error: "CreateAccount failed: user_already_exists"}),
  ], {minimumTargetChildren: 5});

  assert.equal(rows[0].status, "partial");
  assert.equal(rows[0].fissionSuccessChildren, 4);
  assert.equal(rows[0].fissionTargetChildren, 5);
  assert.equal(canTopUpTaskGroupFission(rows[0]), true);
});

test("keeps zero-child email-pool user-already-exists as retryable cooldown state", () => {
  const rows = buildTaskGroups([
    task({id: "root", email: "mother@gmail.com", status: "success", smsBowerFissionRemainingAfterThis: 5}),
    task({id: "f1", email: "mother+one@gmail.com", parentEmail: "mother@gmail.com", status: "failed", smsBowerFissionRemainingAfterThis: 0, error: "CreateAccount failed: user_already_exists"}),
  ], {minimumTargetChildren: 5});

  assert.equal(rows[0].status, "partial");
  assert.equal(rows[0].fissionSuccessChildren, 0);
  assert.equal(rows[0].fissionTargetChildren, 5);
  assert.equal(rows[0].fissionFailedChildren, 0);
  assert.equal(canTopUpTaskGroupFission(rows[0]), true);
});

test("deduplicates child detail rows by email in the same workspace group", () => {
  const rows = buildTaskGroups([
    task({id: "root", email: "mother@gmail.com", status: "success", workspaceIds: ["workspace-a"], smsBowerFissionRemainingAfterThis: 5}),
    task({
      id: "child-wide-old",
      email: "mother+one@gmail.com",
      parentEmail: "mother@gmail.com",
      status: "success",
      workspaceIds: ["workspace-a", "workspace-b", "workspace-c", "workspace-d", "workspace-e"],
      workspaceResults: [{ok: false}, {ok: false}, {ok: false}, {ok: false}, {ok: false}],
      smsBowerFissionRemainingAfterThis: 5,
      createdAt: "2026-01-01T00:00:00.000Z",
    }),
    task({
      id: "child-specific-new",
      email: "mother+one@gmail.com",
      parentEmail: "mother@gmail.com",
      status: "success",
      workspaceIds: ["workspace-a"],
      workspaceResults: [{ok: true}],
      smsBowerFissionRemainingAfterThis: 1,
      createdAt: "2026-01-02T00:00:00.000Z",
    }),
    task({
      id: "child-two",
      email: "mother+two@gmail.com",
      parentEmail: "mother@gmail.com",
      status: "success",
      workspaceIds: ["workspace-a"],
      workspaceResults: [{ok: true}],
      smsBowerFissionRemainingAfterThis: 1,
    }),
  ], {minimumTargetChildren: 5});

  const duplicateRows = rows[0].detailTasks.filter((item) => item.email === "mother+one@gmail.com");
  assert.equal(duplicateRows.length, 1);
  assert.equal(duplicateRows[0].id, "child-specific-new");
  assert.equal(rows[0].fissionSuccessChildren, 2);
});

test("deduplicates mother retry detail rows by root email in the same workspace group", () => {
  const rows = buildTaskGroups([
    task({
      id: "mother-original",
      email: "mother@gmail.com",
      status: "success",
      workspaceIds: ["workspace-a"],
      workspaceResults: [{ok: true}],
      createdAt: "2026-01-01T00:00:00.000Z",
    }),
    task({
      id: "mother-at-repair-old",
      email: "mother@gmail.com",
      status: "success",
      workspaceIds: ["workspace-a", "workspace-b"],
      createdAt: "2026-01-02T00:00:00.000Z",
    }),
    task({
      id: "mother-at-repair-new",
      email: "mother@gmail.com",
      status: "success",
      workspaceIds: ["workspace-a", "workspace-b"],
      createdAt: "2026-01-03T00:00:00.000Z",
    }),
    task({
      id: "child-one",
      email: "mother+one@gmail.com",
      parentEmail: "mother@gmail.com",
      status: "success",
      workspaceIds: ["workspace-a"],
      createdAt: "2026-01-04T00:00:00.000Z",
    }),
    task({
      id: "child-failed",
      email: "mother+two@gmail.com",
      parentEmail: "mother@gmail.com",
      status: "failed",
      workspaceIds: ["workspace-a"],
      createdAt: "2026-01-05T00:00:00.000Z",
    }),
  ]);

  assert.equal(rows.length, 1);
  const motherRows = rows[0].detailTasks.filter((item) => item.email === "mother@gmail.com");
  assert.equal(motherRows.length, 1);
  assert.equal(motherRows[0].id, "mother-at-repair-new");
  assert.deepEqual(rows[0].detailTasks.map((item) => item.id), ["child-failed", "child-one", "mother-at-repair-new"]);
});

test("uses the current configured fission target for historical groups", () => {
  const rows = buildTaskGroups([
    task({id: "root", email: "mother@gmail.com", status: "success", smsBowerFissionRemainingAfterThis: 4}),
    task({id: "c1", email: "mother+one@gmail.com", parentEmail: "mother@gmail.com", status: "success", smsBowerFissionRemainingAfterThis: 3}),
    task({id: "c2", email: "mother+two@gmail.com", parentEmail: "mother@gmail.com", status: "success", smsBowerFissionRemainingAfterThis: 2}),
    task({id: "c3", email: "mother+three@gmail.com", parentEmail: "mother@gmail.com", status: "success", smsBowerFissionRemainingAfterThis: 1}),
    task({id: "c4", email: "mother+four@gmail.com", parentEmail: "mother@gmail.com", status: "success", smsBowerFissionRemainingAfterThis: 0}),
  ], {minimumTargetChildren: 5});

  assert.equal(rows[0].status, "partial");
  assert.equal(rows[0].fissionSuccessChildren, 4);
  assert.equal(rows[0].fissionTargetChildren, 5);
});

test("marks reusable SMSBower fission groups as partial until the requested child target is reached", () => {
  const rows = buildTaskGroups([
    task({
      id: "sms-root",
      email: "smsroot@gmail.com",
      status: "success",
      otpMode: "smsbower-mail",
      smsBowerMailRoot: "smsroot@gmail.com",
      smsBowerFissionRemainingAfterThis: 2,
      smsBowerFissionChildrenRemaining: 1,
    }),
    task({
      id: "sms-child",
      email: "smsroot+aa@gmail.com",
      parentEmail: "smsroot@gmail.com",
      status: "success",
      otpMode: "smsbower-mail",
      smsBowerMailRoot: "smsroot@gmail.com",
      smsBowerFissionRemainingAfterThis: 1,
    }),
  ]);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].source, "sms");
  assert.equal(rows[0].sourceLabel, "SMS");
  assert.equal(rows[0].status, "partial");
  assert.equal(rows[0].fissionSuccessChildren, 1);
  assert.equal(rows[0].fissionTargetChildren, 2);
  assert.equal(rows[0].primaryTask.id, "sms-root");
  assert.equal(canTopUpTaskGroupFission(rows[0]), true);
});

test("treats SMSBower code limit stop as a successful completed group with the achieved child count", () => {
  const rows = buildTaskGroups([
    task({
      id: "sms-root",
      email: "smsroot@gmail.com",
      status: "success",
      otpMode: "smsbower-mail",
      smsBowerMailRoot: "smsroot@gmail.com",
      smsBowerFissionRemainingAfterThis: 5,
      smsBowerFissionChildrenRemaining: 0,
    }),
    task({
      id: "sms-child",
      email: "smsroot+aa@gmail.com",
      parentEmail: "smsroot@gmail.com",
      status: "success",
      otpMode: "smsbower-mail",
      smsBowerMailRoot: "smsroot@gmail.com",
      smsBowerFissionRemainingAfterThis: 4,
    }),
  ], {minimumTargetChildren: 5});

  assert.equal(rows[0].source, "sms");
  assert.equal(rows[0].status, "success");
  assert.equal(rows[0].fissionSuccessChildren, 1);
  assert.equal(rows[0].fissionTargetChildren, 1);
});

test("treats historical SMSBower code limit logs as a completed group even when the mother email record is missing", () => {
  const rows = buildTaskGroups([
    task({
      id: "sms-root",
      email: "smsroot@gmail.com",
      status: "success",
      otpMode: "auto",
      smsBowerFissionRemainingAfterThis: 5,
    }),
    task({
      id: "sms-child",
      email: "smsroot+aa@gmail.com",
      parentEmail: "smsroot@gmail.com",
      status: "success",
      otpMode: "smsbower-mail",
      smsBowerMailRoot: "smsroot@gmail.com",
      smsBowerFissionRemainingAfterThis: 4,
      logs: [
        {
          message: "SMSBower Gmail 裂变子任务创建失败: SMSBower setStatus 失败: Maximum number of codes reached",
        },
      ],
    }),
  ], {minimumTargetChildren: 5});

  assert.equal(rows[0].source, "sms");
  assert.equal(rows[0].status, "success");
  assert.equal(rows[0].fissionSuccessChildren, 1);
  assert.equal(rows[0].fissionTargetChildren, 1);
  assert.equal(canTopUpTaskGroupFission(rows[0]), false);
});

test("allows top-up fission for ordinary mailbox-pool and reusable SMSBower groups", () => {
  const [pool] = buildTaskGroups([
    task({id: "root", email: "mother@gmail.com", status: "success", smsBowerFissionRemainingAfterThis: 5}),
    task({id: "c1", email: "mother+one@gmail.com", parentEmail: "mother@gmail.com", status: "success", smsBowerFissionRemainingAfterThis: 4}),
  ]);

  assert.equal(pool.source, "pool");
  assert.equal(canTopUpTaskGroupFission(pool), true);

  const [sms] = buildTaskGroups([
    task({
      id: "sms-root",
      email: "smsroot@gmail.com",
      status: "success",
      otpMode: "smsbower-mail",
      smsBowerMailRoot: "smsroot@gmail.com",
      smsBowerFissionChildrenRemaining: 1,
    }),
    task({
      id: "sms-c1",
      email: "smsroot+one@gmail.com",
      parentEmail: "smsroot@gmail.com",
      status: "success",
      otpMode: "smsbower-mail",
      smsBowerMailRoot: "smsroot@gmail.com",
    }),
  ]);

  assert.equal(sms.source, "sms");
  assert.equal(canTopUpTaskGroupFission(sms), true);

  const [emailnator] = buildTaskGroups([
    task({id: "root", email: "mail@gmail.com", status: "success", otpMode: "emailnator", smsBowerFissionRemainingAfterThis: 5}),
    task({id: "c1", email: "mail+one@gmail.com", parentEmail: "mail@gmail.com", status: "success", otpMode: "emailnator", smsBowerFissionRemainingAfterThis: 4}),
  ]);

  assert.equal(emailnator.source, "emailnator");
  assert.equal(canTopUpTaskGroupFission(emailnator), false);
});

test("keeps unrelated mother emails as separate top-level rows", () => {
  const rows = buildTaskGroups([
    task({id: "a-root", email: "a@gmail.com", status: "success"}),
    task({id: "a-retry", email: "a@gmail.com", status: "failed"}),
    task({id: "b-root", email: "b@gmail.com", status: "queued"}),
  ]);

  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((row) => row.rootEmail), ["b@gmail.com", "a@gmail.com"]);
  assert.equal(rows[1].detailTasks.length, 1);
});

test("makes a single workspace task expandable by keeping the primary task in details", () => {
  const rows = buildTaskGroups([
    task({id: "root-a", email: "mother@gmail.com", status: "running", workspaceIds: ["workspace-a"]}),
  ]);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].primaryTask.id, "root-a");
  assert.deepEqual(rows[0].detailTasks.map((item) => item.id), ["root-a"]);
});

test("keeps the same mother email in separate task groups for each workspace", () => {
  const rows = buildTaskGroups([
    task({id: "root-a", email: "mother@gmail.com", status: "success", workspaceIds: ["workspace-a"], smsBowerFissionRemainingAfterThis: 2}),
    task({id: "child-a", email: "mother+one@gmail.com", parentEmail: "mother@gmail.com", status: "success", workspaceIds: ["workspace-a"], smsBowerFissionRemainingAfterThis: 1}),
    task({id: "root-b", email: "mother@gmail.com", status: "queued", workspaceIds: ["workspace-b"], smsBowerFissionRemainingAfterThis: 2}),
    task({id: "child-b", email: "mother+two@gmail.com", parentEmail: "mother@gmail.com", status: "queued", workspaceIds: ["workspace-b"], smsBowerFissionRemainingAfterThis: 1}),
  ]);

  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((row) => row.workspaceKey), ["workspace-b", "workspace-a"]);
  assert.deepEqual(rows.map((row) => row.fissionSuccessChildren), [0, 1]);
});

test("nests workspace groups under one mother email root group", () => {
  const rows = buildTaskRootGroups([
    task({id: "root-a", email: "mother@gmail.com", status: "success", workspaceIds: ["workspace-a"], smsBowerFissionRemainingAfterThis: 2}),
    task({id: "child-a", email: "mother+one@gmail.com", parentEmail: "mother@gmail.com", status: "success", workspaceIds: ["workspace-a"], smsBowerFissionRemainingAfterThis: 1}),
    task({id: "root-b", email: "mother@gmail.com", status: "queued", workspaceIds: ["workspace-b"], smsBowerFissionRemainingAfterThis: 2}),
    task({id: "child-b", email: "mother+two@gmail.com", parentEmail: "mother@gmail.com", status: "queued", workspaceIds: ["workspace-b"], smsBowerFissionRemainingAfterThis: 1}),
  ], {minimumTargetChildren: 2});

  assert.equal(rows.length, 1);
  assert.equal(rows[0].rootEmail, "mother@gmail.com");
  assert.equal(rows[0].workspaceGroups.length, 2);
  assert.deepEqual(rows[0].workspaceGroups.map((row) => row.workspaceKey), ["workspace-b", "workspace-a"]);
  assert.deepEqual(rows[0].workspaceGroups.map((row) => row.fissionSuccessChildren), [0, 1]);
  assert.equal(rows[0].fissionSuccessChildren, 1);
  assert.equal(rows[0].fissionTargetChildren, 4);
  assert.equal(rows[0].tasks.length, 4);
});

test("keeps both mother and workspace expansion keys visible after refresh", () => {
  const workspaceGroups = buildTaskGroups([
    task({id: "root-a", email: "mother@gmail.com", status: "success", workspaceIds: ["workspace-a"]}),
    task({id: "root-b", email: "mother@gmail.com", status: "queued", workspaceIds: ["workspace-b"]}),
  ]);
  const rootGroups = buildTaskRootGroups([
    task({id: "root-a", email: "mother@gmail.com", status: "success", workspaceIds: ["workspace-a"]}),
    task({id: "root-b", email: "mother@gmail.com", status: "queued", workspaceIds: ["workspace-b"]}),
  ]);

  assert.deepEqual(
    visibleTaskTreeKeys(workspaceGroups, rootGroups).sort(),
    ["root:mother@gmail.com", "root:mother@gmail.com|workspace:workspace-a", "root:mother@gmail.com|workspace:workspace-b"].sort(),
  );
});

test("finds active task ids across a collapsed mother group", () => {
  const [rootGroup] = buildTaskRootGroups([
    task({id: "running-a", email: "mother@gmail.com", status: "running", workspaceIds: ["workspace-a"]}),
    task({id: "queued-b", email: "mother@gmail.com", status: "queued", workspaceIds: ["workspace-b"]}),
    task({id: "done-c", email: "mother@gmail.com", status: "success", workspaceIds: ["workspace-c"]}),
  ]);

  assert.deepEqual(activeTaskIdsOfGroup(rootGroup), ["running-a", "queued-b"]);
});

test("hides tasks for workspace ids removed from current config", () => {
  const rows = visibleTasksForWorkspaceIds([
    task({id: "kept", email: "a@gmail.com", status: "success", workspaceIds: ["ff598c4d-ccaf-40c1-bfaa-cb94565764b1"]}),
    task({id: "removed", email: "b@gmail.com", status: "failed", workspaceIds: ["83bec9de-395a-44e6-9a30-189508c22b99"]}),
    task({id: "legacy", email: "legacy@gmail.com", status: "failed", workspaceIds: []}),
  ], ["ff598c4d-ccaf-40c1-bfaa-cb94565764b1"]);

  assert.deepEqual(rows.map((item) => item.id), ["kept", "legacy"]);
});
