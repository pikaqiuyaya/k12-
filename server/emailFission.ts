type TaskStatus = "queued" | "running" | "success" | "failed" | "canceled";
type EmailStatus = "free" | "running" | "success" | "failed" | "banned";
type TaskKind = "k12" | "at-repair";
type EmailOtpMode = "auto" | "manual" | "smsbower-mail" | "emailnator";
export type WorkspaceLaunchMode = "all" | "random-one";

export interface PoolFissionNewTaskInput {
  enabled: boolean;
  count: number;
  isChildEmail: boolean;
  isSmsBowerMail: boolean;
  existingRemaining?: number;
}

export function poolFissionRemainingForNewTask(input: PoolFissionNewTaskInput): number | undefined {
  if (input.existingRemaining !== undefined) return input.existingRemaining;
  if (!input.enabled || input.isChildEmail || input.isSmsBowerMail) return undefined;
  return Math.max(0, Math.floor(input.count));
}

export interface PoolFissionChildInput {
  enabled: boolean;
  status: TaskStatus;
  isSmsBowerMail: boolean;
  hasFissionCounter: boolean;
  isChildEmail: boolean;
  remaining: number;
}

export function shouldCreatePoolFissionChild(input: PoolFissionChildInput): boolean {
  if (!input.enabled || input.isSmsBowerMail || !input.hasFissionCounter) return false;
  if (input.status === "success") return input.remaining > 0;
  return input.status === "failed" && input.isChildEmail;
}

export function poolFissionRemainingForNextTask(input: {status: TaskStatus; remaining: number}): number {
  const remaining = Math.max(0, Math.floor(input.remaining));
  return input.status === "success" ? Math.max(0, remaining - 1) : remaining;
}

export function fissionTopUpDeficit(input: {targetSuccesses: number; successfulChildren: number; activeTasks: number}): number {
  if (input.activeTasks > 0) return 0;
  const target = Math.max(0, Math.floor(input.targetSuccesses || 0));
  const successful = Math.max(0, Math.floor(input.successfulChildren || 0));
  return Math.max(0, target - successful);
}

export function fissionTopUpRemainingAfterThis(deficit: number): number {
  return Math.max(0, Math.floor(deficit || 0) - 1);
}

export function fissionTopUpBlockReason(input: {otpMode?: EmailOtpMode; hasSmsBowerHistory?: boolean}): string | undefined {
  if (input.otpMode === "emailnator") return "Emailnator 动态邮箱暂不支持继续补分裂";
  return undefined;
}

export function hasSmsBowerFissionHistory(input: {
  tasks: Array<{emailId: string; otpMode?: EmailOtpMode; smsBowerMailRoot?: string; smsBowerBatchId?: string}>;
  emails: Array<{id: string; otpMode?: EmailOtpMode; smsBowerMailRoot?: string}>;
}): boolean {
  const emailsById = new Map(input.emails.map((email) => [email.id, email]));
  return input.tasks.some((task) => {
    if (task.otpMode === "smsbower-mail" || task.smsBowerMailRoot || task.smsBowerBatchId) return true;
    const email = emailsById.get(task.emailId);
    return email?.otpMode === "smsbower-mail" || Boolean(email?.smsBowerMailRoot);
  });
}

export type TaskCreationSkipReason = "running" | "banned" | "success" | "active";

export interface TaskCreationSkipInput {
  emailStatus: EmailStatus;
  hasActiveTask: boolean;
  hasPriorSuccess?: boolean;
}

export function taskCreationSkipReason(input: TaskCreationSkipInput): TaskCreationSkipReason | undefined {
  if (input.hasActiveTask) return "active";
  if (input.hasPriorSuccess) return "success";
  return undefined;
}

export function shouldAutoSelectEmailForK12Launch(input: {emailStatus: EmailStatus; isChildEmail: boolean}): boolean {
  if (input.isChildEmail) return false;
  return input.emailStatus !== "running";
}

export function normalizeWorkspaceLaunchMode(value: unknown): WorkspaceLaunchMode {
  return value === "random-one" ? "random-one" : "all";
}

export function workspaceTaskVariantsForLaunch(input: {
  workspaceCandidates: string[];
  workspaceLaunchMode?: WorkspaceLaunchMode;
  randomIndex?: number;
}): string[] {
  const candidates = input.workspaceCandidates
    .map((item) => String(item || "").trim())
    .filter((item, index, values) => index === values.findIndex((value) => value.toLowerCase() === item.toLowerCase()));
  const variants = candidates.length ? candidates : [""];
  if (input.workspaceLaunchMode !== "random-one") return variants;
  const index = Math.abs(Math.floor(Number(input.randomIndex) || 0)) % variants.length;
  return [variants[index]];
}

export function taskWorkspaceKey(workspaceIds: string[] | undefined): string {
  const [first] = (workspaceIds || []).map((item) => String(item || "").trim()).filter(Boolean);
  return first ? first.toLowerCase() : "__no_workspace__";
}

export function taskWorkspaceKeysOverlap(left: string[] | undefined, right: string[] | undefined): boolean {
  return taskWorkspaceKey(left) === taskWorkspaceKey(right);
}

export function taskWorkspaceAllowed(taskWorkspaceIds: string[] | undefined, configuredWorkspaceIds: string[] | undefined): boolean {
  const configured = new Set((configuredWorkspaceIds || []).map((item) => String(item || "").trim().toLowerCase()).filter(Boolean));
  if (!configured.size) return true;
  const key = taskWorkspaceKey(taskWorkspaceIds);
  return key === "__no_workspace__" || configured.has(key);
}

export interface DuplicateQueuedTaskInput {
  taskKind: TaskKind;
  taskStatus: TaskStatus;
  hasPriorSuccess: boolean;
}

export function shouldSkipDuplicateQueuedTask(input: DuplicateQueuedTaskInput): boolean {
  return input.taskKind === "k12" && input.taskStatus === "queued" && input.hasPriorSuccess;
}

export function taskStatusAfterCancelRequest(status: TaskStatus): TaskStatus {
  return status === "queued" || status === "running" ? "canceled" : status;
}

export function shouldCancelActiveTaskStatus(status: TaskStatus): boolean {
  return status === "queued" || status === "running";
}

export interface SmsBowerActivationInput {
  otpMode?: EmailOtpMode;
  smsBowerMailId?: string;
  smsBowerMailClosedAt?: string;
  smsBowerMailCloseStatus?: number;
}

export function smsBowerActivationBlockReason(input: SmsBowerActivationInput): string | undefined {
  if (input.otpMode !== "smsbower-mail" || !input.smsBowerMailClosedAt) return undefined;
  const id = input.smsBowerMailId || "-";
  const status = input.smsBowerMailCloseStatus === undefined ? "" : `(status=${input.smsBowerMailCloseStatus})`;
  return `SMSBower activation=${id} 已关闭${status}，不能再获取验证码，请重新租 Gmail`;
}

export interface SmsBowerAutoReplaceInput {
  otpMode?: EmailOtpMode;
  smsBowerMailId?: string;
  autoReplace?: boolean;
  replacementRemaining?: number;
  taskStatus?: TaskStatus;
  error?: string;
}

export function isGoogleSsoUnsupportedMessage(value: unknown): boolean {
  const message = value instanceof Error ? value.message : String(value || "");
  return /accounts\.google\.com\/o\/oauth2|callback\/google|Google 登录账号|Google OAuth/i.test(message);
}

export function isSmsBowerActivationCanceledMessage(value: unknown): boolean {
  const message = value instanceof Error ? value.message : String(value || "");
  return /activation is already canceled|activation.*cancel|激活.*取消|激活被取消|后台状态已结束|Bad actual activation status/i.test(message);
}

export function isWrongEmailOtpCodeMessage(value: unknown): boolean {
  const message = value instanceof Error ? value.message : String(value || "");
  return /wrong_email_otp_code|wrong.*email.*otp|invalid.*email.*otp|验证码.*错误|验证码.*不正确/i.test(message);
}

export function isSmsBowerCodeLimitReachedMessage(value: unknown): boolean {
  const message = value instanceof Error ? value.message : String(value || "");
  return /maximum number of codes reached|code limit|验证码.*上限|次数.*上限/i.test(message);
}

export function isSmsBowerNoCodeTimeoutMessage(value: unknown): boolean {
  const message = value instanceof Error ? value.message : String(value || "");
  return /SMSBower 邮箱中未找到验证码|Code has not been received yet|code has not been received|no code|验证码.*未收到|未找到验证码/i.test(message);
}

export function isMailboxAccountInvalidMessage(value: unknown): boolean {
  const message = value instanceof Error ? value.message : String(value || "");
  return /mailbox\s+dead|email account is invalid|mailbox account is invalid|invalid mailbox account|邮箱账号无效|邮箱账户无效|邮箱不可用/i.test(message);
}

export function isMailboxBaselineCodeTimeoutMessage(value: unknown): boolean {
  const message = value instanceof Error ? value.message : String(value || "");
  return /mailbox code timeout:\s*mailbox still returns baseline code|still returns baseline code/i.test(message);
}

export function isMailboxOtpDeliveryTimeoutMessage(value: unknown): boolean {
  const message = value instanceof Error ? value.message : String(value || "");
  return /mailbox code timeout:\s*(mailbox still returns baseline code|mailbox returned no code|mailbox_url request timeout after \d+ms)|still returns baseline code|mailbox_url request timeout after \d+ms/i.test(message);
}

export function isOpenAiUserAlreadyExistsMessage(value: unknown): boolean {
  const message = value instanceof Error ? value.message : String(value || "");
  return /user_already_exists|An account already exists for this email address|please login instead/i.test(message);
}

export function shouldStopPoolFissionAfterUserAlreadyExists(input: {
  isSmsBowerMail: boolean;
  userAlreadyExists: boolean;
  successfulChildren: number;
  accountExistsFailures: number;
}): boolean {
  return false;
}

export function shouldStopPoolFissionAfterMailboxOtpTimeout(input: {
  isSmsBowerMail: boolean;
  isChildEmail: boolean;
  mailboxOtpDeliveryTimeout: boolean;
}): boolean {
  return false;
}

export function shouldCooldownPoolFissionAfterMailboxOtpTimeout(input: {
  isSmsBowerMail: boolean;
  isChildEmail: boolean;
  mailboxOtpDeliveryTimeout: boolean;
}): boolean {
  return input.mailboxOtpDeliveryTimeout && !input.isSmsBowerMail && input.isChildEmail;
}

export function shouldCooldownPoolFissionAfterUserAlreadyExists(input: {
  isSmsBowerMail: boolean;
  isChildEmail: boolean;
  userAlreadyExists: boolean;
}): boolean {
  return input.userAlreadyExists && !input.isSmsBowerMail && input.isChildEmail;
}

export function shouldTreatPoolChildUserAlreadyExistsAsLimitSuccess(input: {
  isSmsBowerMail: boolean;
  isChildEmail: boolean;
  userAlreadyExists: boolean;
}): boolean {
  return false;
}

export function shouldMarkPoolRootUnusableAfterUserAlreadyExists(input: {
  isSmsBowerMail: boolean;
  isChildEmail: boolean;
  userAlreadyExists: boolean;
}): boolean {
  return input.userAlreadyExists && !input.isSmsBowerMail && !input.isChildEmail;
}

export function shouldAutoReplaceSmsBowerMailFailure(input: SmsBowerAutoReplaceInput): boolean {
  if (input.otpMode !== "smsbower-mail") return false;
  if (!input.smsBowerMailId) return false;
  if (!input.autoReplace) return false;
  if ((input.replacementRemaining || 0) <= 0) return false;
  if (input.taskStatus !== "failed") return false;
  return isGoogleSsoUnsupportedMessage(input.error)
    || isSmsBowerActivationCanceledMessage(input.error)
    || isSmsBowerNoCodeTimeoutMessage(input.error);
}

export function shouldRequestSmsBowerNextCodeBeforeWait(input: {retryAfterWrongOtp?: boolean}): boolean {
  return input.retryAfterWrongOtp === true;
}

export function shouldSendLoginOtpBeforeEmailVerification(input: {otpSentInFlow?: boolean}): boolean {
  return input.otpSentInFlow !== true;
}

export function loginOtpSendSuccessMessage(nextUrl: string): string {
  const normalized = String(nextUrl || "").trim();
  if (normalized === "https://auth.openai.com/email-verification") {
    return "登录验证码发送请求成功，继续等待邮箱新验证码";
  }
  return `登录验证码发送请求成功，下一步: ${normalized || "unknown"}`;
}

export function loginOtpSendFailureMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error || "unknown");
  return `登录验证码发送请求失败，停止等待验证码: ${message}`;
}

export function shouldResendLoginOtpAfterWrongCode(_input: {otpMode?: EmailOtpMode}): boolean {
  return true;
}

export function mailboxOtpWaitOptions(input: {retryAfterWrongOtp?: boolean}): {
  timeoutMs: number;
  intervalMs: number;
  allowBaselineCodeAfterMs: number;
} {
  return {
    timeoutMs: input.retryAfterWrongOtp ? 45000 : 120000,
    intervalMs: 3000,
    allowBaselineCodeAfterMs: 0,
  };
}

export interface SmsBowerBatchReplacementInput {
  targetSuccesses?: number;
  successfulTasks: number;
  activeTasks: number;
}

export function shouldEnqueueSmsBowerBatchReplacement(input: SmsBowerBatchReplacementInput): boolean {
  const target = Math.max(0, Math.floor(input.targetSuccesses || 0));
  if (target <= 0) return false;
  return input.successfulTasks + input.activeTasks < target;
}
