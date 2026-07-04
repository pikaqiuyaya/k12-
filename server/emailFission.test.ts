import assert from "node:assert/strict";
import {test} from "node:test";

import {
  fissionTopUpDeficit,
  fissionTopUpBlockReason,
  fissionTopUpRemainingAfterThis,
  hasSmsBowerFissionHistory,
  isSmsBowerCodeLimitReachedMessage,
  isSmsBowerNoCodeTimeoutMessage,
  isMailboxAccountInvalidMessage,
  isMailboxOtpDeliveryTimeoutMessage,
  isOpenAiUserAlreadyExistsMessage,
  isMailboxBaselineCodeTimeoutMessage,
  isWrongEmailOtpCodeMessage,
  loginOtpSendFailureMessage,
  loginOtpSendSuccessMessage,
  mailboxOtpWaitOptions,
  poolFissionRemainingForNextTask,
  poolFissionRemainingForNewTask,
  shouldEnqueueSmsBowerBatchReplacement,
  shouldAutoReplaceSmsBowerMailFailure,
  shouldAutoSelectEmailForK12Launch,
  normalizeWorkspaceLaunchMode,
  shouldCreatePoolFissionChild,
  workspaceTaskVariantsForLaunch,
  shouldResendLoginOtpAfterWrongCode,
  shouldRequestSmsBowerNextCodeBeforeWait,
  shouldSendLoginOtpBeforeEmailVerification,
  shouldCancelActiveTaskStatus,
  shouldSkipDuplicateQueuedTask,
  shouldCooldownPoolFissionAfterMailboxOtpTimeout,
  shouldStopPoolFissionAfterMailboxOtpTimeout,
  shouldStopPoolFissionAfterUserAlreadyExists,
  shouldTreatPoolChildUserAlreadyExistsAsLimitSuccess,
  shouldMarkPoolRootUnusableAfterUserAlreadyExists,
  smsBowerActivationBlockReason,
  taskCreationSkipReason,
  taskStatusAfterCancelRequest,
  taskWorkspaceAllowed,
  taskWorkspaceKey,
  taskWorkspaceKeysOverlap,
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

test("cooldowns ordinary pool fission after mailbox OTP delivery timeouts without marking it terminal", () => {
  assert.equal(isMailboxOtpDeliveryTimeoutMessage("mailbox code timeout: mailbox still returns baseline code"), true);
  assert.equal(isMailboxOtpDeliveryTimeoutMessage("mailbox code timeout: mailbox returned no code"), true);
  assert.equal(isMailboxOtpDeliveryTimeoutMessage("mailbox dead: The email account is invalid"), false);
  assert.equal(shouldCooldownPoolFissionAfterMailboxOtpTimeout({
    isSmsBowerMail: false,
    isChildEmail: true,
    mailboxOtpDeliveryTimeout: true,
  }), true);
  assert.equal(shouldStopPoolFissionAfterMailboxOtpTimeout({
    isSmsBowerMail: false,
    isChildEmail: true,
    mailboxOtpDeliveryTimeout: true,
  }), false);
  assert.equal(shouldCooldownPoolFissionAfterMailboxOtpTimeout({
    isSmsBowerMail: false,
    isChildEmail: false,
    mailboxOtpDeliveryTimeout: true,
  }), false);
  assert.equal(shouldCooldownPoolFissionAfterMailboxOtpTimeout({
    isSmsBowerMail: true,
    isChildEmail: true,
    mailboxOtpDeliveryTimeout: true,
  }), false);
});

test("top-up fission only creates the missing chain length", () => {
  assert.equal(fissionTopUpDeficit({targetSuccesses: 5, successfulChildren: 4, activeTasks: 0}), 1);
  assert.equal(fissionTopUpRemainingAfterThis(1), 0);
  assert.equal(fissionTopUpDeficit({targetSuccesses: 5, successfulChildren: 2, activeTasks: 0}), 3);
  assert.equal(fissionTopUpRemainingAfterThis(3), 2);
  assert.equal(fissionTopUpDeficit({targetSuccesses: 5, successfulChildren: 5, activeTasks: 0}), 0);
  assert.equal(fissionTopUpDeficit({targetSuccesses: 5, successfulChildren: 4, activeTasks: 1}), 0);
});

test("top-up fission is allowed for reusable SMSBower activations and blocked for Emailnator", () => {
  assert.equal(fissionTopUpBlockReason({otpMode: "smsbower-mail"}), undefined);
  assert.equal(fissionTopUpBlockReason({otpMode: "auto", hasSmsBowerHistory: true}), undefined);
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
  assert.equal(taskCreationSkipReason({emailStatus: "running", hasActiveTask: false}), undefined);
  assert.equal(taskCreationSkipReason({emailStatus: "banned", hasActiveTask: false}), undefined);
  assert.equal(taskCreationSkipReason({emailStatus: "success", hasActiveTask: false}), undefined);
  assert.equal(taskCreationSkipReason({emailStatus: "free", hasActiveTask: true}), "active");
  assert.equal(taskCreationSkipReason({emailStatus: "free", hasActiveTask: false, hasPriorSuccess: true}), "success");
});

test("auto-selects reusable mother emails for launching new workspace tasks", () => {
  assert.equal(shouldAutoSelectEmailForK12Launch({emailStatus: "success", isChildEmail: false}), true);
  assert.equal(shouldAutoSelectEmailForK12Launch({emailStatus: "failed", isChildEmail: false}), true);
  assert.equal(shouldAutoSelectEmailForK12Launch({emailStatus: "free", isChildEmail: false}), true);
  assert.equal(shouldAutoSelectEmailForK12Launch({emailStatus: "running", isChildEmail: false}), false);
  assert.equal(shouldAutoSelectEmailForK12Launch({emailStatus: "banned", isChildEmail: false}), true);
  assert.equal(shouldAutoSelectEmailForK12Launch({emailStatus: "success", isChildEmail: true}), false);
});

test("matches K12 task uniqueness by workspace id", () => {
  assert.equal(taskWorkspaceKey(["83bec9de-395a-44e6-9a30-189508c22b99"]), "83bec9de-395a-44e6-9a30-189508c22b99");
  assert.equal(taskWorkspaceKey([]), "__no_workspace__");
  assert.equal(taskWorkspaceKeysOverlap(["workspace-a"], ["workspace-a"]), true);
  assert.equal(taskWorkspaceKeysOverlap(["workspace-a"], ["workspace-b"]), false);
  assert.equal(taskWorkspaceKeysOverlap([], []), true);
});

test("selects workspace task variants by launch mode", () => {
  assert.deepEqual(workspaceTaskVariantsForLaunch({
    workspaceCandidates: ["workspace-a", "workspace-b", "workspace-c"],
    workspaceLaunchMode: "all",
    randomIndex: 2,
  }), ["workspace-a", "workspace-b", "workspace-c"]);

  assert.deepEqual(workspaceTaskVariantsForLaunch({
    workspaceCandidates: ["workspace-a", "workspace-b", "workspace-c"],
    workspaceLaunchMode: "random-one",
    randomIndex: 1,
  }), ["workspace-b"]);

  assert.deepEqual(workspaceTaskVariantsForLaunch({
    workspaceCandidates: [],
    workspaceLaunchMode: "random-one",
    randomIndex: 1,
  }), [""]);
});

test("normalizes workspace launch mode config values", () => {
  assert.equal(normalizeWorkspaceLaunchMode("random-one"), "random-one");
  assert.equal(normalizeWorkspaceLaunchMode("all"), "all");
  assert.equal(normalizeWorkspaceLaunchMode("bad"), "all");
  assert.equal(normalizeWorkspaceLaunchMode(undefined), "all");
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

test("sends a fresh login OTP before waiting on a direct email-verification step", () => {
  assert.equal(shouldSendLoginOtpBeforeEmailVerification({otpSentInFlow: false}), true);
  assert.equal(shouldSendLoginOtpBeforeEmailVerification({otpSentInFlow: undefined}), true);
  assert.equal(shouldSendLoginOtpBeforeEmailVerification({otpSentInFlow: true}), false);
});

test("reports whether the login OTP send request succeeded before waiting", () => {
  assert.equal(
    loginOtpSendSuccessMessage("https://auth.openai.com/email-verification"),
    "登录验证码发送请求成功，继续等待邮箱新验证码",
  );
  assert.equal(
    loginOtpSendSuccessMessage("https://auth.openai.com/workspace"),
    "登录验证码发送请求成功，下一步: https://auth.openai.com/workspace",
  );
  assert.equal(
    loginOtpSendFailureMessage(new Error("HTTP 429")),
    "登录验证码发送请求失败，停止等待验证码: HTTP 429",
  );
});

test("resends login OTP after wrong-code retry for every login OTP mode", () => {
  assert.equal(shouldResendLoginOtpAfterWrongCode({otpMode: "auto"}), true);
  assert.equal(shouldResendLoginOtpAfterWrongCode({otpMode: undefined}), true);
  assert.equal(shouldResendLoginOtpAfterWrongCode({otpMode: "manual"}), true);
  assert.equal(shouldResendLoginOtpAfterWrongCode({otpMode: "smsbower-mail"}), true);
  assert.equal(shouldResendLoginOtpAfterWrongCode({otpMode: "emailnator"}), true);
});

test("detects OpenAI email OTP validation errors for same-activation retry", () => {
  assert.equal(isWrongEmailOtpCodeMessage("EmailOtpValidate请求失败: 401 code=wrong_email_otp_code"), true);
  assert.equal(isWrongEmailOtpCodeMessage("K12 workspace HTTP 401"), false);
});

test("never uses mailbox baseline codes as OTP fallback", () => {
  assert.deepEqual(mailboxOtpWaitOptions({retryAfterWrongOtp: false}), {
    timeoutMs: 120000,
    intervalMs: 3000,
    allowBaselineCodeAfterMs: 0,
  });

  assert.deepEqual(mailboxOtpWaitOptions({retryAfterWrongOtp: true}), {
    timeoutMs: 45000,
    intervalMs: 3000,
    allowBaselineCodeAfterMs: 0,
  });
});

test("detects mailbox baseline-code timeouts after wrong OTP retry", () => {
  assert.equal(isMailboxBaselineCodeTimeoutMessage("mailbox code timeout: mailbox still returns baseline code"), true);
  assert.equal(isMailboxBaselineCodeTimeoutMessage("mailbox code timeout: mailbox returned no code"), false);
  assert.equal(isMailboxBaselineCodeTimeoutMessage("mailbox dead: The email account is invalid"), false);
});

test("detects SMSBower per-activation code limit responses", () => {
  assert.equal(isSmsBowerCodeLimitReachedMessage("SMSBower setStatus 失败: Maximum number of codes reached"), true);
  assert.equal(isSmsBowerCodeLimitReachedMessage("SMSBower 验证码暂未收到"), false);
});

test("detects SMSBower no-code timeout responses for replacement", () => {
  assert.equal(isSmsBowerNoCodeTimeoutMessage("SMSBower 邮箱中未找到验证码: a@gmail.com; last=SMSBower getCode 失败: Code has not been received yet"), true);
  assert.equal(isSmsBowerNoCodeTimeoutMessage("K12 workspace HTTP 401"), false);
});

test("detects terminal mailbox account invalid errors", () => {
  assert.equal(isMailboxAccountInvalidMessage("mailbox dead: The email account is invalid"), true);
  assert.equal(isMailboxAccountInvalidMessage("The email account is invalid"), true);
  assert.equal(isMailboxAccountInvalidMessage("mailbox code timeout: mailbox returned no code"), false);
  assert.equal(isMailboxAccountInvalidMessage("邮箱基线读取失败: network timeout"), false);
});

test("marks queued and running tasks canceled immediately on cancel request", () => {
  assert.equal(taskStatusAfterCancelRequest("queued"), "canceled");
  assert.equal(taskStatusAfterCancelRequest("running"), "canceled");
  assert.equal(taskStatusAfterCancelRequest("failed"), "failed");
  assert.equal(taskStatusAfterCancelRequest("success"), "success");
});

test("only queued and running tasks are active-stop candidates", () => {
  assert.equal(shouldCancelActiveTaskStatus("queued"), true);
  assert.equal(shouldCancelActiveTaskStatus("running"), true);
  assert.equal(shouldCancelActiveTaskStatus("failed"), false);
  assert.equal(shouldCancelActiveTaskStatus("success"), false);
  assert.equal(shouldCancelActiveTaskStatus("canceled"), false);
});

test("detects tasks outside the current workspace config", () => {
  assert.equal(taskWorkspaceAllowed(["83bec9de-395a-44e6-9a30-189508c22b99"], ["ff598c4d-ccaf-40c1-bfaa-cb94565764b1"]), false);
  assert.equal(taskWorkspaceAllowed(["ff598c4d-ccaf-40c1-bfaa-cb94565764b1"], ["ff598c4d-ccaf-40c1-bfaa-cb94565764b1"]), true);
  assert.equal(taskWorkspaceAllowed([], ["ff598c4d-ccaf-40c1-bfaa-cb94565764b1"]), true);
  assert.equal(taskWorkspaceAllowed(["83bec9de-395a-44e6-9a30-189508c22b99"], []), true);
});

test("detects OpenAI user-already-exists responses for alias-family fission stop", () => {
  assert.equal(isOpenAiUserAlreadyExistsMessage("CreateAccount 请求失败: HTTP 400 {\"error\":{\"code\":\"user_already_exists\"}}"), true);
  assert.equal(isOpenAiUserAlreadyExistsMessage("An account already exists for this email address, please login instead."), true);
  assert.equal(isOpenAiUserAlreadyExistsMessage("K12 workspace HTTP 401"), false);
});

test("does not stop ordinary email-pool fission after user-already-exists because it can succeed after cooldown", () => {
  assert.equal(shouldStopPoolFissionAfterUserAlreadyExists({
    isSmsBowerMail: false,
    userAlreadyExists: true,
    successfulChildren: 4,
    accountExistsFailures: 1,
  }), false);

  assert.equal(shouldStopPoolFissionAfterUserAlreadyExists({
    isSmsBowerMail: false,
    userAlreadyExists: false,
    successfulChildren: 4,
    accountExistsFailures: 1,
  }), false);

  assert.equal(shouldStopPoolFissionAfterUserAlreadyExists({
    isSmsBowerMail: false,
    userAlreadyExists: true,
    successfulChildren: 0,
    accountExistsFailures: 1,
  }), false);

  assert.equal(shouldStopPoolFissionAfterUserAlreadyExists({
    isSmsBowerMail: true,
    userAlreadyExists: true,
    successfulChildren: 4,
    accountExistsFailures: 1,
  }), false);
});

test("keeps ordinary pool child user-already-exists as retryable failure instead of limit success", () => {
  assert.equal(shouldTreatPoolChildUserAlreadyExistsAsLimitSuccess({
    isSmsBowerMail: false,
    isChildEmail: true,
    userAlreadyExists: true,
  }), false);

  assert.equal(shouldTreatPoolChildUserAlreadyExistsAsLimitSuccess({
    isSmsBowerMail: false,
    isChildEmail: false,
    userAlreadyExists: true,
  }), false);

  assert.equal(shouldTreatPoolChildUserAlreadyExistsAsLimitSuccess({
    isSmsBowerMail: true,
    isChildEmail: true,
    userAlreadyExists: true,
  }), false);
});

test("marks only ordinary root mailbox registration collisions as unusable", () => {
  assert.equal(shouldMarkPoolRootUnusableAfterUserAlreadyExists({
    isSmsBowerMail: false,
    isChildEmail: false,
    userAlreadyExists: true,
  }), true);

  assert.equal(shouldMarkPoolRootUnusableAfterUserAlreadyExists({
    isSmsBowerMail: false,
    isChildEmail: true,
    userAlreadyExists: true,
  }), false);

  assert.equal(shouldMarkPoolRootUnusableAfterUserAlreadyExists({
    isSmsBowerMail: true,
    isChildEmail: false,
    userAlreadyExists: true,
  }), false);
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
