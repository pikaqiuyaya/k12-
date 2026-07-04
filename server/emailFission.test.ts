import assert from "node:assert/strict";
import {test} from "node:test";

import {
  fissionTopUpDeficit,
  fissionTopUpBlockReason,
  fissionTopUpRemainingAfterThis,
  hasSmsBowerFissionHistory,
  isSmsBowerCodeLimitReachedMessage,
  isSmsBowerNoCodeTimeoutMessage,
  isWrongEmailOtpCodeMessage,
  mailboxOtpWaitOptions,
  poolFissionRemainingForNextTask,
  poolFissionRemainingForNewTask,
  shouldEnqueueSmsBowerBatchReplacement,
  shouldAutoReplaceSmsBowerMailFailure,
  shouldCreatePoolFissionChild,
  shouldRequestSmsBowerNextCodeBeforeWait,
  shouldSkipDuplicateQueuedTask,
  smsBowerActivationBlockReason,
  taskCreationSkipReason,
} from "./emailFission";

test("enables automatic pool fission for ordinary root Gmail tasks", () => {
  assert.equal(poolFissionRemainingForNewTask({
    enabled: true,
    count: 5,
    isChildEmail: false,
    isSmsBowerMail: false,
    existingRemaining: undefined,
  }), 5);
});

test("does not start ordinary pool fission from child emails", () => {
  assert.equal(poolFissionRemainingForNewTask({
    enabled: true,
    count: 5,
    isChildEmail: true,
    isSmsBowerMail: false,
    existingRemaining: undefined,
  }), undefined);
});

test("does not replace SMSBower dynamic fission counters", () => {
  assert.equal(poolFissionRemainingForNewTask({
    enabled: true,
    count: 5,
    isChildEmail: false,
    isSmsBowerMail: true,
    existingRemaining: 3,
  }), 3);
});

test("creates ordinary pool fission child after success or failed child replacement", () => {
  assert.equal(shouldCreatePoolFissionChild({
    enabled: true,
    status: "success",
    isSmsBowerMail: false,
    hasFissionCounter: true,
    isChildEmail: false,
    remaining: 1,
  }), true);
  assert.equal(shouldCreatePoolFissionChild({
    enabled: true,
    status: "failed",
    isSmsBowerMail: false,
    hasFissionCounter: true,
    isChildEmail: false,
    remaining: 1,
  }), false);
  assert.equal(shouldCreatePoolFissionChild({
    enabled: true,
    status: "failed",
    isSmsBowerMail: false,
    hasFissionCounter: true,
    isChildEmail: true,
    remaining: 1,
  }), true);
  assert.equal(shouldCreatePoolFissionChild({
    enabled: true,
    status: "failed",
    isSmsBowerMail: false,
    hasFissionCounter: true,
    isChildEmail: true,
    remaining: 0,
  }), true);
  assert.equal(shouldCreatePoolFissionChild({
    enabled: true,
    status: "failed",
    isSmsBowerMail: false,
    hasFissionCounter: false,
    isChildEmail: true,
    remaining: 0,
  }), false);
});

test("ordinary pool fission only consumes remaining quota on success", () => {
  assert.equal(poolFissionRemainingForNextTask({status: "success", remaining: 3}), 2);
  assert.equal(poolFissionRemainingForNextTask({status: "failed", remaining: 3}), 3);
  assert.equal(poolFissionRemainingForNextTask({status: "canceled", remaining: 3}), 3);
});

test("top-up fission only creates the missing chain length", () => {
  assert.equal(fissionTopUpDeficit({targetSuccesses: 5, successfulChildren: 4, activeTasks: 0}), 1);
  assert.equal(fissionTopUpRemainingAfterThis(1), 0);
  assert.equal(fissionTopUpDeficit({targetSuccesses: 5, successfulChildren: 2, activeTasks: 0}), 3);
  assert.equal(fissionTopUpRemainingAfterThis(3), 2);
  assert.equal(fissionTopUpDeficit({targetSuccesses: 5, successfulChildren: 5, activeTasks: 0}), 0);
  assert.equal(fissionTopUpDeficit({targetSuccesses: 5, successfulChildren: 4, activeTasks: 1}), 0);
});

test("top-up fission is blocked for dynamic mailbox providers", () => {
  assert.equal(fissionTopUpBlockReason({otpMode: "smsbower-mail"}), "SMSBower Gmail 不参与继续补分裂");
  assert.equal(fissionTopUpBlockReason({otpMode: "auto", hasSmsBowerHistory: true}), "SMSBower Gmail 不参与继续补分裂");
  assert.equal(fissionTopUpBlockReason({otpMode: "emailnator"}), "Emailnator 动态邮箱暂不支持继续补分裂");
  assert.equal(fissionTopUpBlockReason({otpMode: "auto"}), undefined);
  assert.equal(fissionTopUpBlockReason({otpMode: "manual"}), undefined);
});

test("detects SMSBower fission history from related task email records", () => {
  assert.equal(hasSmsBowerFissionHistory({
    tasks: [{emailId: "child"}],
    emails: [{id: "child", otpMode: "auto", smsBowerMailRoot: "root@gmail.com"}],
  }), true);

  assert.equal(hasSmsBowerFissionHistory({
    tasks: [{emailId: "child", smsBowerBatchId: "batch"}],
    emails: [{id: "child", otpMode: "auto"}],
  }), true);

  assert.equal(hasSmsBowerFissionHistory({
    tasks: [{emailId: "child"}],
    emails: [{id: "child", otpMode: "auto"}],
  }), false);
});

test("skips K12 task creation for emails that should not be queued again", () => {
  assert.equal(taskCreationSkipReason({emailStatus: "free", hasActiveTask: false}), undefined);
  assert.equal(taskCreationSkipReason({emailStatus: "running", hasActiveTask: false}), "running");
  assert.equal(taskCreationSkipReason({emailStatus: "banned", hasActiveTask: false}), "banned");
  assert.equal(taskCreationSkipReason({emailStatus: "success", hasActiveTask: false}), "success");
  assert.equal(taskCreationSkipReason({emailStatus: "free", hasActiveTask: true}), "active");
});

test("skips only duplicate queued K12 tasks after a prior success exists", () => {
  assert.equal(shouldSkipDuplicateQueuedTask({taskKind: "k12", taskStatus: "queued", hasPriorSuccess: true}), true);
  assert.equal(shouldSkipDuplicateQueuedTask({taskKind: "k12", taskStatus: "queued", hasPriorSuccess: false}), false);
  assert.equal(shouldSkipDuplicateQueuedTask({taskKind: "at-repair", taskStatus: "queued", hasPriorSuccess: true}), false);
  assert.equal(shouldSkipDuplicateQueuedTask({taskKind: "k12", taskStatus: "failed", hasPriorSuccess: true}), false);
});

test("blocks SMSBower Gmail tasks when the activation has already been closed", () => {
  assert.equal(smsBowerActivationBlockReason({
    otpMode: "smsbower-mail",
    smsBowerMailId: "11408713",
    smsBowerMailClosedAt: "2026-07-04T05:25:08.515Z",
    smsBowerMailCloseStatus: 2,
  }), "SMSBower activation=11408713 已关闭(status=2)，不能再获取验证码，请重新租 Gmail");

  assert.equal(smsBowerActivationBlockReason({
    otpMode: "smsbower-mail",
    smsBowerMailId: "11408713",
  }), undefined);

  assert.equal(smsBowerActivationBlockReason({
    otpMode: "auto",
    smsBowerMailClosedAt: "2026-07-04T05:25:08.515Z",
  }), undefined);
});

test("auto-replaces dynamic SMSBower Gmail when the rented mailbox cannot be used", () => {
  assert.equal(shouldAutoReplaceSmsBowerMailFailure({
    otpMode: "smsbower-mail",
    smsBowerMailId: "11439966",
    autoReplace: true,
    replacementRemaining: 3,
    taskStatus: "failed",
    error: "ChatGPT web 登录未到达 callback，停在: https://accounts.google.com/o/oauth2/v2/auth",
  }), true);

  assert.equal(shouldAutoReplaceSmsBowerMailFailure({
    otpMode: "smsbower-mail",
    smsBowerMailId: "11408713",
    autoReplace: true,
    replacementRemaining: 3,
    taskStatus: "failed",
    error: "SMSBower getCode 失败: Activation is already canceled",
  }), true);

  assert.equal(shouldAutoReplaceSmsBowerMailFailure({
    otpMode: "smsbower-mail",
    smsBowerMailId: "11446121",
    autoReplace: true,
    replacementRemaining: 3,
    taskStatus: "failed",
    error: "SMSBower 邮箱中未找到验证码: s69abbuexe@gmail.com; last=SMSBower getCode 失败: Code has not been received yet, please try again later",
  }), true);

  assert.equal(shouldAutoReplaceSmsBowerMailFailure({
    otpMode: "smsbower-mail",
    smsBowerMailId: "11439966",
    autoReplace: false,
    replacementRemaining: 3,
    taskStatus: "failed",
    error: "https://accounts.google.com/o/oauth2/v2/auth",
  }), false);

  assert.equal(shouldAutoReplaceSmsBowerMailFailure({
    otpMode: "smsbower-mail",
    smsBowerMailId: "11439966",
    autoReplace: true,
    replacementRemaining: 0,
    taskStatus: "failed",
    error: "https://accounts.google.com/o/oauth2/v2/auth",
  }), false);

  assert.equal(shouldAutoReplaceSmsBowerMailFailure({
    otpMode: "smsbower-mail",
    smsBowerMailId: "11439966",
    autoReplace: true,
    replacementRemaining: 3,
    taskStatus: "failed",
    error: "K12 workspace HTTP 401",
  }), false);
});

test("does not advance SMSBower activation before the first OTP wait", () => {
  assert.equal(shouldRequestSmsBowerNextCodeBeforeWait({retryAfterWrongOtp: false}), false);
  assert.equal(shouldRequestSmsBowerNextCodeBeforeWait({retryAfterWrongOtp: true}), true);
});

test("detects OpenAI email OTP validation errors for same-activation retry", () => {
  assert.equal(isWrongEmailOtpCodeMessage("EmailOtpValidate请求失败: 401 code=wrong_email_otp_code"), true);
  assert.equal(isWrongEmailOtpCodeMessage("K12 workspace HTTP 401"), false);
});

test("disables mailbox baseline fallback after OpenAI rejects an email OTP", () => {
  assert.deepEqual(mailboxOtpWaitOptions({retryAfterWrongOtp: true}), {
    timeoutMs: 120000,
    intervalMs: 3000,
    allowBaselineCodeAfterMs: 0,
  });
});

test("detects SMSBower per-activation code limit responses", () => {
  assert.equal(isSmsBowerCodeLimitReachedMessage("SMSBower setStatus 失败: Maximum number of codes reached"), true);
  assert.equal(isSmsBowerCodeLimitReachedMessage("SMSBower 验证码暂未收到"), false);
});

test("detects SMSBower no-code timeout responses for replacement", () => {
  assert.equal(isSmsBowerNoCodeTimeoutMessage("SMSBower 邮箱中未找到验证码: a@gmail.com; last=SMSBower getCode 失败: Code has not been received yet"), true);
  assert.equal(isSmsBowerNoCodeTimeoutMessage("K12 workspace HTTP 401"), false);
});

test("continues SMSBower dynamic batch until target successes are reached", () => {
  assert.equal(shouldEnqueueSmsBowerBatchReplacement({
    targetSuccesses: 3,
    successfulTasks: 1,
    activeTasks: 1,
  }), true);

  assert.equal(shouldEnqueueSmsBowerBatchReplacement({
    targetSuccesses: 3,
    successfulTasks: 2,
    activeTasks: 1,
  }), false);

  assert.equal(shouldEnqueueSmsBowerBatchReplacement({
    targetSuccesses: 3,
    successfulTasks: 3,
    activeTasks: 0,
  }), false);
});
