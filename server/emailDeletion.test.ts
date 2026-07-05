import assert from "node:assert/strict";
import {test} from "node:test";

import {pruneTasksForDeletedEmails, pruneTasksForMissingSub2ApiAccounts, pruneTasksWithoutEmailRecords} from "./emailDeletion";

test("removes tasks for deleted email records", () => {
  const result = pruneTasksForDeletedEmails(
    [
      {id: "root", email: "root@gmail.com"},
      {id: "other", email: "other@gmail.com"},
    ],
    [
      {id: "t-root", emailId: "root", status: "failed"},
      {id: "t-other", emailId: "other", status: "success"},
    ],
    ["root"],
  );

  assert.deepEqual(result.tasks.map((item) => item.id), ["t-other"]);
  assert.equal(result.removedTasks, 1);
});

test("removing a parent email also removes historical child tasks from the task list", () => {
  const result = pruneTasksForDeletedEmails(
    [
      {id: "root", email: "root@gmail.com"},
      {id: "child", email: "root+aaaaaa@gmail.com", parentEmail: "root@gmail.com"},
      {id: "other-child", email: "other+bbbbbb@gmail.com", parentEmail: "other@gmail.com"},
    ],
    [
      {id: "t-root", emailId: "root", status: "failed"},
      {id: "t-child", emailId: "child", status: "success"},
      {id: "t-other-child", emailId: "other-child", status: "success"},
    ],
    ["root"],
  );

  assert.deepEqual(result.tasks.map((item) => item.id), ["t-other-child"]);
  assert.equal(result.removedTasks, 2);
});

test("keeps queued or running tasks even when related email records are deleted", () => {
  const result = pruneTasksForDeletedEmails(
    [
      {id: "root", email: "root@gmail.com"},
      {id: "child", email: "root+aaaaaa@gmail.com", parentEmail: "root@gmail.com"},
    ],
    [
      {id: "t-root", emailId: "root", status: "running"},
      {id: "t-child", emailId: "child", status: "queued"},
      {id: "t-old-child", emailId: "child", status: "failed"},
    ],
    ["root"],
  );

  assert.deepEqual(result.tasks.map((item) => item.id), ["t-root", "t-child"]);
  assert.equal(result.removedTasks, 1);
});

test("removes historical orphan tasks when their email record no longer exists", () => {
  const result = pruneTasksWithoutEmailRecords(
    [{id: "kept-email", email: "kept@gmail.com"}],
    [
      {id: "t-orphan", emailId: "deleted-email", status: "failed"},
      {id: "t-kept", emailId: "kept-email", status: "success"},
      {id: "t-running", emailId: "deleted-email", status: "running"},
    ],
  );

  assert.deepEqual(result.tasks.map((item) => item.id), ["t-kept", "t-running"]);
  assert.equal(result.removedTasks, 1);
});

test("removes historical child tasks when their parent email record is gone", () => {
  const result = pruneTasksWithoutEmailRecords(
    [
      {id: "child", email: "root+aaaaaa@gmail.com", parentEmail: "root@gmail.com"},
      {id: "other-root", email: "other@gmail.com"},
      {id: "other-child", email: "other+bbbbbb@gmail.com", parentEmail: "other@gmail.com"},
    ],
    [
      {id: "t-child", emailId: "child", status: "success"},
      {id: "t-other-child", emailId: "other-child", status: "success"},
    ],
  );

  assert.deepEqual(result.tasks.map((item) => item.id), ["t-other-child"]);
  assert.equal(result.removedTasks, 1);
});

test("removes historical tasks for Sub2API accounts that no longer exist", () => {
  const emails = [
    {id: "removed-email", email: "removed@gmail.com", sub2apiAccount: "removed@gmail.com---k12"},
    {id: "kept-email", email: "kept@gmail.com", sub2apiAccount: "kept@gmail.com---k12"},
  ];
  const result = pruneTasksForMissingSub2ApiAccounts(
    emails,
    [
      {id: "t-removed", emailId: "removed-email", status: "success", sub2apiAccount: "removed@gmail.com---k12"},
      {id: "t-kept", emailId: "kept-email", status: "success", sub2apiAccount: "kept@gmail.com---k12"},
      {id: "t-running", emailId: "removed-email", status: "running", sub2apiAccount: "removed@gmail.com---k12"},
    ],
    ["kept@gmail.com---k12"],
  );

  assert.deepEqual(result.tasks.map((item) => item.id), ["t-kept", "t-running"]);
  assert.equal(result.removedTasks, 1);
  assert.equal(result.clearedEmails, 1);
  assert.equal(result.emails[0].sub2apiAccount, undefined);
  assert.equal(result.emails[1].sub2apiAccount, "kept@gmail.com---k12");
});

test("keeps local-only tasks when no Sub2API account name was recorded", () => {
  const result = pruneTasksForMissingSub2ApiAccounts(
    [{id: "email", email: "local@gmail.com"}],
    [{id: "t-local", emailId: "email", status: "failed"}],
    [],
  );

  assert.deepEqual(result.tasks.map((item) => item.id), ["t-local"]);
  assert.equal(result.removedTasks, 0);
  assert.equal(result.clearedEmails, 0);
});

test("does not prune Sub2API account names outside the scanned scope", () => {
  const result = pruneTasksForMissingSub2ApiAccounts(
    [{id: "other-email", email: "other@gmail.com", sub2apiAccount: "other@gmail.com---other"}],
    [{id: "t-other", emailId: "other-email", status: "success", sub2apiAccount: "other@gmail.com---other"}],
    [],
    {shouldInspectAccountName: (name) => name.endsWith("---k12")},
  );

  assert.deepEqual(result.tasks.map((item) => item.id), ["t-other"]);
  assert.equal(result.removedTasks, 0);
  assert.equal(result.clearedEmails, 0);
  assert.equal(result.emails[0].sub2apiAccount, "other@gmail.com---other");
});
