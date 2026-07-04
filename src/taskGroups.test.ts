import assert from "node:assert/strict";
import {test} from "node:test";

import {buildTaskGroups, canTopUpTaskGroupFission, type TaskGroupInput} from "./taskGroups";

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
