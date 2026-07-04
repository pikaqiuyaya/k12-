import {createHash, randomInt, randomUUID} from "node:crypto";
import {existsSync} from "node:fs";
import {mkdir, readFile, stat, writeFile} from "node:fs/promises";
import {createServer, type IncomingMessage, type ServerResponse} from "node:http";
import path from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";
import {fetch as undiciFetch, ProxyAgent} from "undici";
import {validateSub2ApiPasswordPatch} from "./configPatch";
import {
  authWorkspaceSelectionCandidates,
  isRecoverableWorkspaceSwitchAuthStep,
  isRecoverableWorkspaceSelectError,
  isSameDomainWorkspaceError,
  isUnavailableWorkspaceSelectError,
  mergeWorkspaceFallbackIds,
  removeWorkspaceId,
  shouldRetryK12Invite,
} from "./k12Workspace";
import {
  isGoogleSsoUnsupportedMessage,
  isMailboxBaselineCodeTimeoutMessage,
  isMailboxAccountInvalidMessage,
  isMailboxOtpDeliveryTimeoutMessage,
  isOpenAiUserAlreadyExistsMessage,
  isSmsBowerCodeLimitReachedMessage,
  isSmsBowerActivationCanceledMessage,
  isWrongEmailOtpCodeMessage,
  fissionTopUpDeficit,
  fissionTopUpBlockReason,
  fissionTopUpRemainingAfterThis,
  hasSmsBowerFissionHistory,
  loginOtpSendFailureMessage,
  loginOtpSendSuccessMessage,
  mailboxOtpWaitOptions,
  poolFissionRemainingForNextTask,
  poolFissionRemainingForNewTask,
  shouldEnqueueSmsBowerBatchReplacement,
  shouldAutoReplaceSmsBowerMailFailure,
  shouldAutoSelectEmailForK12Launch,
  shouldCancelActiveTaskStatus,
  shouldCooldownPoolFissionAfterMailboxOtpTimeout,
  shouldCooldownPoolFissionAfterUserAlreadyExists,
  shouldCreatePoolFissionChild,
  shouldResendLoginOtpAfterWrongCode,
  shouldRequestSmsBowerNextCodeBeforeWait,
  shouldSendLoginOtpBeforeEmailVerification,
  shouldSkipDuplicateQueuedTask,
  shouldMarkPoolRootUnusableAfterUserAlreadyExists,
  smsBowerActivationBlockReason,
  normalizeWorkspaceLaunchMode,
  taskCreationSkipReason,
  taskStatusAfterCancelRequest,
  taskWorkspaceAllowed,
  workspaceTaskVariantsForLaunch,
  taskWorkspaceKey,
  taskWorkspaceKeysOverlap,
} from "./emailFission";
import {createSub2ApiAdminLoginManager} from "./sub2ApiAdminAuth";
import {shouldFailTaskAfterServerRestart} from "./taskRestart";
import {
  K12_PLAN_MISMATCH_ISSUE,
  SUB2API_K12_STATUS_ERROR_ISSUE,
  isAutoAtRepairIssue,
  isTerminalK12AccessDeniedMessage,
  shouldCreateAutoAtRepairTask,
  sub2ApiAccountEmailCandidatesFromName,
  sub2ApiK12LivenessIssue,
  sub2ApiK12StatusErrorReason,
  type K12RepairIssue,
} from "./sub2ApiAccountRepair";
import {
  combineDirectAndSub2Liveness,
  isOpenAiWorkspaceAccessDeniedMessage,
  k12PlanMismatchReason,
  shouldTrySub2LivenessAfterDirectFailure,
  type AccessTokenLivenessResult,
} from "./accessTokenLiveness";
import {isMissingChatGptAccessTokenError} from "./chatGptSession";
import {
  DEFAULT_POOL_FISSION_CHILD_COOLDOWN_MS,
  DEFAULT_POOL_FISSION_MAILBOX_OTP_COOLDOWN_MS,
  poolFissionCooldownDelayMs,
  poolFissionMailboxOtpCooldownDelayMs,
} from "./poolFissionCooldown";
import {pruneTasksForDeletedEmails, pruneTasksForMissingSub2ApiAccounts, pruneTasksWithoutEmailRecords} from "./emailDeletion";
import {writeJsonAtomic} from "./atomicJson";
import {
  emailWorkspaceBlockReason,
  upsertWorkspaceBlock,
  type WorkspaceBlockRecord,
} from "./workspaceBlocklist";

type K12Route = "request" | "accept";
type TaskStatus = "queued" | "running" | "success" | "failed" | "canceled";
type LogLevel = "info" | "ok" | "warn" | "error";
type TaskKind = "k12" | "at-repair";
type JsonOutFormat = "sub2api" | "cpa";
type EmailOtpMode = "auto" | "manual" | "smsbower-mail" | "emailnator";
type GmailMailProvider = "smsbower" | "emailnator";

interface AppConfig {
  port: number;
  referenceBundlePath: string;
  defaultPassword: string;
  defaultProxyUrl: string;
  openaiFetchTimeoutMs: number;
  mailApiBaseUrl: string;
  workspaceIds: string[];
  route: K12Route;
  joinIntervalMs: number;
  joinMaxRetries: number;
  taskConcurrency: number;
  runWorkspaceJoin: boolean;
  runSub2Api: boolean;
  sub2apiNoRtMode: boolean;
  sub2apiUrl: string;
  sub2apiEmail: string;
  sub2apiPassword: string;
  sub2apiGroupName: string;
  sub2apiProxyName: string;
  sub2apiAccountPriority: number;
  sub2apiConcurrency: number;
  sub2apiAutoRefillEnabled: boolean;
  sub2apiAutoAtRepairEnabled: boolean;
  sub2apiRefillGroupName: string;
  sub2apiRefillThreshold: number;
  sub2apiRefillEmailCount: number;
  sub2apiRefillIntervalMs: number;
  sub2apiRefillDeepCheckEnabled: boolean;
  gmailMailProvider: GmailMailProvider;
  smsBowerMailEnabled: boolean;
  smsBowerApiKey: string;
  smsBowerMailBaseUrl: string;
  smsBowerMailService: string;
  smsBowerMailDomain: string;
  smsBowerMailMaxPrice: string;
  smsBowerGmailFissionEnabled: boolean;
  smsBowerGmailFissionCount: number;
  poolFissionMailboxOtpCooldownMs: number;
  emailnatorBaseUrl: string;
  emailnatorEmailType: string;
  requireChatgptAccountId: boolean;
  tokenOut: string;
  jsonOutDir: string;
  jsonOutFormat: JsonOutFormat;
}

type EmailStatus = "free" | "running" | "success" | "failed" | "banned";

interface EmailRecord {
  id: string;
  email: string;
  parentEmail?: string;
  otpMode?: EmailOtpMode;
  password: string;
  mailboxUrl: string;
  clientId?: string;
  refreshToken?: string;
  raw: string;
  status: EmailStatus;
  importedAt: string;
  updatedAt: string;
  lastTaskId?: string;
  lastError?: string;
  lastAccessTokenHash?: string;
  sub2apiAccount?: string;
  smsBowerMailId?: string;
  smsBowerMailRoot?: string;
  smsBowerMailCost?: number;
  smsBowerMailClosedAt?: string;
  smsBowerMailCloseStatus?: number;
  smsBowerFissionChildrenRemaining?: number;
  smsBowerFissionChildrenCreatedAt?: string;
  smsBowerFissionParentEmailId?: string;
  smsBowerMailUsedCodes?: string[];
  emailnatorSessionCookie?: string;
  emailnatorXsrfToken?: string;
  emailnatorBaseUrl?: string;
  emailnatorUsedCodes?: string[];
  emailnatorUsedMessageIds?: string[];
  emailnatorBaselineMessageIds?: string[];
}

interface SmsBowerAccountSnapshot {
  enabled: boolean;
  apiKeyPresent: boolean;
  apiKeyMasked: string;
  ok: boolean;
  balance?: number;
  currency: string;
  localSpend: number;
  rentedCount: number;
  closedCount: number;
  fetchedAt: string;
  error?: string;
}

interface K12WorkspaceResult {
  workspaceId: string;
  route: K12Route;
  ok: boolean;
  status: number;
  body: string;
  attempt: number;
}

interface TaskLog {
  at: string;
  level: LogLevel;
  message: string;
}

interface K12Task {
  id: string;
  kind?: TaskKind;
  emailId: string;
  email: string;
  status: TaskStatus;
  route: K12Route;
  workspaceIds: string[];
  runWorkspaceJoin: boolean;
  runSub2Api: boolean;
  sub2apiNoRtMode?: boolean;
  sub2apiGroupName: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
  notBefore?: string;
  cancelRequested?: boolean;
  error?: string;
  accessToken?: string;
  accessTokenHash?: string;
  accessTokenPreview?: string;
  accessTokenEmail?: string;
  accessTokenExpiresAt?: string;
  accessTokenLiveness?: "unknown" | "alive" | "inactive" | "banned" | "error";
  accessTokenLivenessStatus?: number;
  accessTokenLivenessMessage?: string;
  accessTokenLivenessCheckedAt?: string;
  workspaceResults: K12WorkspaceResult[];
  sub2apiAccount?: string;
  jsonOutFile?: string;
  jsonOutFormat?: JsonOutFormat;
  waitingOtp?: boolean;
  waitingOtpLabel?: string;
  waitingOtpEmail?: string;
  waitingOtpSince?: string;
  freshEmailOtpOnlyOnce?: boolean;
  smsBowerFissionRemainingAfterThis?: number;
  otpMode?: EmailOtpMode;
  smsBowerMailRoot?: string;
  smsBowerAutoReplaceOnFailure?: boolean;
  smsBowerReplacementRemaining?: number;
  smsBowerReplacementSourceTaskId?: string;
  smsBowerBatchId?: string;
  smsBowerBatchTargetSuccesses?: number;
  logs: TaskLog[];
}

interface ParsedEmailLine {
  email: string;
  otpMode?: EmailOtpMode;
  password: string;
  mailboxUrl: string;
  clientId?: string;
  refreshToken?: string;
  raw: string;
}

interface Sub2ApiRefillResult {
  checkedAt: string;
  source: "manual" | "timer";
  groupName: string;
  groupLabel: string;
  threshold: number;
  refillEmailCount: number;
  deepCheckEnabled: boolean;
  totalAccounts: number;
  matchedAccounts: number;
  basicNormalAccounts: number;
  normalAccounts: number;
  deepChecked: number;
  deepOk: number;
  deepFailed: number;
  pendingTasks: number;
  availableEmails: number;
  shouldRefill: boolean;
  createdTasks: number;
  skippedRunning: number;
  missing: number;
  prunedTasks?: number;
  clearedSub2Links?: number;
  message: string;
  samples: string[];
}

interface Sub2ApiRefillHistoryEntry extends Partial<Sub2ApiRefillResult> {
  id: string;
  checkedAt: string;
  ok: boolean;
  source: "manual" | "timer";
  message: string;
  error?: string;
}

interface Sub2ApiAutoAtRepairResult {
  checkedAt: string;
  source: "manual" | "timer";
  groupName: string;
  groupLabel: string;
  scannedAccounts: number;
  issueAccounts: number;
  matchedEmails: number;
  createdTasks: number;
  skippedRunning: number;
  skippedUnmatched: number;
  skippedTerminal: number;
  prunedTasks?: number;
  clearedSub2Links?: number;
  message: string;
  samples: string[];
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const dataDir = path.join(rootDir, "data");
const configFile = path.join(dataDir, "config.json");
const emailsFile = path.join(dataDir, "emails.json");
const tasksFile = path.join(dataDir, "tasks.json");
const sub2apiRefillHistoryFile = path.join(dataDir, "sub2api-refill-history.json");
const workspaceBlocksFile = path.join(dataDir, "workspace-blocks.json");
const compatConfigFile = path.join(rootDir, "config.json");
const defaultJsonOutDir = path.join(rootDir, "json");

const DEFAULT_REFERENCE_BUNDLE = rootDir;
const DEFAULT_WORKSPACE_ID = "631e1603-06cf-4f0b-b79b-d09fbfcfe98d";
const CHATGPT_BASE_URL = "https://chatgpt.com";
const AUTH_BASE_URL = "https://auth.openai.com";
const AUTH_EMAIL_OTP_SEND_URL = `${AUTH_BASE_URL}/api/accounts/email-otp/send`;
const AUTH_PASSWORDLESS_SEND_OTP_URL = `${AUTH_BASE_URL}/api/accounts/passwordless/send-otp`;
const AUTH_CREATE_ACCOUNT_PASSWORD_URL = `${AUTH_BASE_URL}/create-account/password`;
const AUTH_ABOUT_YOU_URL = `${AUTH_BASE_URL}/about-you`;
const AUTH_WORKSPACE_URL = `${AUTH_BASE_URL}/workspace`;
const AUTH_WORKSPACE_SELECT_URL = `${AUTH_BASE_URL}/api/accounts/workspace/select`;
const AUTH_CHOOSE_ACCOUNT_URL = `${AUTH_BASE_URL}/choose-an-account`;
const CODEX_CONSENT_URL = `${AUTH_BASE_URL}/sign-in-with-chatgpt/codex/consent`;
const DEFAULT_OAUTH_REDIRECT_URI = "http://localhost:1455/auth/callback";
const CHATGPT_ACCOUNTS_CHECK_PATH = "/backend-api/accounts/check/v4-2023-04-27";
const CHATGPT_CODEX_RESPONSES_URL = `${CHATGPT_BASE_URL}/backend-api/codex/responses`;
const DEFAULT_AT_LIVENESS_MODEL = "gpt-5.5";
const MANUAL_OTP_TIMEOUT_MS = 15 * 60 * 1000;
const DEFAULT_SMSBOWER_MAIL_BASE_URL = "https://smsbower.page/api/mail";
const DEFAULT_SMSBOWER_HANDLER_URL = "https://smsbower.page/stubs/handler_api.php";
const DEFAULT_EMAILNATOR_BASE_URL = "https://www.emailnator.com";
const DEFAULT_SMSBOWER_AUTO_REPLACEMENT_LIMIT = 1;
const SMSBOWER_CODE_MAX_ATTEMPTS = 30;
const POOL_FISSION_CHILD_COOLDOWN_MS = DEFAULT_POOL_FISSION_CHILD_COOLDOWN_MS;
const POOL_FISSION_MAILBOX_OTP_COOLDOWN_MS = DEFAULT_POOL_FISSION_MAILBOX_OTP_COOLDOWN_MS;
const K12_WORKSPACE_SWITCH_TOKEN_RETRIES = 6;
const SENTINEL_SDK_URL = "https://sentinel.openai.com/sentinel/20260219f9f6/sdk.js";
const SENTINEL_SDK_PATCH_HOOK = "t.init=we,t.sessionObserverToken=async function(t){";
const sentinelSdkFile = path.join(rootDir, "sdk.js");

let appConfig: AppConfig;
let emails: EmailRecord[] = [];
let tasks: K12Task[] = [];
let sub2apiRefillHistory: Sub2ApiRefillHistoryEntry[] = [];
let workspaceBlocks: WorkspaceBlockRecord[] = [];
let activeWorkers = 0;
const manualOtpWaiters = new Map<string, {resolve: (code: string) => void; reject: (error: Error) => void; expiresAt: number}>();
let sub2apiRefillTimer: ReturnType<typeof setInterval> | undefined;
let taskScheduleTimer: ReturnType<typeof setTimeout> | undefined;
let sub2apiRefillRunning = false;
let sub2apiRefillLastCheckedAt = "";
let sub2apiRefillNextCheckAt = "";
let sub2apiRefillLastError = "";
let sub2apiRefillLastResult: Sub2ApiRefillResult | null = null;
let sub2apiAutoAtRepairRunning = false;
let sub2apiAutoAtRepairLastCheckedAt = "";
let sub2apiAutoAtRepairLastError = "";
let sub2apiAutoAtRepairLastResult: Sub2ApiAutoAtRepairResult | null = null;

function nowIso(): string {
  return new Date().toISOString();
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback;
}

function asBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const text = value.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(text)) return true;
    if (["0", "false", "no", "off"].includes(text)) return false;
  }
  return fallback;
}

function asNumber(value: unknown, fallback: number, min = Number.NEGATIVE_INFINITY, max = Number.POSITIVE_INFINITY): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function parseStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  return String(value ?? "")
    .split(/[\r\n,;，；]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function uniqueStringList(values: string[]): string[] {
  return Array.from(new Set(values.map((item) => item.trim()).filter(Boolean)));
}

function parseSub2ApiGroupNames(value: unknown): string[] {
  const source = Array.isArray(value)
    ? value.flatMap((item) => parseStringList(item))
    : parseStringList(value);
  const names = uniqueStringList(source);
  return names.length ? names : ["k12"];
}

function primarySub2ApiGroupName(value: unknown): string {
  return parseSub2ApiGroupNames(value)[0] || "k12";
}

function normalizePositiveId(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function normalizeJsonOutFormat(value: unknown): JsonOutFormat {
  return String(value || "").trim().toLowerCase() === "cpa" ? "cpa" : "sub2api";
}

function normalizeGmailMailProvider(value: unknown): GmailMailProvider {
  return String(value || "").trim().toLowerCase() === "emailnator" ? "emailnator" : "smsbower";
}

function randomItem<T>(items: T[]): T | undefined {
  if (!items.length) return undefined;
  return items[Math.floor(Math.random() * items.length)];
}

function maskSecret(value: string, head = 4, tail = 4): string {
  const text = String(value || "");
  if (!text) return "";
  if (text.length <= head + tail + 3) return `${text.slice(0, Math.min(2, text.length))}***`;
  return `${text.slice(0, head)}...${text.slice(-tail)}`;
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function tokenPreview(token: string): string {
  if (!token) return "";
  return token.length <= 24 ? maskSecret(token, 8, 6) : `${token.slice(0, 18)}...${token.slice(-10)}`;
}

function stableId(value: string): string {
  return createHash("sha1").update(value.toLowerCase()).digest("hex").slice(0, 16);
}

function decodeJwtPayload(token: string): Record<string, unknown> {
  const part = token.split(".")[1] || "";
  if (!part) return {};
  const normalized = part.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  try {
    return JSON.parse(Buffer.from(padded, "base64").toString("utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function decodeBase64UrlJson(value: string): unknown {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return JSON.parse(Buffer.from(padded, "base64").toString("utf8")) as unknown;
}

function summarizeToken(token: string): {hash: string; preview: string; email: string; expiresAt: string; accountId: string; planType: string} {
  const payload = decodeJwtPayload(token);
  const profile = (payload["https://api.openai.com/profile"] || {}) as Record<string, unknown>;
  const auth = (payload["https://api.openai.com/auth"] || {}) as Record<string, unknown>;
  const exp = Number(payload.exp || 0);
  return {
    hash: tokenHash(token),
    preview: tokenPreview(token),
    email: asString(profile.email || payload.email),
    expiresAt: exp > 0 ? new Date(exp * 1000).toISOString() : "",
    accountId: asString(auth.chatgpt_account_id),
    planType: asString(auth.chatgpt_plan_type),
  };
}

function oauthBrowserHeaders(client: any, extra: Record<string, string> = {}): Record<string, string> {
  const profile = client?.deviceProfile || {};
  const hints = client?.clientHints || {};
  return {
    accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "accept-language": profile.acceptLanguage || "zh-CN,zh;q=0.9,en;q=0.8",
    "user-agent": client?.userAgent || "Mozilla/5.0 K12SpaceConsole/0.1",
    ...(hints.secChUa ? {"sec-ch-ua": hints.secChUa} : {}),
    ...(hints.secChUaFullVersionList ? {"sec-ch-ua-full-version-list": hints.secChUaFullVersionList} : {}),
    ...(hints.secChUaMobile ? {"sec-ch-ua-mobile": hints.secChUaMobile} : {}),
    ...(hints.secChUaPlatform ? {"sec-ch-ua-platform": hints.secChUaPlatform} : {}),
    ...(hints.secChUaPlatformVersion ? {"sec-ch-ua-platform-version": hints.secChUaPlatformVersion} : {}),
    ...(hints.secChViewportWidth ? {"sec-ch-viewport-width": hints.secChViewportWidth} : {}),
    ...extra,
  };
}

async function readJson<T>(filePath: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as T;
  } catch {
    return fallback;
  }
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeJsonAtomic(filePath, value);
}

function buildDownloadFetchOptions(): {dispatcher?: ProxyAgent} {
  const proxyUrl = appConfig?.defaultProxyUrl || process.env.DEFAULT_PROXY_URL || process.env.OPENAI_PROXY_URL || "";
  if (!proxyUrl || proxyUrl === "direct") return {};
  return {dispatcher: new ProxyAgent(proxyUrl)};
}

async function ensureSentinelSdk(): Promise<void> {
  try {
    const existing = await readFile(sentinelSdkFile, "utf8");
    if (existing.includes(SENTINEL_SDK_PATCH_HOOK)) return;
    console.warn("本地 sdk.js 存在但版本不匹配，准备重新下载 Sentinel SDK");
  } catch {
    // Missing sdk.js is expected on first start.
  }

  console.log(`下载 Sentinel SDK: ${SENTINEL_SDK_URL}`);
  const response = await undiciFetch(SENTINEL_SDK_URL, {
    ...buildDownloadFetchOptions(),
    headers: {
      accept: "application/javascript,*/*;q=0.8",
      "user-agent": "Mozilla/5.0 K12SpaceConsole/0.1",
    },
  });
  if (!response.ok) {
    throw new Error(`下载 Sentinel SDK 失败: HTTP ${response.status}`);
  }
  const source = await response.text();
  if (!source.includes(SENTINEL_SDK_PATCH_HOOK)) {
    throw new Error("下载的 Sentinel SDK 不含预期 patch hook，可能版本已更新");
  }
  await writeFile(sentinelSdkFile, source, "utf8");
  console.log(`Sentinel SDK 已缓存: ${sentinelSdkFile}`);
}

async function readReferenceConfig(referenceBundlePath: string): Promise<Record<string, unknown>> {
  const refConfigPath = path.join(referenceBundlePath, "codex_register", "config.json");
  return readJson<Record<string, unknown>>(refConfigPath, {});
}

async function defaultConfig(): Promise<AppConfig> {
  const referenceBundlePath = DEFAULT_REFERENCE_BUNDLE;
  const ref = await readReferenceConfig(referenceBundlePath);
  const tokenOut = path.join(rootDir, "pool_tokens.txt");
  return {
    port: asNumber(process.env.PORT, 8796, 1, 65535),
    referenceBundlePath,
    defaultPassword: asString(ref.defaultPassword, "ChangeMe123!"),
    defaultProxyUrl: asString(ref.defaultProxyUrl, ""),
    openaiFetchTimeoutMs: 45000,
    mailApiBaseUrl: asString(ref.mailApiBaseUrl, ""),
    workspaceIds: [DEFAULT_WORKSPACE_ID],
    route: "request",
    joinIntervalMs: 1500,
    joinMaxRetries: 2,
    taskConcurrency: 1,
    runWorkspaceJoin: true,
    runSub2Api: true,
    sub2apiNoRtMode: false,
    sub2apiUrl: asString(ref.sub2apiUrl, ""),
    sub2apiEmail: asString(ref.sub2apiEmail, ""),
    sub2apiPassword: asString(ref.sub2apiPassword, ""),
    sub2apiGroupName: "k12",
    sub2apiProxyName: asString(ref.sub2apiProxyName, ""),
    sub2apiAccountPriority: asNumber(ref.sub2apiAccountPriority, 1, 1),
    sub2apiConcurrency: asNumber(ref.sub2apiConcurrency, 10, 1),
    sub2apiAutoRefillEnabled: false,
    sub2apiAutoAtRepairEnabled: false,
    sub2apiRefillGroupName: "k12",
    sub2apiRefillThreshold: 5,
    sub2apiRefillEmailCount: 5,
    sub2apiRefillIntervalMs: 5 * 60 * 1000,
    sub2apiRefillDeepCheckEnabled: false,
    gmailMailProvider: "smsbower",
    smsBowerMailEnabled: false,
    smsBowerApiKey: "",
    smsBowerMailBaseUrl: DEFAULT_SMSBOWER_MAIL_BASE_URL,
    smsBowerMailService: "openai",
    smsBowerMailDomain: "gmail.com",
    smsBowerMailMaxPrice: "",
    smsBowerGmailFissionEnabled: false,
    smsBowerGmailFissionCount: 1,
    poolFissionMailboxOtpCooldownMs: DEFAULT_POOL_FISSION_MAILBOX_OTP_COOLDOWN_MS,
    emailnatorBaseUrl: DEFAULT_EMAILNATOR_BASE_URL,
    emailnatorEmailType: "plusGmail",
    requireChatgptAccountId: true,
    tokenOut,
    jsonOutDir: defaultJsonOutDir,
    jsonOutFormat: "sub2api",
  };
}

async function loadConfig(): Promise<AppConfig> {
  const base = await defaultConfig();
  const saved = await readJson<Partial<AppConfig>>(configFile, {});
  return normalizeConfig({
    ...base,
    ...saved,
    sub2apiAutoAtRepairEnabled: "sub2apiAutoAtRepairEnabled" in saved
      ? saved.sub2apiAutoAtRepairEnabled
      : saved.sub2apiAutoRefillEnabled,
  });
}

function normalizeConfig(raw: Partial<AppConfig>): AppConfig {
  const parsedWorkspaceIds = parseStringList(raw.workspaceIds);
  const workspaceIds = Object.prototype.hasOwnProperty.call(raw, "workspaceIds")
    ? parsedWorkspaceIds
    : [DEFAULT_WORKSPACE_ID];
  const route = raw.route === "accept" ? "accept" : "request";
  return {
    port: asNumber(raw.port, 8796, 1, 65535),
    referenceBundlePath: DEFAULT_REFERENCE_BUNDLE,
    defaultPassword: String(raw.defaultPassword || "ChangeMe123!"),
    defaultProxyUrl: asString(raw.defaultProxyUrl),
    openaiFetchTimeoutMs: asNumber(raw.openaiFetchTimeoutMs, 45000, 5000, 300000),
    mailApiBaseUrl: asString(raw.mailApiBaseUrl),
    workspaceIds,
    route,
    joinIntervalMs: asNumber(raw.joinIntervalMs, 1500, 0, 600000),
    joinMaxRetries: asNumber(raw.joinMaxRetries, 2, 0, 10),
    taskConcurrency: asNumber(raw.taskConcurrency, 1, 1, 10),
    runWorkspaceJoin: asBoolean(raw.runWorkspaceJoin, true),
    runSub2Api: asBoolean(raw.runSub2Api, true),
    sub2apiNoRtMode: asBoolean(raw.sub2apiNoRtMode, false),
    sub2apiUrl: asString(raw.sub2apiUrl),
    sub2apiEmail: asString(raw.sub2apiEmail),
    sub2apiPassword: String(raw.sub2apiPassword || ""),
    sub2apiGroupName: asString(raw.sub2apiGroupName, "k12") || "k12",
    sub2apiProxyName: asString(raw.sub2apiProxyName),
    sub2apiAccountPriority: asNumber(raw.sub2apiAccountPriority, 1, 1),
    sub2apiConcurrency: asNumber(raw.sub2apiConcurrency, 10, 1),
    sub2apiAutoRefillEnabled: asBoolean(raw.sub2apiAutoRefillEnabled, false),
    sub2apiAutoAtRepairEnabled: asBoolean(raw.sub2apiAutoAtRepairEnabled, false),
    sub2apiRefillGroupName: asString(raw.sub2apiRefillGroupName, raw.sub2apiGroupName || "k12") || "k12",
    sub2apiRefillThreshold: asNumber(raw.sub2apiRefillThreshold, 5, 0, 100000),
    sub2apiRefillEmailCount: asNumber(raw.sub2apiRefillEmailCount, 5, 1, 500),
    sub2apiRefillIntervalMs: asNumber(raw.sub2apiRefillIntervalMs, 5 * 60 * 1000, 10000, 24 * 60 * 60 * 1000),
    sub2apiRefillDeepCheckEnabled: asBoolean(raw.sub2apiRefillDeepCheckEnabled, false),
    gmailMailProvider: normalizeGmailMailProvider(raw.gmailMailProvider),
    smsBowerMailEnabled: asBoolean(raw.smsBowerMailEnabled, false),
    smsBowerApiKey: asString(raw.smsBowerApiKey),
    smsBowerMailBaseUrl: normalizeSmsBowerMailBaseUrl(raw.smsBowerMailBaseUrl),
    smsBowerMailService: asString(raw.smsBowerMailService, "openai") || "openai",
    smsBowerMailDomain: asString(raw.smsBowerMailDomain, "gmail.com") || "gmail.com",
    smsBowerMailMaxPrice: asString(raw.smsBowerMailMaxPrice),
    smsBowerGmailFissionEnabled: asBoolean(raw.smsBowerGmailFissionEnabled, false),
    smsBowerGmailFissionCount: asNumber(raw.smsBowerGmailFissionCount, 1, 1, 100),
    poolFissionMailboxOtpCooldownMs: asNumber(raw.poolFissionMailboxOtpCooldownMs, DEFAULT_POOL_FISSION_MAILBOX_OTP_COOLDOWN_MS, 0, 60 * 60 * 1000),
    emailnatorBaseUrl: normalizeEmailnatorBaseUrl(raw.emailnatorBaseUrl),
    emailnatorEmailType: normalizeEmailnatorEmailType(raw.emailnatorEmailType),
    requireChatgptAccountId: asBoolean(raw.requireChatgptAccountId, true),
    tokenOut: asString(raw.tokenOut) || path.join(rootDir, "pool_tokens.txt"),
    jsonOutDir: asString(raw.jsonOutDir) || defaultJsonOutDir,
    jsonOutFormat: normalizeJsonOutFormat(raw.jsonOutFormat),
  };
}

async function saveConfig(next: AppConfig): Promise<void> {
  appConfig = normalizeConfig(next);
  await writeJson(configFile, appConfig);
  await ensureCompatBundleConfig();
  configureSub2ApiRefillTimer();
}

async function removeUnavailableWorkspaceIdFromState(workspaceId: string, reason: string, currentTask?: K12Task): Promise<void> {
  const trimmed = workspaceId.trim();
  if (!trimmed) return;

  const previousConfigIds = appConfig.workspaceIds;
  const nextConfigIds = removeWorkspaceId(previousConfigIds, trimmed);
  const configChanged = nextConfigIds.length !== previousConfigIds.length;
  if (configChanged) {
    await saveConfig({...appConfig, workspaceIds: nextConfigIds});
  }

  let tasksChanged = false;
  const replacementIds = nextConfigIds;
  for (const task of tasks) {
    if (task.status !== "queued" && task.id !== currentTask?.id) continue;
    const nextTaskIds = removeWorkspaceId(task.workspaceIds, trimmed);
    if (nextTaskIds.length === task.workspaceIds.length) continue;
    task.workspaceIds = nextTaskIds.length ? nextTaskIds : replacementIds;
    task.updatedAt = nowIso();
    appendLog(task, "warn", `workspace ${trimmed.slice(0, 8)}... 不可用，已从任务候选删除: ${reason}`);
    if (!task.workspaceIds.length && task.status === "queued" && task.runWorkspaceJoin) {
      task.status = "failed";
      task.error = "没有可用 K12 workspace id，任务已停止";
      task.finishedAt = nowIso();
      appendLog(task, "error", task.error);
    }
    tasksChanged = true;
  }

  if (currentTask && configChanged) {
    appendLog(currentTask, "warn", `workspace ${trimmed.slice(0, 8)}... 不可用，已从全局配置删除`);
  }
  if (tasksChanged) await persistTasks();
}

function cancelTasksOutsideConfiguredWorkspaces(reason: string, configuredWorkspaceIds = appConfig.workspaceIds): number {
  let canceled = 0;
  for (const task of tasks) {
    if (task.status !== "queued" && task.status !== "running") continue;
    if (taskWorkspaceAllowed(task.workspaceIds, configuredWorkspaceIds)) continue;
    task.cancelRequested = true;
    task.status = "canceled";
    task.error = reason;
    task.finishedAt = nowIso();
    task.updatedAt = nowIso();
    task.waitingOtp = false;
    task.waitingOtpLabel = undefined;
    task.waitingOtpEmail = undefined;
    task.waitingOtpSince = undefined;
    cancelManualEmailOtp(task.id, reason);
    appendLog(task, "warn", reason);
    canceled += 1;
  }
  return canceled;
}

async function ensureCompatBundleConfig(): Promise<void> {
  const existing = await readJson<Record<string, unknown>>(compatConfigFile, {});
  await writeJson(compatConfigFile, {
    ...existing,
    provider: asString(existing.provider, "hotmail"),
    defaultPassword: appConfig.defaultPassword,
    defaultProxyUrl: appConfig.defaultProxyUrl,
    mailApiBaseUrl: appConfig.mailApiBaseUrl,
    sub2apiNoRtMode: appConfig.sub2apiNoRtMode,
    sub2apiUrl: appConfig.sub2apiUrl,
    sub2apiEmail: appConfig.sub2apiEmail,
    sub2apiPassword: appConfig.sub2apiPassword,
    sub2apiGroupName: primarySub2ApiGroupName(appConfig.sub2apiGroupName),
    sub2apiGroupNames: parseSub2ApiGroupNames(appConfig.sub2apiGroupName),
    sub2apiProxyName: appConfig.sub2apiProxyName,
    sub2apiAccountPriority: appConfig.sub2apiAccountPriority,
    sub2apiConcurrency: appConfig.sub2apiConcurrency,
    sub2apiAutoRefillEnabled: appConfig.sub2apiAutoRefillEnabled,
    sub2apiAutoAtRepairEnabled: appConfig.sub2apiAutoAtRepairEnabled,
    sub2apiRefillGroupName: appConfig.sub2apiRefillGroupName,
    sub2apiRefillThreshold: appConfig.sub2apiRefillThreshold,
    sub2apiRefillEmailCount: appConfig.sub2apiRefillEmailCount,
    sub2apiRefillIntervalMs: appConfig.sub2apiRefillIntervalMs,
    sub2apiRefillDeepCheckEnabled: appConfig.sub2apiRefillDeepCheckEnabled,
    gmailMailProvider: appConfig.gmailMailProvider,
    smsBowerMailEnabled: appConfig.smsBowerMailEnabled,
    smsBowerApiKey: appConfig.smsBowerApiKey,
    smsBowerMailBaseUrl: appConfig.smsBowerMailBaseUrl,
    smsBowerMailService: appConfig.smsBowerMailService,
    smsBowerMailDomain: appConfig.smsBowerMailDomain,
    smsBowerMailMaxPrice: appConfig.smsBowerMailMaxPrice,
    smsBowerGmailFissionEnabled: appConfig.smsBowerGmailFissionEnabled,
    smsBowerGmailFissionCount: appConfig.smsBowerGmailFissionCount,
    poolFissionMailboxOtpCooldownMs: appConfig.poolFissionMailboxOtpCooldownMs,
    emailnatorBaseUrl: appConfig.emailnatorBaseUrl,
    emailnatorEmailType: appConfig.emailnatorEmailType,
    jsonOutDir: appConfig.jsonOutDir,
    jsonOutFormat: appConfig.jsonOutFormat,
  });
}

function publicConfig(config = appConfig): Record<string, unknown> {
  return {
    ...config,
    defaultPassword: "",
    defaultPasswordPresent: Boolean(config.defaultPassword),
    defaultPasswordMasked: maskSecret(config.defaultPassword, 3, 3),
    sub2apiPassword: "",
    sub2apiPasswordPresent: Boolean(config.sub2apiPassword),
    sub2apiPasswordMasked: maskSecret(config.sub2apiPassword, 3, 3),
    smsBowerApiKey: "",
    smsBowerApiKeyPresent: Boolean(config.smsBowerApiKey),
    smsBowerApiKeyMasked: maskSecret(config.smsBowerApiKey, 4, 4),
  };
}

function buildMicrosoftMailboxUrl(baseUrl: string, email: string, clientId: string, refreshToken: string): string {
  const trimmed = baseUrl.trim();
  if (!trimmed) throw new Error("mailApiBaseUrl 为空，无法为四段邮箱生成接码 URL");
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  const url = new URL(withProtocol);
  if (!url.pathname || url.pathname === "/") {
    url.pathname = "/api/GetLastEmails";
  } else if (!url.pathname.endsWith("/api/GetLastEmails")) {
    url.pathname = `${url.pathname.replace(/\/+$/g, "")}/api/GetLastEmails`;
  }
  url.searchParams.set("email", email);
  url.searchParams.set("clientId", clientId);
  url.searchParams.set("refreshToken", refreshToken);
  url.searchParams.set("num", "2");
  url.searchParams.set("boxType", "1");
  return url.toString();
}

function parseEmailLine(line: string, config = appConfig): ParsedEmailLine | null {
  const raw = line.trim();
  if (!raw || raw.startsWith("#")) return null;
  const parts = raw.split(/\s*-{4,}\s*|\t|,/).map((item) => item.trim()).filter(Boolean);
  const email = parts.find((item) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(item)) || "";
  if (!email) return null;
  const emailIndex = parts.findIndex((item) => item.toLowerCase() === email.toLowerCase());
  const tail = emailIndex >= 0 ? parts.slice(emailIndex + 1) : parts.slice(1);
  const directMailboxUrl = parts.find((item) => /^https?:\/\//i.test(item)) || "";
  let password = tail.find((item) => item && !/^https?:\/\//i.test(item)) || config.defaultPassword;
  let mailboxUrl = directMailboxUrl;
  let clientId = "";
  let refreshToken = "";

  if (!mailboxUrl && tail.length >= 3) {
    password = tail[0] || password;
    clientId = tail[1] || "";
    refreshToken = tail.slice(2).join("----");
    if (clientId && refreshToken) {
      mailboxUrl = buildMicrosoftMailboxUrl(config.mailApiBaseUrl, email, clientId, refreshToken);
    }
  }

  if (!mailboxUrl) return null;
  return {email, password, mailboxUrl, clientId, refreshToken, raw};
}

function parseManualEmailLine(line: string, config = appConfig): ParsedEmailLine | null {
  const raw = line.trim();
  if (!raw || raw.startsWith("#")) return null;
  const match = raw.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  const email = match?.[0] || "";
  if (!email) return null;
  const parts = raw.split(/\s*-{4,}\s*|\t|,/).map((item) => item.trim()).filter(Boolean);
  const emailIndex = parts.findIndex((item) => item.toLowerCase() === email.toLowerCase());
  const tail = emailIndex >= 0 ? parts.slice(emailIndex + 1) : parts.slice(1);
  const password = tail.find((item) => item && !/^https?:\/\//i.test(item) && item.toLowerCase() !== "manual") || config.defaultPassword;
  return {email, otpMode: "manual", password, mailboxUrl: "", raw};
}

function normalizeSmsBowerMailBaseUrl(value: unknown): string {
  const raw = asString(value, DEFAULT_SMSBOWER_MAIL_BASE_URL) || DEFAULT_SMSBOWER_MAIL_BASE_URL;
  try {
    const url = new URL(raw);
    if (url.hostname === "smsbower.app") url.hostname = "smsbower.page";
    let pathname = url.pathname.replace(/\/+$/g, "");
    if (!pathname || pathname === "/") pathname = "/api/mail";
    if (/\/api\/mailRent$/i.test(pathname)) pathname = pathname.replace(/\/api\/mailRent$/i, "/api/mail");
    if (!/\/api\/mail$/i.test(pathname)) {
      if (/\/api$/i.test(pathname)) pathname = `${pathname}/mail`;
      else if (!/\/(?:getActivation|getCode|setStatus)$/i.test(pathname)) pathname = "/api/mail";
    }
    pathname = pathname.replace(/\/(?:getActivation|getCode|setStatus)$/i, "");
    url.pathname = pathname || "/api/mail";
    url.search = "";
    return url.toString().replace(/\/$/g, "");
  } catch {
    return DEFAULT_SMSBOWER_MAIL_BASE_URL;
  }
}

function normalizeEmailnatorBaseUrl(value: unknown): string {
  const raw = asString(value, DEFAULT_EMAILNATOR_BASE_URL) || DEFAULT_EMAILNATOR_BASE_URL;
  try {
    const url = new URL(raw);
    url.pathname = "";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/g, "");
  } catch {
    return DEFAULT_EMAILNATOR_BASE_URL;
  }
}

function normalizeEmailnatorEmailType(value: unknown): string {
  const text = asString(value, "plusGmail").trim();
  const allowed = new Set(["domain", "plusGmail", "dotGmail", "googleMail"]);
  return allowed.has(text) ? text : "plusGmail";
}

function smsBowerMailActionPath(action: string): string {
  if (action === "getActivation") return "getActivation";
  if (action === "getCode") return "getCode";
  if (action === "setStatus") return "setStatus";
  if (action === "getBalance") return "getBalance";
  return action.replace(/^\/+/g, "");
}

function smsBowerMailServiceCode(value: unknown): string {
  const service = asString(value, "openai").toLowerCase();
  if (!service || service === "openai" || service === "chatgpt" || service === "chat-gpt" || service === "oa") {
    return "dr";
  }
  return service;
}

function buildSmsBowerMailUrl(action: string, params: Record<string, string | number | undefined> = {}): URL {
  const base = normalizeSmsBowerMailBaseUrl(appConfig.smsBowerMailBaseUrl);
  const url = new URL(`${base}/${smsBowerMailActionPath(action)}`);
  url.searchParams.set("api_key", appConfig.smsBowerApiKey);
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === "") continue;
    url.searchParams.set(key, String(value));
  }
  return url;
}

function buildSmsBowerHandlerUrl(action: string, params: Record<string, string | number | undefined> = {}): URL {
  const url = new URL(DEFAULT_SMSBOWER_HANDLER_URL);
  url.searchParams.set("api_key", appConfig.smsBowerApiKey);
  url.searchParams.set("action", action);
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === "") continue;
    url.searchParams.set(key, String(value));
  }
  return url;
}

async function requestSmsBowerMail(action: string, params: Record<string, string | number | undefined> = {}): Promise<unknown> {
  if (!appConfig.smsBowerApiKey) throw new Error("SMSBower API Key 未配置");
  const url = buildSmsBowerMailUrl(action, params);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(url, {signal: controller.signal});
    const text = await response.text();
    let payload: unknown = text;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = text;
    }
    if (!response.ok) throw new Error(`SMSBower ${action} HTTP ${response.status}: ${text.slice(0, 300)}`);
    if (typeof payload === "string" && /^(BAD_|NO_|ERROR|STATUS_CANCEL)/i.test(payload.trim())) {
      throw new Error(`SMSBower ${action} 失败: ${payload.trim()}`);
    }
    if (payload && typeof payload === "object") {
      const record = payload as Record<string, unknown>;
      const status = String(record.status ?? record.code ?? "").trim().toLowerCase();
      const message = asString(record.message || record.error || record.error_msg || record.msg);
      if ((status === "0" || status === "false" || status === "error") && message) {
        throw new Error(`SMSBower ${action} 失败: ${message}`);
      }
    }
    return payload;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw new Error(`SMSBower ${action} 请求超时`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function requestSmsBowerHandler(action: string, params: Record<string, string | number | undefined> = {}): Promise<unknown> {
  if (!appConfig.smsBowerApiKey) throw new Error("SMSBower API Key 未配置");
  const url = buildSmsBowerHandlerUrl(action, params);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(url, {signal: controller.signal});
    const text = await response.text();
    let payload: unknown = text;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = text;
    }
    if (!response.ok) throw new Error(`SMSBower ${action} HTTP ${response.status}: ${text.slice(0, 300)}`);
    if (typeof payload === "string" && /^(BAD_|NO_|ERROR|STATUS_CANCEL)/i.test(payload.trim())) {
      throw new Error(`SMSBower ${action} 失败: ${payload.trim()}`);
    }
    return payload;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw new Error(`SMSBower ${action} 请求超时`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function unwrapSmsBowerPayload(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== "object") return {};
  const record = payload as Record<string, unknown>;
  for (const key of ["data", "result", "activation", "mail", "item"]) {
    const value = record[key];
    if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  }
  return record;
}

function parseSmsBowerActivation(payload: unknown): {id: string; email: string} {
  if (typeof payload === "string") {
    const text = payload.trim();
    const match = text.match(/^(?:ACCESS_[A-Z_]+|ACCESS):([^:]+):(.+@[^\s:]+)$/i)
      || text.match(/^([^:]+):(.+@[^\s:]+)$/);
    if (match) return {id: match[1].trim(), email: match[2].trim()};
  }
  const record = unwrapSmsBowerPayload(payload);
  const stringValue = (value: unknown) => value === undefined || value === null ? "" : String(value).trim();
  const id = stringValue(record.id || record.activation_id || record.activationId || record.mail_id || record.mailId);
  const email = stringValue(record.email || record.mail || record.address || record.login);
  if (!id || !email) throw new Error(`SMSBower 获取邮箱返回格式异常: ${JSON.stringify(payload).slice(0, 500)}`);
  return {id, email};
}

function finiteNumber(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function extractSmsBowerBalance(payload: unknown): number | undefined {
  if (typeof payload === "number") return Number.isFinite(payload) ? payload : undefined;
  if (typeof payload === "string") {
    const match = payload.match(/ACCESS_BALANCE[:：]\s*(-?\d+(?:\.\d+)?)/i) ?? payload.match(/-?\d+(?:\.\d+)?/);
    if (!match) return undefined;
    return finiteNumber(match[1] ?? match[0]);
  }
  if (!payload || typeof payload !== "object") return undefined;
  const record = payload as Record<string, unknown>;
  for (const key of ["balance", "Balance", "BALANCE", "money", "amount", "credits"]) {
    if (key in record) {
      const value = finiteNumber(record[key]);
      if (value !== undefined) return value;
    }
  }
  return extractSmsBowerBalance(record.data);
}

function extractSmsBowerCost(payload: unknown): number | undefined {
  if (typeof payload === "string") {
    const match = payload.match(/(?:cost|price|amount|价格|成本)[:=：]\s*(-?\d+(?:\.\d+)?)/i);
    return match ? finiteNumber(match[1]) : undefined;
  }
  const record = unwrapSmsBowerPayload(payload);
  for (const key of ["cost", "price", "amount", "activationCost", "activation_cost", "mailCost", "mail_cost"]) {
    const value = finiteNumber(record[key]);
    if (value !== undefined) return value;
  }
  return undefined;
}

function extractVerificationCode(payload: unknown): string {
  if (typeof payload === "string") {
    const text = payload.trim();
    const statusMatch = text.match(/STATUS_OK:?\s*([0-9]{4,8})/i);
    if (statusMatch) return statusMatch[1];
    const codeMatch = text.match(/\b([0-9]{6})\b/);
    return codeMatch?.[1] || "";
  }
  const record = unwrapSmsBowerPayload(payload);
  for (const key of ["code", "sms", "text", "body", "message", "value"]) {
    const value = asString(record[key]);
    const match = value.match(/\b([0-9]{6})\b/);
    if (match) return match[1];
  }
  return "";
}

function extractVerificationCodeFromText(value: unknown): string {
  const text = String(value || "");
  if (!isLikelyOpenAIOtpText(text)) return "";
  const plainText = htmlToPlainText(text);
  const patterns = [
    /\b(?:OpenAI|ChatGPT|verification|security|login|sign[-\s]?in|code|验证码)\b[\s\S]{0,180}?\b([0-9][0-9\s-]{4,12}[0-9])\b/i,
    /\b([0-9][0-9\s-]{4,12}[0-9])\b[\s\S]{0,120}?\b(?:OpenAI|ChatGPT|verification|security|login|sign[-\s]?in|code|验证码)\b/i,
    /\b(?:enter|use)\s+(?:this\s+)?(?:temporary\s+)?(?:verification\s+)?code(?:\s+to\s+continue)?\s*:?\s*([0-9]{6})\b/i,
    /\b(?:temporary\s+)?verification\s+code(?:\s+to\s+continue)?\s*:?\s*([0-9]{6})\b/i,
    /\b(?:code|验证码|确认码)[^\d]{0,80}([0-9]{6})\b/i,
  ];
  for (const candidate of [plainText, text]) {
    for (const pattern of patterns) {
      const match = candidate.match(pattern);
      if (!match) continue;
      const code = match[1].replace(/\D/g, "");
      if (code.length === 6) return code;
    }
  }
  const plainCodes = Array.from(new Set((plainText.match(/\b[0-9]{6}\b/g) || [])));
  if (plainCodes.length === 1) return plainCodes[0];
  return "";
}

function decodeBasicHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, num: string) => String.fromCodePoint(parseInt(num, 10)));
}

function htmlToPlainText(value: string): string {
  const withoutNoise = value
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|td|tr|table|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  return decodeBasicHtmlEntities(withoutNoise).replace(/\s+/g, " ").trim();
}

function extractLooseVerificationCodeFromText(value: unknown): string {
  const text = String(value || "");
  for (const pattern of [
    /\b(?:OpenAI|ChatGPT|verification|security|login|sign[-\s]?in|code|验证码)\b[\s\S]{0,180}?\b([0-9][0-9\s-]{4,12}[0-9])\b/i,
    /\b([0-9][0-9\s-]{4,12}[0-9])\b[\s\S]{0,120}?\b(?:OpenAI|ChatGPT|verification|security|login|sign[-\s]?in|code|验证码)\b/i,
    /\b([0-9]{6})\b/,
  ]) {
    const match = text.match(pattern);
    if (!match) continue;
    const code = match[1].replace(/\D/g, "");
    if (code.length === 6) return code;
  }
  return "";
}

function isLikelyOpenAIOtpText(value: unknown): boolean {
  return /openai|chatgpt|verification|verify|security|login|sign[-\s]?in|code|验证码|确认码|登录/i.test(String(value || ""));
}

function isLikelyEmailnatorOpenAIMessage(item: {from: string; subject: string}): boolean {
  return isLikelyOpenAIOtpText(`${item.from}\n${item.subject}`) && /openai|chatgpt/i.test(`${item.from}\n${item.subject}`);
}

function maskOtpCode(code: string): string {
  return code.length <= 2 ? "**" : `${code.slice(0, 2)}****`;
}

function parseSmsBowerTimestamp(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return undefined;
    return value > 1_000_000_000_000 ? value : value * 1000;
  }
  const text = String(value).trim();
  if (!text) return undefined;
  if (/^\d{10,13}$/.test(text)) return parseSmsBowerTimestamp(Number(text));
  const withOffset = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?\s*(?:GMT|UTC)?\s*([+-])(\d{1,2})(?::?(\d{2}))?$/i);
  if (withOffset) {
    const [, y, mo, d, h, mi, s = "0", sign, oh, om = "0"] = withOffset;
    const offsetMinutes = (Number(oh) * 60 + Number(om)) * (sign === "+" ? 1 : -1);
    return Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s)) - offsetMinutes * 60_000;
  }
  if (/(?:Z|GMT|UTC|[+-]\d{2}:?\d{2})$/i.test(text)) {
    const parsed = Date.parse(text.replace(" ", "T"));
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function extractSmsBowerCodeArrivalMs(payload: unknown): number | undefined {
  const record = unwrapSmsBowerPayload(payload);
  for (const key of [
    "arrivedAt",
    "arrivalAt",
    "receivedAt",
    "createdAt",
    "updatedAt",
    "arrival_time",
    "arrive_time",
    "received_at",
    "created_at",
    "updated_at",
    "date",
    "time",
    "timestamp",
  ]) {
    const parsed = parseSmsBowerTimestamp(record[key]);
    if (parsed !== undefined) return parsed;
  }
  return undefined;
}

async function getSmsBowerAccountSnapshot(): Promise<SmsBowerAccountSnapshot> {
  const apiKeyPresent = Boolean(appConfig.smsBowerApiKey);
  const base = {
    enabled: appConfig.smsBowerMailEnabled,
    apiKeyPresent,
    apiKeyMasked: maskSecret(appConfig.smsBowerApiKey, 4, 4),
    currency: "USD",
    ...smsBowerLocalSpendSummary(),
    fetchedAt: nowIso(),
  };
  if (!apiKeyPresent) {
    return {...base, ok: false, error: "SMSBower API Key 未设置"};
  }
  try {
    const payload = await requestSmsBowerHandler("getBalance");
    const balance = extractSmsBowerBalance(payload);
    if (balance === undefined) {
      const text = typeof payload === "string" ? payload : JSON.stringify(payload);
      throw new Error(`无法解析余额: ${String(text || "").slice(0, 160)}`);
    }
    return {...base, ok: true, balance};
  } catch (error) {
    return {...base, ok: false, error: error instanceof Error ? error.message : String(error)};
  }
}

function smsBowerLocalSpendSummary(): {localSpend: number; rentedCount: number; closedCount: number} {
  const roots = new Map<string, EmailRecord>();
  for (const email of emails) {
    if (!email.smsBowerMailId) continue;
    if (!roots.has(email.smsBowerMailId)) roots.set(email.smsBowerMailId, email);
  }
  let localSpend = 0;
  let closedCount = 0;
  for (const email of roots.values()) {
    if (Number.isFinite(email.smsBowerMailCost)) localSpend += Number(email.smsBowerMailCost);
    if (email.smsBowerMailClosedAt) closedCount += 1;
  }
  return {
    localSpend: Number(localSpend.toFixed(6)),
    rentedCount: roots.size,
    closedCount,
  };
}

async function rentSmsBowerMail(): Promise<{id: string; email: string; cost?: number}> {
  const serviceCode = smsBowerMailServiceCode(appConfig.smsBowerMailService);
  const params: Record<string, string | number | undefined> = {
    service: serviceCode,
    domain: appConfig.smsBowerMailDomain,
  };
  if (appConfig.smsBowerMailMaxPrice) {
    params.maxPrice = appConfig.smsBowerMailMaxPrice;
    params.max_price = appConfig.smsBowerMailMaxPrice;
  }
  const payload = await requestSmsBowerMail("getActivation", params);
  return {...parseSmsBowerActivation(payload), cost: extractSmsBowerCost(payload)};
}

function gmailAlias(rootEmail: string): string {
  const [local, domain] = rootEmail.split("@");
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${local}+${suffix}@${domain}`;
}

async function createSmsBowerMailRecords(count: number): Promise<EmailRecord[]> {
  const created: EmailRecord[] = [];
  const childrenPerRoot = appConfig.smsBowerGmailFissionEnabled ? Math.max(0, appConfig.smsBowerGmailFissionCount) : 0;
  while (created.length < count) {
    const rented = await rentSmsBowerMail();
    const root = rented.email.toLowerCase();
    const record: EmailRecord = {
      id: `smsbower_${Date.now()}_${randomUUID().slice(0, 8)}`,
      email: root,
      otpMode: "smsbower-mail",
      password: appConfig.defaultPassword,
      mailboxUrl: "",
      raw: `smsbower-mail:${rented.id}:${root}`,
      status: "free",
      importedAt: nowIso(),
      updatedAt: nowIso(),
      smsBowerMailId: rented.id,
      smsBowerMailRoot: root,
      smsBowerMailCost: rented.cost,
      smsBowerFissionChildrenRemaining: childrenPerRoot,
    };
    emails.push(record);
    created.push(record);
  }
  await persistEmails();
  return created;
}

function parseSetCookieHeader(headers: {get(name: string): string | null; getSetCookie?: () => string[]}): string {
  const getSetCookie = (headers as unknown as {getSetCookie?: () => string[]}).getSetCookie;
  const values = typeof getSetCookie === "function"
    ? getSetCookie.call(headers)
    : String(headers.get("set-cookie") || "").split(/,(?=[^;,]+=)/);
  return values
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => item.split(";")[0])
    .filter(Boolean)
    .join("; ");
}

function readCookieValue(cookie: string, name: string): string {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${escaped}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : "";
}

function emailnatorHeaders(record: Pick<EmailRecord, "emailnatorSessionCookie" | "emailnatorXsrfToken" | "emailnatorBaseUrl">, refererPath = "/"): Record<string, string> {
  const baseUrl = normalizeEmailnatorBaseUrl(record.emailnatorBaseUrl || appConfig.emailnatorBaseUrl);
  return {
    Accept: "application/json, text/plain, */*",
    "Accept-Language": "zh-CN,zh;q=0.9",
    "Content-Type": "application/json",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36",
    "X-Requested-With": "XMLHttpRequest",
    "X-XSRF-TOKEN": String(record.emailnatorXsrfToken || ""),
    Origin: baseUrl,
    Referer: `${baseUrl}${refererPath}`,
    "Sec-CH-UA": "\"Google Chrome\";v=\"149\", \"Chromium\";v=\"149\", \"Not)A;Brand\";v=\"24\"",
    "Sec-CH-UA-Mobile": "?0",
    "Sec-CH-UA-Platform": "\"Windows\"",
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-origin",
    "Sec-GPC": "1",
    Priority: "u=1, i",
    Cookie: String(record.emailnatorSessionCookie || ""),
  };
}

async function createEmailnatorSession(): Promise<{baseUrl: string; cookie: string; xsrfToken: string}> {
  const baseUrl = normalizeEmailnatorBaseUrl(appConfig.emailnatorBaseUrl);
  const response = await undiciFetch(`${baseUrl}/`, {
    ...buildDownloadFetchOptions(),
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "zh-CN,zh;q=0.9",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36",
    },
  });
  const body = await response.text().catch(() => "");
  if (!response.ok) throw new Error(`Emailnator 首页请求失败: HTTP ${response.status}: ${body.slice(0, 200)}`);
  const cookie = parseSetCookieHeader(response.headers);
  const xsrfToken = readCookieValue(cookie, "XSRF-TOKEN");
  if (!cookie || !xsrfToken) throw new Error("Emailnator 未返回 session/XSRF cookie，可能被 WAF 拦截");
  return {baseUrl, cookie, xsrfToken};
}

async function requestEmailnatorJson<T>(
  session: {baseUrl: string; cookie: string; xsrfToken: string},
  pathname: string,
  body: unknown,
  refererPath = "/",
): Promise<T> {
  const response = await undiciFetch(`${session.baseUrl}${pathname}`, {
    method: "POST",
    ...buildDownloadFetchOptions(),
    headers: emailnatorHeaders({
      emailnatorBaseUrl: session.baseUrl,
      emailnatorSessionCookie: session.cookie,
      emailnatorXsrfToken: session.xsrfToken,
    }, refererPath),
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Emailnator ${pathname} HTTP ${response.status}: ${text.slice(0, 300)}`);
  try {
    return JSON.parse(text) as T;
  } catch {
    return text as T;
  }
}

async function rentEmailnatorMail(): Promise<{email: string; cookie: string; xsrfToken: string; baseUrl: string; baselineMessageIds: string[]}> {
  const session = await createEmailnatorSession();
  const payload = await requestEmailnatorJson<Record<string, unknown>>(
    session,
    "/generate-email",
    {email: [normalizeEmailnatorEmailType(appConfig.emailnatorEmailType)]},
  );
  const items = Array.isArray(payload?.email) ? payload.email.map((item) => String(item).trim()).filter(Boolean) : [];
  const email = items.find((item) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(item)) || "";
  if (!email) throw new Error(`Emailnator 生成邮箱返回格式异常: ${JSON.stringify(payload).slice(0, 300)}`);
  const normalizedEmail = email.toLowerCase();
  let baselineMessageIds: string[] = [];
  try {
    const baselinePayload = await requestEmailnatorJson<unknown>(
      session,
      "/message-list",
      {email: normalizedEmail},
      `/mailbox/#${encodeURIComponent(normalizedEmail)}`,
    );
    baselineMessageIds = extractEmailnatorMessageItems(baselinePayload).map((item) => item.messageID);
  } catch {
    baselineMessageIds = [];
  }
  return {
    email: normalizedEmail,
    cookie: session.cookie,
    xsrfToken: session.xsrfToken,
    baseUrl: session.baseUrl,
    baselineMessageIds,
  };
}

async function createEmailnatorMailRecords(count: number): Promise<EmailRecord[]> {
  const created: EmailRecord[] = [];
  while (created.length < count) {
    const rented = await rentEmailnatorMail();
    const record: EmailRecord = {
      id: `emailnator_${Date.now()}_${randomUUID().slice(0, 8)}`,
      email: rented.email,
      otpMode: "emailnator",
      password: appConfig.defaultPassword,
      mailboxUrl: "",
      raw: `emailnator:${rented.email}`,
      status: "free",
      importedAt: nowIso(),
      updatedAt: nowIso(),
      emailnatorSessionCookie: rented.cookie,
      emailnatorXsrfToken: rented.xsrfToken,
      emailnatorBaseUrl: rented.baseUrl,
      emailnatorUsedCodes: [],
      emailnatorUsedMessageIds: [],
      emailnatorBaselineMessageIds: rented.baselineMessageIds,
    };
    emails.push(record);
    created.push(record);
  }
  await persistEmails();
  return created;
}

async function refreshEmailnatorSession(email: EmailRecord): Promise<void> {
  const session = await createEmailnatorSession();
  email.emailnatorBaseUrl = session.baseUrl;
  email.emailnatorSessionCookie = session.cookie;
  email.emailnatorXsrfToken = session.xsrfToken;
  email.updatedAt = nowIso();
  await persistEmails();
}

async function requestEmailnatorForEmail<T>(email: EmailRecord, body: unknown): Promise<T> {
  if (!email.emailnatorSessionCookie || !email.emailnatorXsrfToken) {
    await refreshEmailnatorSession(email);
  }
  const session = {
    baseUrl: normalizeEmailnatorBaseUrl(email.emailnatorBaseUrl || appConfig.emailnatorBaseUrl),
    cookie: String(email.emailnatorSessionCookie || ""),
    xsrfToken: String(email.emailnatorXsrfToken || ""),
  };
  try {
    return await requestEmailnatorJson<T>(session, "/message-list", body, `/mailbox/#${encodeURIComponent(email.email)}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/419|401|403|csrf|xsrf|token|session/i.test(message)) throw error;
    await refreshEmailnatorSession(email);
    return requestEmailnatorJson<T>({
      baseUrl: normalizeEmailnatorBaseUrl(email.emailnatorBaseUrl || appConfig.emailnatorBaseUrl),
      cookie: String(email.emailnatorSessionCookie || ""),
      xsrfToken: String(email.emailnatorXsrfToken || ""),
    }, "/message-list", body, `/mailbox/#${encodeURIComponent(email.email)}`);
  }
}

function extractEmailnatorMessageItems(payload: unknown): Array<{messageID: string; from: string; subject: string; time: string}> {
  const record = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const items = Array.isArray(record.messageData) ? record.messageData : Array.isArray(payload) ? payload : [];
  return items
    .filter((item) => item && typeof item === "object")
    .map((item) => item as Record<string, unknown>)
    .map((item) => ({
      messageID: asString(item.messageID || item.messageId || item.id),
      from: asString(item.from || item.sender),
      subject: asString(item.subject || item.title),
      time: asString(item.time || item.date),
    }))
    .filter((item) => item.messageID);
}

async function waitForEmailnatorCode(email: EmailRecord, task: K12Task, label: string): Promise<string> {
  const waitStartedAt = Date.now();
  task.waitingOtp = true;
  task.waitingOtpLabel = label;
  task.waitingOtpEmail = email.email;
  task.waitingOtpSince = new Date(waitStartedAt).toISOString();
  appendLog(task, "info", `等待 Emailnator ${label} 验证码: ${email.email}`);
  await persistTasks();
  let last = "";
  try {
    for (let attempt = 1; attempt <= 60; attempt += 1) {
      assertNotCanceled(task);
      const listPayload = await requestEmailnatorForEmail<unknown>(email, {email: email.email});
      assertNotCanceled(task);
      const items = extractEmailnatorMessageItems(listPayload)
        .filter((item) => !(email.emailnatorUsedMessageIds || []).includes(item.messageID))
        .filter((item) => !(email.emailnatorBaselineMessageIds || []).includes(item.messageID));
      const likelyItems = items.filter(isLikelyEmailnatorOpenAIMessage);
      for (const item of likelyItems) {
        assertNotCanceled(task);
        let detail: unknown;
        try {
          detail = await requestEmailnatorForEmail<unknown>(email, {email: email.email, messageID: item.messageID});
        } catch (error) {
          last = `message ${item.messageID} detail failed: ${error instanceof Error ? error.message : String(error)}`;
          continue;
        }
        assertNotCanceled(task);
        const detailText = typeof detail === "string" ? detail : JSON.stringify(detail);
        const code = extractVerificationCodeFromText(`${item.from}\n${item.subject}\n${detailText}`);
        if (!code) {
          last = `message ${item.messageID} no code: ${item.subject}`;
          continue;
        }
        if ((email.emailnatorUsedCodes || []).includes(code)) {
          last = `Emailnator 返回已使用验证码 ${code}`;
          continue;
        }
        email.emailnatorUsedCodes = Array.from(new Set([...(email.emailnatorUsedCodes || []), code])).slice(-20);
        email.emailnatorUsedMessageIds = Array.from(new Set([...(email.emailnatorUsedMessageIds || []), item.messageID])).slice(-50);
        email.updatedAt = nowIso();
        await persistEmails();
        appendLog(task, "ok", `Emailnator ${label} 验证码已获取: subject=${item.subject || "-"} message=${item.messageID} code=${maskOtpCode(code)}`);
        return code;
      }
      if (attempt === 1 || attempt % 10 === 0) {
        appendLog(task, "info", `Emailnator ${label} 验证码暂未收到，继续等待 (${attempt}/60)，候选邮件 ${likelyItems.length}/${items.length}`);
      }
      last ||= `candidate/openai=${likelyItems.length}/${items.length}`;
      await sleepForTask(task, 3000);
    }
    throw new Error(`Emailnator 邮箱中未找到验证码: ${email.email}; last=${last}`);
  } finally {
    task.waitingOtp = false;
    task.waitingOtpLabel = undefined;
    task.waitingOtpEmail = undefined;
    task.waitingOtpSince = undefined;
  }
}

function createSmsBowerFissionChild(parent: EmailRecord): EmailRecord {
  const root = (parent.smsBowerMailRoot || rootMailboxIdentity(parent)).toLowerCase();
  const existing = new Set(emails.map((item) => item.email.toLowerCase()));
  let address = "";
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const candidate = gmailAlias(root).toLowerCase();
    if (!existing.has(candidate)) {
      address = candidate;
      break;
    }
  }
  if (!address) throw new Error(`SMSBower Gmail 裂变失败：无法生成唯一子邮箱 ${root}`);
  const record: EmailRecord = {
    id: `smsbower_${Date.now()}_${randomUUID().slice(0, 8)}`,
    email: address,
    parentEmail: root,
    otpMode: "smsbower-mail",
    password: parent.password || appConfig.defaultPassword,
    mailboxUrl: "",
    raw: `smsbower-mail:${parent.smsBowerMailId}:${address}`,
    status: "free",
    importedAt: nowIso(),
    updatedAt: nowIso(),
    smsBowerMailId: parent.smsBowerMailId,
    smsBowerMailRoot: root,
    smsBowerMailCost: parent.smsBowerMailCost,
    smsBowerFissionParentEmailId: parent.id,
  };
  emails.push(record);
  return record;
}

async function waitForSmsBowerMailCode(email: EmailRecord, task: K12Task, label: string): Promise<string> {
  const id = asString(email.smsBowerMailId);
  if (!id) throw new Error(`SMSBower 邮箱缺少 activation id: ${email.email}`);
  const blockedReason = smsBowerActivationBlockReason(email);
  if (blockedReason) throw new Error(blockedReason);
  const waitStartedAt = Date.now();
  task.waitingOtp = true;
  task.waitingOtpLabel = label;
  task.waitingOtpEmail = email.email;
  task.waitingOtpSince = new Date(waitStartedAt).toISOString();
  appendLog(task, "info", `等待 SMSBower ${label} 验证码: ${email.email} activation=${id}`);
  await persistTasks();
  let last = "";
  try {
    for (let attempt = 1; attempt <= SMSBOWER_CODE_MAX_ATTEMPTS; attempt += 1) {
      assertNotCanceled(task);
      let payload: unknown;
      try {
        payload = await requestSmsBowerMail("getCode", {mailId: id});
      } catch (error) {
        assertNotCanceled(task);
        const message = error instanceof Error ? error.message : String(error);
        if (isSmsBowerCodePendingMessage(message)) {
          last = message;
          if (attempt === 1 || attempt % 10 === 0) {
            appendLog(task, "info", `SMSBower ${label} 验证码暂未收到，继续等待 (${attempt}/${SMSBOWER_CODE_MAX_ATTEMPTS})`);
          }
          await sleepForTask(task, 3000);
          continue;
        }
        throw error;
      }
      assertNotCanceled(task);
      const code = extractVerificationCode(payload);
      if (code) {
        const arrivalMs = extractSmsBowerCodeArrivalMs(payload);
        if (arrivalMs !== undefined && arrivalMs + 1000 < waitStartedAt) {
          last = `SMSBower 返回旧邮件验证码 ${code}，抵达时间 ${new Date(arrivalMs).toISOString()}`;
          if (attempt === 1 || attempt % 10 === 0) {
            appendLog(task, "info", `SMSBower ${label} 返回旧邮件，继续等待新验证码 (${attempt}/60)`);
          }
          await sleepForTask(task, 3000);
          continue;
        }
        const related = emails.filter((item) => item.smsBowerMailId === id);
        for (const item of related) {
          item.smsBowerMailUsedCodes = Array.from(new Set([...(item.smsBowerMailUsedCodes || []), code])).slice(-20);
          item.updatedAt = nowIso();
        }
        await persistEmails();
        appendLog(task, "ok", `SMSBower ${label} 验证码已获取${arrivalMs !== undefined ? `，抵达时间 ${new Date(arrivalMs).toISOString()}` : ""}`);
        return code;
      }
      last = typeof payload === "string" ? payload : JSON.stringify(payload).slice(0, 180);
      await sleepForTask(task, 3000);
    }
    throw new Error(`SMSBower 邮箱中未找到验证码: ${email.email}; last=${last}`);
  } finally {
    task.waitingOtp = false;
    task.waitingOtpLabel = undefined;
    task.waitingOtpEmail = undefined;
    task.waitingOtpSince = undefined;
  }
}

function isSmsBowerCodePendingMessage(message: string): boolean {
  return /code has not been received|try again later|no code|code not received|not received yet|验证码.*未|暂未收到/i.test(message);
}

function isSmsBowerBadActualActivationStatus(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /bad actual activation status/i.test(message);
}

async function markSmsBowerMailClosedLocally(email: EmailRecord, status: number, reason: string): Promise<void> {
  const id = asString(email.smsBowerMailId);
  if (!id) return;
  const related = emails.filter((item) => item.smsBowerMailId === id);
  for (const item of related) {
    item.status = item.status === "success" ? item.status : "failed";
    item.lastError = reason;
    item.smsBowerMailClosedAt = item.smsBowerMailClosedAt || nowIso();
    item.smsBowerMailCloseStatus = item.smsBowerMailCloseStatus ?? status;
    item.updatedAt = nowIso();
  }
  await persistEmails();
}

function smsBowerClosedByRemoteStatusReason(email: EmailRecord): string {
  return `SMSBower activation=${email.smsBowerMailId || "-"} 后台状态已结束，不能再获取验证码，请重新租 Gmail`;
}

async function setSmsBowerMailStatus(email: EmailRecord, status: number): Promise<void> {
  const id = asString(email.smsBowerMailId);
  if (!id || email.smsBowerMailClosedAt) return;
  try {
    await requestSmsBowerMail("setStatus", {id, mailId: id, status});
  } catch (error) {
    if (isSmsBowerBadActualActivationStatus(error)) {
      await markSmsBowerMailClosedLocally(email, status, smsBowerClosedByRemoteStatusReason(email));
      return;
    }
    throw error;
  }
  email.smsBowerMailClosedAt = nowIso();
  email.smsBowerMailCloseStatus = status;
  email.updatedAt = nowIso();
}

async function requestSmsBowerNextMailCode(email: EmailRecord, task?: K12Task, reason = "请求等待下一个验证码"): Promise<void> {
  const id = asString(email.smsBowerMailId);
  if (!id || email.smsBowerMailClosedAt) return;
  try {
    await requestSmsBowerMail("setStatus", {id, mailId: id, status: 5});
  } catch (error) {
    if (isSmsBowerBadActualActivationStatus(error)) {
      const closedReason = smsBowerClosedByRemoteStatusReason(email);
      await markSmsBowerMailClosedLocally(email, 2, closedReason);
      throw new Error(closedReason);
    }
    throw error;
  }
  email.updatedAt = nowIso();
  if (task) appendLog(task, "info", `SMSBower ${reason}: activation=${id}`);
}

async function finalizeSmsBowerMailIfDone(email: EmailRecord): Promise<void> {
  if (email.otpMode !== "smsbower-mail" || !email.smsBowerMailId) return;
  const related = emails.filter((item) => item.smsBowerMailId === email.smsBowerMailId);
  const active = related.some((item) => hasActiveTask(item.id));
  if (active) return;
  const hasFailed = related.some((item) => item.status === "failed" || item.status === "banned");
  await setSmsBowerMailStatus(email, hasFailed ? 2 : 3);
  for (const item of related) {
    item.smsBowerMailClosedAt = email.smsBowerMailClosedAt;
    item.smsBowerMailCloseStatus = email.smsBowerMailCloseStatus;
    item.updatedAt = nowIso();
  }
  await persistEmails();
}

function findSmsBowerFissionRoot(email: EmailRecord): EmailRecord {
  if (!email.smsBowerMailId) return email;
  return emails.find((item) => (
    item.smsBowerMailId === email.smsBowerMailId
    && !item.parentEmail
  )) || email;
}

async function enqueueNextSmsBowerFissionTask(parent: EmailRecord, task: K12Task): Promise<K12Task | undefined> {
  if (
    parent.otpMode !== "smsbower-mail"
    || !parent.smsBowerMailId
    || task.status !== "success"
    || (task.smsBowerFissionRemainingAfterThis || 0) <= 0
  ) {
    return undefined;
  }
  const root = findSmsBowerFissionRoot(parent);
  const remaining = Math.max(0, task.smsBowerFissionRemainingAfterThis || 0);
  try {
    await requestSmsBowerNextMailCode(root, task, "母邮箱成功，已请求等待下一个验证码");
  } catch (error) {
    if (!isSmsBowerCodeLimitReachedMessage(error)) throw error;
    root.smsBowerFissionChildrenRemaining = 0;
    root.updatedAt = nowIso();
    appendLog(task, "warn", `SMSBower activation=${root.smsBowerMailId || "-"} 验证码次数已达上限，停止该母邮箱继续分裂`);
    await Promise.all([persistTasks(), persistEmails()]);
    return undefined;
  }
  const child = createSmsBowerFissionChild(root);
  const childTask = enqueueK12Task(child, {
    route: task.route,
    workspaceIds: task.workspaceIds,
    runWorkspaceJoin: task.runWorkspaceJoin,
    runSub2Api: task.runSub2Api,
    sub2apiNoRtMode: task.sub2apiNoRtMode === true,
    sub2apiGroupName: task.sub2apiGroupName,
    fissionRemainingAfterThis: remaining - 1,
  });
  root.smsBowerFissionChildrenRemaining = remaining - 1;
  root.smsBowerFissionChildrenCreatedAt = nowIso();
  root.updatedAt = nowIso();
  appendLog(task, "ok", `母邮箱成功，已创建裂变子任务: ${child.email}，剩余 ${remaining - 1}`);
  appendLog(childTask, "info", `由母邮箱 ${parent.email} 成功后创建，复用 SMSBower activation=${parent.smsBowerMailId}`);
  await Promise.all([persistTasks(), persistEmails()]);
  return childTask;
}

async function enqueueNextPoolFissionTask(email: EmailRecord, task: K12Task): Promise<K12Task | undefined> {
  const hasFissionCounter = task.smsBowerFissionRemainingAfterThis !== undefined;
  const remaining = Math.max(0, task.smsBowerFissionRemainingAfterThis || 0);
  if (!shouldCreatePoolFissionChild({
    enabled: appConfig.smsBowerGmailFissionEnabled,
    status: task.status,
    isSmsBowerMail: email.otpMode === "smsbower-mail",
    hasFissionCounter,
    isChildEmail: Boolean(email.parentEmail),
    remaining,
  })) {
    return undefined;
  }
  const parent = findPoolFissionParent(email);
  const root = rootMailboxIdentity(parent);
  if (shouldCooldownPoolFissionAfterMailboxOtpTimeout({
    isSmsBowerMail: email.otpMode === "smsbower-mail",
    isChildEmail: Boolean(email.parentEmail),
    mailboxOtpDeliveryTimeout: isMailboxOtpDeliveryTimeoutMessage(task.error),
  })) {
    const notBefore = markPoolFissionMailboxOtpCooldown(parent, root, task, appConfig.poolFissionMailboxOtpCooldownMs);
    const nextRemaining = poolFissionRemainingForNextTask({status: task.status, remaining});
    const delayedTask = enqueuePoolFissionChildTask(parent, task, task.workspaceIds, nextRemaining, notBefore);
    const workspaceText = task.workspaceIds[0] ? ` workspace=${task.workspaceIds[0]}` : "";
    appendLog(task, "warn", `已排队冷却后继续补分裂${workspaceText}: ${delayedTask.email}，notBefore=${notBefore}`);
    appendLog(delayedTask, "info", `由邮箱 ${email.email} 收码冷却后创建，母邮箱 ${parent.email}${workspaceText}，5 分钟后自动继续`);
    await Promise.all([persistTasks(), persistEmails()]);
    const rotatedTask = await enqueueNextAvailablePoolFissionWorkspace(parent, root, task, task.workspaceIds);
    scheduleTasks();
    return rotatedTask || delayedTask;
  }
  if (shouldCooldownPoolFissionAfterUserAlreadyExists({
    isSmsBowerMail: email.otpMode === "smsbower-mail",
    isChildEmail: Boolean(email.parentEmail),
    userAlreadyExists: task.status === "failed" && isOpenAiUserAlreadyExistsMessage(task.error),
  })) {
    const notBefore = markPoolFissionUserAlreadyExistsCooldown(parent, root, task, appConfig.poolFissionMailboxOtpCooldownMs);
    const nextRemaining = poolFissionRemainingForNextTask({status: task.status, remaining});
    const delayedTask = enqueuePoolFissionChildTask(parent, task, task.workspaceIds, nextRemaining, notBefore);
    const workspaceText = task.workspaceIds[0] ? ` workspace=${task.workspaceIds[0]}` : "";
    appendLog(task, "warn", `已排队 400 冷却后继续补分裂${workspaceText}: ${delayedTask.email}，notBefore=${notBefore}`);
    appendLog(delayedTask, "info", `由邮箱 ${email.email} 400 冷却后创建，母邮箱 ${parent.email}${workspaceText}，冷却后自动继续`);
    await Promise.all([persistTasks(), persistEmails()]);
    const rotatedTask = await enqueueNextAvailablePoolFissionWorkspace(parent, root, task, task.workspaceIds);
    scheduleTasks();
    return rotatedTask || delayedTask;
  }
  const child = createPoolFissionChild(parent);
  const nextRemaining = poolFissionRemainingForNextTask({status: task.status, remaining});
  const childTask = enqueueK12Task(child, {
    route: task.route,
    workspaceIds: task.workspaceIds,
    runWorkspaceJoin: task.runWorkspaceJoin,
    runSub2Api: task.runSub2Api,
    sub2apiNoRtMode: task.sub2apiNoRtMode === true,
    sub2apiGroupName: task.sub2apiGroupName,
    fissionRemainingAfterThis: nextRemaining,
  });
  const reason = task.status === "success" ? "成功后" : "失败后补位";
  appendLog(task, task.status === "success" ? "ok" : "warn", `邮箱池${email.parentEmail ? "子邮箱" : "母邮箱"}${reason}，已创建裂变子任务: ${child.email}，剩余 ${nextRemaining}`);
  appendLog(childTask, "info", `由邮箱 ${email.email} ${reason}创建，母邮箱 ${parent.email}，复用邮箱池接码配置`);
  await Promise.all([persistTasks(), persistEmails()]);
  return childTask;
}

function publicEmail(record: EmailRecord): Record<string, unknown> {
  return {
    id: record.id,
    email: record.email,
    parentEmail: record.parentEmail,
    otpMode: record.otpMode || "auto",
    passwordPresent: Boolean(record.password),
    passwordMasked: maskSecret(record.password, 3, 3),
    mailboxUrlMasked: record.otpMode === "manual"
      ? "手动接码"
      : record.otpMode === "smsbower-mail"
        ? "SMSBower Gmail"
        : record.otpMode === "emailnator"
          ? "Emailnator Gmail"
          : maskMailboxUrl(record.mailboxUrl),
    status: record.status,
    importedAt: record.importedAt,
    updatedAt: record.updatedAt,
    lastTaskId: record.lastTaskId,
    lastError: record.lastError,
    lastAccessTokenHash: record.lastAccessTokenHash ? record.lastAccessTokenHash.slice(0, 12) : "",
    sub2apiAccount: record.sub2apiAccount,
    smsBowerMailId: record.smsBowerMailId,
    smsBowerMailRoot: record.smsBowerMailRoot,
    smsBowerMailCost: record.smsBowerMailCost,
    smsBowerMailClosedAt: record.smsBowerMailClosedAt,
    smsBowerMailCloseStatus: record.smsBowerMailCloseStatus,
    smsBowerFissionChildrenRemaining: record.smsBowerFissionChildrenRemaining,
    smsBowerFissionParentEmailId: record.smsBowerFissionParentEmailId,
    emailnatorBaseUrl: record.emailnatorBaseUrl,
  };
}

function maskMailboxUrl(value: string): string {
  try {
    const url = new URL(value);
    for (const key of [...url.searchParams.keys()]) {
      if (/token|password|secret|key|client/i.test(key)) {
        url.searchParams.set(key, maskSecret(url.searchParams.get(key) || "", 8, 6));
      }
    }
    return url.toString();
  } catch {
    return maskSecret(value, 36, 18);
  }
}

function appendLog(task: K12Task, level: LogLevel, message: string): void {
  task.logs.push({at: nowIso(), level, message});
  if (task.logs.length > 500) task.logs.splice(0, task.logs.length - 500);
  task.updatedAt = nowIso();
  void persistTasks();
}

async function waitForManualEmailOtp(task: K12Task, email: EmailRecord, label: string): Promise<string> {
  const existing = manualOtpWaiters.get(task.id);
  if (existing) {
    existing.reject(new Error("新的验证码请求已覆盖旧请求"));
    manualOtpWaiters.delete(task.id);
  }

  task.waitingOtp = true;
  task.waitingOtpLabel = label;
  task.waitingOtpEmail = email.email;
  task.waitingOtpSince = nowIso();
  appendLog(task, "warn", `等待手动输入 ${label} 验证码: ${email.email}`);
  await persistTasks();

  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      manualOtpWaiters.delete(task.id);
      task.waitingOtp = false;
      task.waitingOtpLabel = undefined;
      task.waitingOtpEmail = undefined;
      task.waitingOtpSince = undefined;
      appendLog(task, "error", `${label} 验证码等待超时`);
      void persistTasks();
      reject(new Error(`${label} 验证码等待超时`));
    }, MANUAL_OTP_TIMEOUT_MS);

    manualOtpWaiters.set(task.id, {
      expiresAt: Date.now() + MANUAL_OTP_TIMEOUT_MS,
      resolve: (code: string) => {
        clearTimeout(timer);
        task.waitingOtp = false;
        task.waitingOtpLabel = undefined;
        task.waitingOtpEmail = undefined;
        task.waitingOtpSince = undefined;
        appendLog(task, "ok", `${label} 验证码已提交`);
        void persistTasks();
        resolve(code);
      },
      reject: (error: Error) => {
        clearTimeout(timer);
        task.waitingOtp = false;
        task.waitingOtpLabel = undefined;
        task.waitingOtpEmail = undefined;
        task.waitingOtpSince = undefined;
        appendLog(task, "error", error.message);
        void persistTasks();
        reject(error);
      },
    });
  });
}

function submitManualEmailOtp(taskId: string, code: string): {ok: boolean; message: string} {
  const normalized = code.trim();
  if (!/^\d{6}$/.test(normalized)) {
    throw new Error("验证码必须是 6 位数字");
  }
  const waiter = manualOtpWaiters.get(taskId);
  const task = tasks.find((item) => item.id === taskId);
  if (!waiter || !task?.waitingOtp) {
    throw new Error("当前任务没有等待手动验证码");
  }
  manualOtpWaiters.delete(taskId);
  waiter.resolve(normalized);
  return {ok: true, message: "验证码已提交"};
}

function cancelManualEmailOtp(taskId: string, reason: string): void {
  const waiter = manualOtpWaiters.get(taskId);
  if (!waiter) return;
  manualOtpWaiters.delete(taskId);
  waiter.reject(new Error(reason));
}

async function persistEmails(): Promise<void> {
  await writeJson(emailsFile, emails);
}

async function persistTasks(): Promise<void> {
  await writeJson(tasksFile, tasks);
}

async function persistSub2ApiRefillHistory(): Promise<void> {
  await writeJson(sub2apiRefillHistoryFile, sub2apiRefillHistory.slice(0, 200));
}

async function persistWorkspaceBlocks(): Promise<void> {
  await writeJson(workspaceBlocksFile, workspaceBlocks);
}

function hasRunningOrQueuedTasks(items = tasks): boolean {
  return items.some((task) => task.status === "queued" || task.status === "running");
}

function normalizeImportedEmail(value: unknown): EmailRecord | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const email = asString(record.email);
  if (!email) return null;
  const statusText = asString(record.status);
  const allowedStatuses = new Set<EmailStatus>(["free", "running", "success", "failed", "banned"]);
  const status = allowedStatuses.has(statusText as EmailStatus) ? statusText as EmailStatus : "free";
  const rawOtpMode = asString(record.otpMode);
  const otpMode = rawOtpMode === "manual"
    ? "manual"
    : rawOtpMode === "smsbower-mail"
      ? "smsbower-mail"
      : rawOtpMode === "emailnator"
        ? "emailnator"
        : "auto";
  return {
    id: asString(record.id) || stableId(email),
    email,
    parentEmail: asString(record.parentEmail) || undefined,
    otpMode,
    password: String(record.password || ""),
    mailboxUrl: String(record.mailboxUrl || ""),
    clientId: asString(record.clientId) || undefined,
    refreshToken: asString(record.refreshToken) || undefined,
    raw: String(record.raw || email),
    status,
    importedAt: asString(record.importedAt) || nowIso(),
    updatedAt: asString(record.updatedAt) || nowIso(),
    lastTaskId: asString(record.lastTaskId) || undefined,
    lastError: asString(record.lastError) || undefined,
    lastAccessTokenHash: asString(record.lastAccessTokenHash) || undefined,
    sub2apiAccount: asString(record.sub2apiAccount) || undefined,
    smsBowerMailId: asString(record.smsBowerMailId) || undefined,
    smsBowerMailRoot: asString(record.smsBowerMailRoot) || undefined,
    smsBowerMailCost: record.smsBowerMailCost === undefined ? undefined : finiteNumber(record.smsBowerMailCost),
    smsBowerMailClosedAt: asString(record.smsBowerMailClosedAt) || undefined,
    smsBowerMailCloseStatus: record.smsBowerMailCloseStatus === undefined ? undefined : asNumber(record.smsBowerMailCloseStatus, 0),
    smsBowerFissionChildrenRemaining: record.smsBowerFissionChildrenRemaining === undefined ? undefined : asNumber(record.smsBowerFissionChildrenRemaining, 0),
    smsBowerFissionChildrenCreatedAt: asString(record.smsBowerFissionChildrenCreatedAt) || undefined,
    smsBowerFissionParentEmailId: asString(record.smsBowerFissionParentEmailId) || undefined,
    smsBowerMailUsedCodes: Array.isArray(record.smsBowerMailUsedCodes) ? record.smsBowerMailUsedCodes.map((item) => String(item)).filter(Boolean).slice(-20) : undefined,
    emailnatorSessionCookie: asString(record.emailnatorSessionCookie) || undefined,
    emailnatorXsrfToken: asString(record.emailnatorXsrfToken) || undefined,
    emailnatorBaseUrl: asString(record.emailnatorBaseUrl) || undefined,
    emailnatorUsedCodes: Array.isArray(record.emailnatorUsedCodes) ? record.emailnatorUsedCodes.map((item) => String(item)).filter(Boolean).slice(-20) : undefined,
    emailnatorUsedMessageIds: Array.isArray(record.emailnatorUsedMessageIds) ? record.emailnatorUsedMessageIds.map((item) => String(item)).filter(Boolean).slice(-50) : undefined,
    emailnatorBaselineMessageIds: Array.isArray(record.emailnatorBaselineMessageIds) ? record.emailnatorBaselineMessageIds.map((item) => String(item)).filter(Boolean).slice(-100) : undefined,
  };
}

function normalizeImportedTask(value: unknown): K12Task | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const id = asString(record.id);
  const emailId = asString(record.emailId);
  const email = asString(record.email);
  if (!id || !emailId || !email) return null;
  const statusText = asString(record.status);
  const allowedStatuses = new Set<TaskStatus>(["queued", "running", "success", "failed", "canceled"]);
  const route = record.route === "accept" ? "accept" : "request";
  const kind = record.kind === "at-repair" ? "at-repair" : "k12";
  const logs = Array.isArray(record.logs)
    ? record.logs
      .filter((item) => item && typeof item === "object")
      .map((item) => item as Record<string, unknown>)
      .map((item) => ({
        at: asString(item.at) || nowIso(),
        level: (["info", "ok", "warn", "error"].includes(asString(item.level)) ? asString(item.level) : "info") as LogLevel,
        message: String(item.message || ""),
      }))
    : [];
  const workspaceResults = Array.isArray(record.workspaceResults)
    ? record.workspaceResults
      .filter((item) => item && typeof item === "object")
      .map((item) => item as Record<string, unknown>)
      .map((item) => ({
        workspaceId: asString(item.workspaceId),
        route: (item.route === "accept" ? "accept" : "request") as K12Route,
        ok: asBoolean(item.ok, false),
        status: asNumber(item.status, 0),
        body: String(item.body || ""),
        attempt: asNumber(item.attempt, 0),
      }))
    : [];
  const liveness = asString(record.accessTokenLiveness);
  const allowedLiveness = new Set(["unknown", "alive", "inactive", "banned", "error"]);
  return {
    id,
    kind,
    emailId,
    email,
    status: allowedStatuses.has(statusText as TaskStatus) ? statusText as TaskStatus : "failed",
    route,
    workspaceIds: parseStringList(record.workspaceIds),
    runWorkspaceJoin: asBoolean(record.runWorkspaceJoin, true),
    runSub2Api: asBoolean(record.runSub2Api, true),
    sub2apiNoRtMode: asBoolean(record.sub2apiNoRtMode, false),
    sub2apiGroupName: asString(record.sub2apiGroupName, appConfig.sub2apiGroupName) || "k12",
    createdAt: asString(record.createdAt) || nowIso(),
    updatedAt: asString(record.updatedAt) || nowIso(),
    startedAt: asString(record.startedAt) || undefined,
    finishedAt: asString(record.finishedAt) || undefined,
    notBefore: asString(record.notBefore) || undefined,
    cancelRequested: asBoolean(record.cancelRequested, false) || undefined,
    error: asString(record.error) || undefined,
    accessToken: String(record.accessToken || ""),
    accessTokenHash: asString(record.accessTokenHash) || undefined,
    accessTokenPreview: asString(record.accessTokenPreview) || undefined,
    accessTokenEmail: asString(record.accessTokenEmail) || undefined,
    accessTokenExpiresAt: asString(record.accessTokenExpiresAt) || undefined,
    accessTokenLiveness: allowedLiveness.has(liveness) ? liveness as K12Task["accessTokenLiveness"] : undefined,
    accessTokenLivenessStatus: record.accessTokenLivenessStatus === undefined ? undefined : asNumber(record.accessTokenLivenessStatus, 0),
    accessTokenLivenessMessage: asString(record.accessTokenLivenessMessage) || undefined,
    accessTokenLivenessCheckedAt: asString(record.accessTokenLivenessCheckedAt) || undefined,
    workspaceResults,
    sub2apiAccount: asString(record.sub2apiAccount) || undefined,
    jsonOutFile: asString(record.jsonOutFile) || undefined,
    jsonOutFormat: record.jsonOutFormat ? normalizeJsonOutFormat(record.jsonOutFormat) : undefined,
    logs,
  };
}

async function buildDataExport(): Promise<Record<string, unknown>> {
  return {
    app: "gpt-k12",
    version: 1,
    exportedAt: nowIso(),
    config: appConfig,
    emails,
    tasks,
    tokenOutFileName: path.basename(appConfig.tokenOut || "pool_tokens.txt"),
    tokenOut: await readFile(appConfig.tokenOut, "utf8").catch(() => ""),
    summary: summary(),
  };
}

async function backupCurrentDataBeforeImport(): Promise<string> {
  const backupDir = path.join(dataDir, "backups");
  await mkdir(backupDir, {recursive: true});
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupFile = path.join(backupDir, `before-import-${stamp}.json`);
  await writeJson(backupFile, await buildDataExport());
  return backupFile;
}

async function importDataBundle(bundle: Record<string, unknown>): Promise<{emails: number; tasks: number; tokenOut: boolean; backupFile: string}> {
  if (hasRunningOrQueuedTasks()) throw new Error("当前还有运行中或队列任务，不能导入数据");

  const importedEmails = Array.isArray(bundle.emails) ? bundle.emails.map(normalizeImportedEmail).filter(Boolean) as EmailRecord[] : [];
  const importedTasks = Array.isArray(bundle.tasks) ? bundle.tasks.map(normalizeImportedTask).filter(Boolean) as K12Task[] : [];
  if (hasRunningOrQueuedTasks(importedTasks)) throw new Error("导入包里包含运行中或队列任务，请先清理后再导入");

  const importedConfig = bundle.config && typeof bundle.config === "object"
    ? normalizeConfig({...appConfig, ...bundle.config as Partial<AppConfig>, tokenOut: appConfig.tokenOut})
    : appConfig;
  const backupFile = await backupCurrentDataBeforeImport();

  appConfig = importedConfig;
  emails = importedEmails;
  tasks = importedTasks;
  activeWorkers = 0;

  await Promise.all([
    saveConfig(appConfig),
    persistEmails(),
    persistTasks(),
  ]);

  const tokenText = typeof bundle.tokenOut === "string" ? bundle.tokenOut : "";
  if (tokenText) {
    await mkdir(path.dirname(appConfig.tokenOut), {recursive: true});
    await writeFile(appConfig.tokenOut, tokenText, "utf8");
  }

  return {emails: emails.length, tasks: tasks.length, tokenOut: Boolean(tokenText), backupFile};
}

async function importEmails(
  text: string,
  config = appConfig,
  options: {otpMode?: EmailOtpMode} = {},
): Promise<{added: number; updated: number; skipped: number; invalid: number; inputLines: number; total: number; invalidSamples: string[]}> {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  let added = 0;
  let updated = 0;
  let skipped = 0;
  let invalid = 0;
  const invalidSamples: string[] = [];
  const byEmail = new Map(emails.map((item) => [item.email.toLowerCase(), item]));
  const seenInBatch = new Set<string>();

  for (const line of lines) {
    let parsed: ParsedEmailLine | null = null;
    try {
      parsed = options.otpMode === "manual" ? parseManualEmailLine(line, config) : parseEmailLine(line, config);
    } catch {
      parsed = null;
    }
    if (!parsed) {
      invalid += 1;
      if (invalidSamples.length < 5) invalidSamples.push(line.slice(0, 180));
      continue;
    }

    const key = parsed.email.toLowerCase();
    if (seenInBatch.has(key)) {
      skipped += 1;
      continue;
    }
    seenInBatch.add(key);

    const existing = byEmail.get(key);
    if (existing) {
      existing.otpMode = parsed.otpMode || "auto";
      existing.password = parsed.password;
      existing.mailboxUrl = parsed.mailboxUrl;
      existing.clientId = parsed.clientId;
      existing.refreshToken = parsed.refreshToken;
      existing.raw = parsed.raw;
      existing.updatedAt = nowIso();
      if (existing.status === "free") existing.lastError = "";
      updated += 1;
    } else {
      const record: EmailRecord = {
        id: stableId(parsed.email),
        email: parsed.email,
        otpMode: parsed.otpMode || "auto",
        password: parsed.password,
        mailboxUrl: parsed.mailboxUrl,
        clientId: parsed.clientId,
        refreshToken: parsed.refreshToken,
        raw: parsed.raw,
        status: "free",
        importedAt: nowIso(),
        updatedAt: nowIso(),
      };
      emails.push(record);
      byEmail.set(key, record);
      added += 1;
    }
  }
  await persistEmails();
  return {added, updated, skipped, invalid, inputLines: lines.length, total: emails.length, invalidSamples};
}

function hasActiveTask(emailId: string, workspaceIds?: string[]): boolean {
  return tasks.some((task) => (
    task.emailId === emailId
    && (task.status === "queued" || task.status === "running")
    && (workspaceIds === undefined || taskWorkspaceKeysOverlap(task.workspaceIds, workspaceIds))
  ));
}

function hasPriorSuccessfulK12Task(emailId: string, exceptTaskId: string, workspaceIds?: string[]): boolean {
  return tasks.some((task) => (
    task.id !== exceptTaskId
    && task.emailId === emailId
    && task.kind === "k12"
    && task.status === "success"
    && (workspaceIds === undefined || taskWorkspaceKeysOverlap(task.workspaceIds, workspaceIds))
  ));
}

function removeEmails(ids: string[]): {removed: number; removedTasks: number; skippedRunning: number; missing: number} {
  const requested = new Set(ids.filter(Boolean));
  if (!requested.size) return {removed: 0, removedTasks: 0, skippedRunning: 0, missing: 0};

  let removed = 0;
  let removedTasks = 0;
  let skippedRunning = 0;
  let missing = 0;
  const originalEmails = emails;
  const removedEmailIds: string[] = [];
  const existingIds = new Set(emails.map((item) => item.id));
  for (const id of requested) {
    if (!existingIds.has(id)) missing += 1;
  }

  emails = emails.filter((email) => {
    if (!requested.has(email.id)) return true;
    if (email.status === "running" || hasActiveTask(email.id)) {
      skippedRunning += 1;
      return true;
    }
    removed += 1;
    removedEmailIds.push(email.id);
    return false;
  });

  if (removedEmailIds.length) {
    const pruned = pruneTasksForDeletedEmails(originalEmails, tasks, removedEmailIds);
    tasks = pruned.tasks;
    removedTasks = pruned.removedTasks;
  }

  return {removed, removedTasks, skippedRunning, missing};
}

function rootMailboxIdentity(email: EmailRecord): string {
  return (email.parentEmail || email.email).toLowerCase();
}

function rootMailboxIdentityFromAddress(address: string): string {
  const email = address.trim().toLowerCase();
  const at = email.indexOf("@");
  if (at <= 0) return email;
  const local = email.slice(0, at);
  const domain = email.slice(at);
  const plus = local.indexOf("+");
  return plus >= 0 ? `${local.slice(0, plus)}${domain}` : email;
}

function rootMailboxIdentityByEmailId(emailId: string): string {
  const email = emails.find((item) => item.id === emailId);
  return email ? rootMailboxIdentity(email) : emailId;
}

function exactWorkspaceBlockReason(email: string, workspaceIds?: string[]): string {
  return emailWorkspaceBlockReason(workspaceBlocks, email, workspaceIds);
}

function recordEmailWorkspaceBlock(input: {
  email: string;
  workspaceIds?: string[];
  reason: string;
  source: string;
  accountName?: string;
}): {changed: boolean; blocked: number} {
  const ids = uniqueStringList(input.workspaceIds || []);
  let changed = false;
  let blocked = 0;
  for (const workspaceId of ids) {
    const result = upsertWorkspaceBlock(workspaceBlocks, {
      rootEmail: input.email,
      workspaceId,
      reason: input.reason,
      at: nowIso(),
      scope: "email",
      source: input.source,
      accountName: input.accountName,
    });
    workspaceBlocks = result.blocks;
    changed = changed || result.changed;
    blocked += 1;
  }
  return {changed, blocked};
}

async function blockEmailWorkspace(input: {
  email: string;
  workspaceIds?: string[];
  reason: string;
  source: string;
  accountName?: string;
}): Promise<{blocked: number}> {
  const blocked = recordEmailWorkspaceBlock(input);
  if (blocked.changed) await persistWorkspaceBlocks();
  return {blocked: blocked.blocked};
}

function restoreWorkspaceAccessDeniedEmailStatuses(): boolean {
  let changed = false;
  for (const email of emails) {
    if (email.status !== "banned") continue;
    if (!isOpenAiWorkspaceAccessDeniedMessage(email.lastError)) continue;
    email.status = "free";
    email.lastError = "";
    email.updatedAt = nowIso();
    changed = true;
  }
  return changed;
}

function seedWorkspaceBlocksFromAccessDeniedTasks(): boolean {
  let changed = false;
  for (const task of tasks) {
    if (!task.workspaceIds.length) continue;
    const email = emails.find((item) => item.id === task.emailId);
    if (!email) continue;
    const text = [
      task.error || "",
      task.accessTokenLivenessMessage || "",
      ...(task.logs || []).map((log) => log.message || ""),
    ].join("\n");
    if (!isOpenAiWorkspaceAccessDeniedMessage(text)) continue;
    const result = recordEmailWorkspaceBlock({
      email: task.email || email.email,
      workspaceIds: task.workspaceIds,
      reason: task.error || task.accessTokenLivenessMessage || "OpenAI 403 workspace access denied",
      source: `historical-task:${task.id}`,
      accountName: task.sub2apiAccount || email.sub2apiAccount,
    });
    changed = changed || result.changed;
  }
  return changed;
}

function relatedK12TasksForRoot(root: string, workspaceIds?: string[]): K12Task[] {
  return tasks.filter((task) => (
    (task.kind || "k12") === "k12"
    && rootMailboxIdentityByEmailId(task.emailId) === root
    && (workspaceIds === undefined || taskWorkspaceKeysOverlap(task.workspaceIds, workspaceIds))
  ));
}

function isFissionChildEmail(email: EmailRecord, root: string): boolean {
  return rootMailboxIdentity(email) === root && (Boolean(email.parentEmail) || (Boolean(email.smsBowerMailRoot) && email.email.toLowerCase() !== root));
}

function successfulFissionChildrenForRoot(root: string, workspaceIds?: string[]): number {
  const successful = new Set<string>();
  for (const task of relatedK12TasksForRoot(root, workspaceIds)) {
    if (task.status !== "success") continue;
    const email = emails.find((item) => item.id === task.emailId);
    if (!email || !isFissionChildEmail(email, root)) continue;
    if (taskHasOpenAiUserAlreadyExists(task, email)) continue;
    successful.add(email.email.toLowerCase());
  }
  return successful.size;
}

function taskHasOpenAiUserAlreadyExists(task: K12Task, email?: EmailRecord): boolean {
  const text = [
    task.error || "",
    email?.lastError || "",
    ...(task.logs || []).map((log) => log.message || ""),
  ].join("\n");
  return isOpenAiUserAlreadyExistsMessage(text);
}

function markPoolFissionMailboxOtpCooldown(parent: EmailRecord, root: string, task: K12Task, delayMs = POOL_FISSION_MAILBOX_OTP_COOLDOWN_MS): string {
  const workspaceText = task.workspaceIds?.[0] ? ` workspace=${task.workspaceIds[0]}` : "";
  const notBefore = new Date(Date.now() + Math.max(0, delayMs)).toISOString();
  parent.updatedAt = nowIso();
  appendLog(task, "warn", `邮箱池母号 ${root}${workspaceText} 未收到新的登录验证码，收码冷却 ${Math.ceil(delayMs / 60000)} 分钟，先轮转其他 workspace，冷却后继续补分裂`);
  return notBefore;
}

function markPoolFissionUserAlreadyExistsCooldown(parent: EmailRecord, root: string, task: K12Task, delayMs = POOL_FISSION_MAILBOX_OTP_COOLDOWN_MS): string {
  const workspaceText = task.workspaceIds?.[0] ? ` workspace=${task.workspaceIds[0]}` : "";
  const notBefore = new Date(Date.now() + Math.max(0, delayMs)).toISOString();
  parent.updatedAt = nowIso();
  appendLog(task, "warn", `邮箱池母号 ${root}${workspaceText} 出现 user_already_exists，按临时 400 冷却 ${Math.ceil(delayMs / 60000)} 分钟，先轮转其他 workspace，冷却后继续补分裂`);
  return notBefore;
}

function workspaceIdsFromKey(key: string): string[] {
  return key === "__no_workspace__" ? [] : [key];
}

function poolFissionWorkspaceVariantsForRoot(root: string, currentWorkspaceIds: string[]): string[][] {
  const keys: string[] = [];
  const add = (workspaceIds: string[] | undefined) => {
    const key = taskWorkspaceKey(workspaceIds);
    if (!keys.includes(key)) keys.push(key);
  };

  for (const workspaceId of appConfig.workspaceIds) add(workspaceId ? [workspaceId] : []);
  for (const task of relatedK12TasksForRoot(root)) add(task.workspaceIds);
  add(currentWorkspaceIds);

  const currentKey = taskWorkspaceKey(currentWorkspaceIds);
  const currentIndex = keys.indexOf(currentKey);
  const ordered = currentIndex >= 0
    ? [...keys.slice(currentIndex + 1), ...keys.slice(0, currentIndex + 1)]
    : keys;
  return ordered.map(workspaceIdsFromKey);
}

function taskMailboxOtpTimeoutText(task: K12Task): string {
  return [
    task.error || "",
    ...(task.logs || []).map((log) => log.message || ""),
  ].join("\n");
}

function poolMailboxOtpCooldownDelayMs(root: string, workspaceIds: string[], nowMs = Date.now()): number {
  let delayMs = 0;
  for (const task of relatedK12TasksForRoot(root, workspaceIds)) {
    const cooldownText = taskMailboxOtpTimeoutText(task);
    if (!isMailboxOtpDeliveryTimeoutMessage(cooldownText) && !isOpenAiUserAlreadyExistsMessage(cooldownText)) continue;
    const finishedAtMs = Date.parse(task.finishedAt || task.updatedAt || task.createdAt);
    const taskDelay = poolFissionMailboxOtpCooldownDelayMs({
      isChildEmail: true,
      isSmsBowerMail: false,
      mailboxOtpDeliveryTimeout: true,
      nowMs,
      cooldownMs: appConfig.poolFissionMailboxOtpCooldownMs,
      finishedAtMs,
    });
    delayMs = Math.max(delayMs, taskDelay);
  }
  return delayMs;
}

function poolFissionDeficitForWorkspace(root: string, workspaceIds: string[]): {
  targetSuccesses: number;
  successfulChildren: number;
  activeTasks: number;
  deficit: number;
} {
  const successfulChildren = successfulFissionChildrenForRoot(root, workspaceIds);
  const activeTasks = activeFissionTasksForRoot(root, workspaceIds);
  const targetSuccesses = fissionTargetForRoot(root, successfulChildren, undefined, workspaceIds);
  return {
    targetSuccesses,
    successfulChildren,
    activeTasks,
    deficit: fissionTopUpDeficit({targetSuccesses, successfulChildren, activeTasks}),
  };
}

function enqueuePoolFissionChildTask(parent: EmailRecord, template: K12Task, workspaceIds: string[], nextRemaining: number, notBefore?: string): K12Task {
  const child = createPoolFissionChild(parent);
  const childTask = enqueueK12Task(child, {
    route: template.route,
    workspaceIds,
    runWorkspaceJoin: template.runWorkspaceJoin,
    runSub2Api: template.runSub2Api,
    sub2apiNoRtMode: template.sub2apiNoRtMode === true,
    sub2apiGroupName: template.sub2apiGroupName,
    fissionRemainingAfterThis: nextRemaining,
    notBefore,
  });
  return childTask;
}

async function enqueueNextAvailablePoolFissionWorkspace(parent: EmailRecord, root: string, template: K12Task, skipWorkspaceIds: string[]): Promise<K12Task | undefined> {
  for (const workspaceIds of poolFissionWorkspaceVariantsForRoot(root, skipWorkspaceIds)) {
    if (taskWorkspaceKeysOverlap(workspaceIds, skipWorkspaceIds)) continue;
    const blockReason = exactWorkspaceBlockReason(parent.email, workspaceIds);
    if (blockReason) continue;
    if (poolMailboxOtpCooldownDelayMs(root, workspaceIds) > 0) continue;

    const {targetSuccesses, successfulChildren, deficit} = poolFissionDeficitForWorkspace(root, workspaceIds);
    if (deficit <= 0) continue;

    const childTask = enqueuePoolFissionChildTask(
      parent,
      template,
      workspaceIds,
      fissionTopUpRemainingAfterThis(deficit),
    );
    const workspaceText = workspaceIds[0] ? ` workspace=${workspaceIds[0]}` : "";
    appendLog(template, "info", `收码冷却轮转到下一个 workspace${workspaceText}: 当前 ${successfulChildren}/${targetSuccesses}，已创建补位子任务 ${childTask.email}`);
    appendLog(childTask, "info", `由母邮箱 ${root} 收码冷却轮转创建${workspaceText}，目标 ${targetSuccesses}，当前成功子号 ${successfulChildren}`);
    await Promise.all([persistTasks(), persistEmails()]);
    scheduleTasks();
    return childTask;
  }
  return undefined;
}

function normalizePoolUserAlreadyExistsCooldownRecords(): {tasksChanged: boolean; emailsChanged: boolean; normalized: number} {
  let tasksChanged = false;
  let emailsChanged = false;
  let normalized = 0;
  for (const task of tasks) {
    const email = emails.find((item) => item.id === task.emailId);
    if (!email) continue;
    if (!shouldCooldownPoolFissionAfterUserAlreadyExists({
      isSmsBowerMail: email.otpMode === "smsbower-mail",
      isChildEmail: Boolean(email.parentEmail),
      userAlreadyExists: taskHasOpenAiUserAlreadyExists(task, email),
    })) {
      continue;
    }

    const retryableError = task.error || email.lastError || "OpenAI user_already_exists，进入 400 冷却后可继续补分裂";
    const changedTask = task.status !== "failed" || task.error !== retryableError;
    if (changedTask) {
      task.status = "failed";
      task.error = retryableError;
      task.finishedAt = task.finishedAt || nowIso();
      task.updatedAt = nowIso();
      if (!(task.logs || []).some((log) => /已改为 400 冷却/.test(log.message || ""))) {
        appendLog(task, "warn", "历史 user_already_exists 子号已改为 400 冷却，可继续补分裂");
      }
      tasksChanged = true;
    }

    const changedEmail = email.status !== "failed"
      || email.lastError !== retryableError
      || email.lastTaskId !== task.id;
    if (changedEmail) {
      email.status = "failed";
      email.lastError = retryableError;
      email.lastTaskId = task.id;
      email.updatedAt = nowIso();
      emailsChanged = true;
    }

    if (changedTask || changedEmail) {
      normalized += 1;
    }
  }
  return {tasksChanged, emailsChanged, normalized};
}

async function normalizeAndPersistPoolUserAlreadyExistsCooldownRecords(): Promise<number> {
  const result = normalizePoolUserAlreadyExistsCooldownRecords();
  if (result.tasksChanged || result.emailsChanged) {
    await Promise.all([
      result.tasksChanged ? persistTasks() : Promise.resolve(),
      result.emailsChanged ? persistEmails() : Promise.resolve(),
    ]);
  }
  return result.normalized;
}

function activeFissionTasksForRoot(root: string, workspaceIds?: string[]): number {
  return relatedK12TasksForRoot(root, workspaceIds).filter((task) => task.status === "queued" || task.status === "running").length;
}

function fissionTargetForRoot(root: string, successfulChildren: number, requestedTarget?: unknown, workspaceIds?: string[]): number {
  const requested = requestedTarget === undefined ? 0 : asNumber(requestedTarget, 0, 0, 100);
  const taskCounterTarget = relatedK12TasksForRoot(root, workspaceIds)
    .map((task) => task.smsBowerFissionRemainingAfterThis)
    .filter((value): value is number => Number.isFinite(value))
    .reduce((max, value) => Math.max(max, value), 0);
  const rootEmail = emails.find((email) => email.email.toLowerCase() === root && !email.parentEmail);
  const remainingTarget = workspaceIds !== undefined || rootEmail?.smsBowerFissionChildrenRemaining === undefined
    ? 0
    : rootEmail.smsBowerFissionChildrenRemaining + successfulChildren;
  return Math.max(requested, taskCounterTarget, remainingTarget, successfulChildren);
}

function latestFissionTemplateTask(root: string, workspaceIds?: string[]): K12Task | undefined {
  const related = relatedK12TasksForRoot(root, workspaceIds);
  return [...related].sort((a, b) => {
    const aTime = Date.parse(a.finishedAt || a.updatedAt || a.createdAt);
    const bTime = Date.parse(b.finishedAt || b.updatedAt || b.createdAt);
    return (Number.isFinite(bTime) ? bTime : 0) - (Number.isFinite(aTime) ? aTime : 0);
  })[0];
}

async function createFissionTopUpTask(body: Record<string, unknown>): Promise<{
  created: K12Task[];
  rootEmail: string;
  targetSuccesses: number;
  successfulChildren: number;
  deficit: number;
  activeTasks: number;
}> {
  const root = asString(body.rootEmail).toLowerCase();
  if (!root) throw new Error("缺少母号邮箱");
  const requestedWorkspaceIds = uniqueStringList(parseStringList(body.workspaceIds));
  const scopedWorkspaceIds = requestedWorkspaceIds.length ? requestedWorkspaceIds.slice(0, 1) : undefined;
  const parent = emails.find((email) => email.email.toLowerCase() === root && !email.parentEmail);
  if (!parent) throw new Error(`找不到母号邮箱: ${root}`);
  if (parent.status === "banned") throw new Error(`母号已标记 GPT 封号，不能继续补分裂: ${root}`);
  const relatedTasks = relatedK12TasksForRoot(root, scopedWorkspaceIds);
  const hasSmsBowerHistory = hasSmsBowerFissionHistory({tasks: relatedTasks, emails});
  const useSmsBowerTopUp = parent.otpMode === "smsbower-mail" || (hasSmsBowerHistory && Boolean(parent.smsBowerMailId));
  const blockReason = fissionTopUpBlockReason({otpMode: parent.otpMode, hasSmsBowerHistory});
  if (blockReason) throw new Error(blockReason);

  const successfulChildren = successfulFissionChildrenForRoot(root, scopedWorkspaceIds);
  const activeTasks = activeFissionTasksForRoot(root, scopedWorkspaceIds);
  const targetSuccesses = fissionTargetForRoot(root, successfulChildren, body.targetSuccesses, scopedWorkspaceIds);
  const deficit = fissionTopUpDeficit({targetSuccesses, successfulChildren, activeTasks});
  if (deficit <= 0) {
    return {created: [], rootEmail: root, targetSuccesses, successfulChildren, deficit, activeTasks};
  }

  const template = latestFissionTemplateTask(root, scopedWorkspaceIds);
  if (!template) throw new Error(`找不到可复用的母号任务配置: ${root}`);

  if (useSmsBowerTopUp) {
    const smsBowerBlockedReason = smsBowerActivationBlockReason(parent);
    if (smsBowerBlockedReason) throw new Error(smsBowerBlockedReason);
    try {
      await requestSmsBowerNextMailCode(parent, template, "继续补分裂，已请求等待下一个验证码");
    } catch (error) {
      if (!isSmsBowerCodeLimitReachedMessage(error)) throw error;
      parent.smsBowerFissionChildrenRemaining = 0;
      parent.updatedAt = nowIso();
      appendLog(template, "ok", `SMSBower activation=${parent.smsBowerMailId || "-"} 验证码次数已达上限，按当前成功子号 ${successfulChildren} 个结束分裂`);
      return {
        created: [],
        rootEmail: root,
        targetSuccesses: successfulChildren,
        successfulChildren,
        deficit: 0,
        activeTasks,
      };
    }

    const child = createSmsBowerFissionChild(parent);
    const nextRemaining = fissionTopUpRemainingAfterThis(deficit);
    const childTask = enqueueK12Task(child, {
      route: template.route,
      workspaceIds: template.workspaceIds,
      runWorkspaceJoin: template.runWorkspaceJoin,
      runSub2Api: template.runSub2Api,
      sub2apiNoRtMode: template.sub2apiNoRtMode === true,
      sub2apiGroupName: template.sub2apiGroupName,
      fissionRemainingAfterThis: nextRemaining,
    });
    parent.smsBowerFissionChildrenRemaining = nextRemaining;
    parent.smsBowerFissionChildrenCreatedAt = nowIso();
    parent.updatedAt = nowIso();
    appendLog(template, "info", `继续补 SMSBower 分裂: ${root} 当前 ${successfulChildren}/${targetSuccesses}，已创建补位子任务 ${child.email}，缺口 ${deficit}`);
    appendLog(childTask, "info", `继续补 SMSBower 分裂创建，母邮箱 ${root}，复用 activation=${parent.smsBowerMailId || "-"}，目标 ${targetSuccesses}`);
    return {created: [childTask], rootEmail: root, targetSuccesses, successfulChildren, deficit, activeTasks};
  }

  const child = createPoolFissionChild(parent);
  const poolTopUpWorkspaceIds = template.workspaceIds || scopedWorkspaceIds || [];
  const poolTopUpCooldownMs = poolMailboxOtpCooldownDelayMs(root, poolTopUpWorkspaceIds);
  const poolTopUpNotBefore = poolTopUpCooldownMs > 0
    ? new Date(Date.now() + poolTopUpCooldownMs).toISOString()
    : undefined;

  const childTask = enqueueK12Task(child, {
    route: template.route,
    workspaceIds: template.workspaceIds,
    runWorkspaceJoin: template.runWorkspaceJoin,
    runSub2Api: template.runSub2Api,
    sub2apiNoRtMode: template.sub2apiNoRtMode === true,
    sub2apiGroupName: template.sub2apiGroupName,
    fissionRemainingAfterThis: fissionTopUpRemainingAfterThis(deficit),
    notBefore: poolTopUpNotBefore,
  });
  const cooldownText = poolTopUpNotBefore ? `，冷却后启动 notBefore=${poolTopUpNotBefore}` : "";
  appendLog(template, poolTopUpNotBefore ? "warn" : "info", `继续补分裂: ${root} 当前 ${successfulChildren}/${targetSuccesses}，已创建补位子任务 ${child.email}，缺口 ${deficit}${cooldownText}`);
  appendLog(childTask, "info", `继续补分裂创建，母邮箱 ${root}，目标 ${targetSuccesses}，当前成功子号 ${successfulChildren}${cooldownText}`);
  return {created: [childTask], rootEmail: root, targetSuccesses, successfulChildren, deficit, activeTasks};
}

function latestFinishedTaskAtMsForRoot(root: string, exceptTaskId: string): number | undefined {
  let latest = 0;
  for (const task of tasks) {
    if (task.id === exceptTaskId) continue;
    if (!task.finishedAt) continue;
    if (rootMailboxIdentityByEmailId(task.emailId) !== root) continue;
    const finishedAt = Date.parse(task.finishedAt);
    if (Number.isFinite(finishedAt) && finishedAt > latest) latest = finishedAt;
  }
  return latest || undefined;
}

async function waitForPoolFissionChildCooldown(task: K12Task, email: EmailRecord): Promise<void> {
  const root = rootMailboxIdentity(email);
  const delayMs = poolFissionCooldownDelayMs({
    isChildEmail: Boolean(email.parentEmail),
    isSmsBowerMail: email.otpMode === "smsbower-mail",
    nowMs: Date.now(),
    cooldownMs: POOL_FISSION_CHILD_COOLDOWN_MS,
    lastFinishedAtMs: latestFinishedTaskAtMsForRoot(root, task.id),
  });
  if (delayMs <= 0) return;
  appendLog(task, "info", `同母邮箱分裂冷却 ${Math.ceil(delayMs / 1000)} 秒，避免验证码投递过密`);
  await sleepForTask(task, delayMs);
}

function randomAliasSuffix(length = 6): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz";
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += alphabet[randomInt(0, alphabet.length)];
  }
  return out;
}

function buildPlusAlias(email: string, suffix: string): string {
  const [local, domain] = email.split("@");
  if (!local || !domain) throw new Error(`邮箱格式不正确，不能分裂: ${email}`);
  const baseLocal = local.split("+")[0];
  return `${baseLocal}+${suffix}@${domain}`;
}

function findPoolFissionParent(email: EmailRecord): EmailRecord {
  const parentEmail = rootMailboxIdentity(email);
  return emails.find((item) => item.email.toLowerCase() === parentEmail && !item.parentEmail) || email;
}

function createPoolFissionChild(parent: EmailRecord): EmailRecord {
  const parentEmail = rootMailboxIdentity(parent);
  const byEmail = new Set(emails.map((item) => item.email.toLowerCase()));
  let alias = "";
  for (let attempt = 0; attempt < 20; attempt += 1) {
    alias = buildPlusAlias(parentEmail, randomAliasSuffix(6));
    if (!byEmail.has(alias.toLowerCase())) break;
    alias = "";
  }
  if (!alias) throw new Error(`邮箱池裂变失败：无法生成唯一子邮箱 ${parentEmail}`);
  const record: EmailRecord = {
    id: stableId(alias),
    email: alias,
    parentEmail,
    otpMode: parent.otpMode || "auto",
    password: parent.password,
    mailboxUrl: parent.mailboxUrl,
    clientId: parent.clientId,
    refreshToken: parent.refreshToken,
    raw: `${alias}----alias-of----${parentEmail}`,
    status: "free",
    importedAt: nowIso(),
    updatedAt: nowIso(),
    smsBowerMailId: parent.smsBowerMailId,
    smsBowerMailRoot: parent.smsBowerMailRoot || parentEmail,
    smsBowerMailCost: parent.smsBowerMailCost,
  };
  emails.push(record);
  return record;
}

function splitEmails(ids: string[], perParent: number): {created: number; skipped: number; items: Array<{parentEmail: string; email: string}>} {
  const requested = new Set(ids.filter(Boolean));
  const processedParents = new Set<string>();
  const createdItems: Array<{parentEmail: string; email: string}> = [];
  let skipped = 0;

  for (const parent of emails.filter((item) => requested.has(item.id))) {
    const parentEmail = rootMailboxIdentity(parent);
    if (processedParents.has(parentEmail)) {
      skipped += 1;
      continue;
    }
    processedParents.add(parentEmail);
    const smsBowerBlockedReason = smsBowerActivationBlockReason(parent);
    if (smsBowerBlockedReason) {
      parent.status = "failed";
      parent.lastError = smsBowerBlockedReason;
      parent.updatedAt = nowIso();
      skipped += 1;
      continue;
    }
    if (parent.status === "running" || hasActiveTask(parent.id)) {
      skipped += 1;
      continue;
    }
    for (let i = 0; i < perParent; i += 1) {
      try {
        const record = createPoolFissionChild(parent);
        createdItems.push({parentEmail, email: record.email});
      } catch {
        skipped += 1;
      }
    }
  }

  return {created: createdItems.length, skipped, items: createdItems.slice(0, 40)};
}

interface BundleModules {
  OpenAIClient: any;
  generateRandomDeviceProfile: any;
  Sub2ApiClient: any;
  MailboxUrlCodeProvider: any;
}

let bundleModulesPromise: Promise<BundleModules> | undefined;

async function loadBundleModules(): Promise<BundleModules> {
  if (!bundleModulesPromise) {
    bundleModulesPromise = (async () => {
      await ensureCompatBundleConfig();
      const srcDir = path.join(appConfig.referenceBundlePath, "codex_register", "src");
      const openaiPath = pathToFileURL(path.join(srcDir, "openai.ts")).href;
      const devicePath = pathToFileURL(path.join(srcDir, "device-profile.ts")).href;
      const sub2ApiPath = pathToFileURL(path.join(srcDir, "sub2api.ts")).href;
      const mailboxPath = pathToFileURL(path.join(srcDir, "mailbox-url.ts")).href;
      const [openai, device, sub2api, mailbox] = await Promise.all([
        import(openaiPath),
        import(devicePath),
        import(sub2ApiPath),
        import(mailboxPath),
      ]);
      return {
        OpenAIClient: openai.OpenAIClient,
        generateRandomDeviceProfile: device.generateRandomDeviceProfile,
        Sub2ApiClient: sub2api.Sub2ApiClient,
        MailboxUrlCodeProvider: mailbox.MailboxUrlCodeProvider,
      };
    })().catch((error) => {
      bundleModulesPromise = undefined;
      throw error;
    });
  }
  return bundleModulesPromise;
}

function assertNotCanceled(task: K12Task): void {
  if (task.cancelRequested) {
    throw new Error("任务已取消");
  }
}

function isAddPhoneUrl(value: string): boolean {
  return value.startsWith(`${AUTH_BASE_URL}/add-phone`);
}

function isAddPhoneFlowError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /\/add-phone|add-phone/i.test(message);
}

function isInvalidPasswordError(error: unknown): boolean {
  const message = error instanceof Error
    ? error.message
    : typeof error === "object" && error && "message" in error
      ? String((error as {message?: unknown}).message || "")
      : String(error);
  return /invalid_username_or_password|Login failed|PasswordVerify/i.test(message);
}

function isInvalidAuthStateError(error: unknown): boolean {
  const message = error instanceof Error
    ? error.message
    : typeof error === "object" && error && "message" in error
      ? String((error as {message?: unknown}).message || "")
      : String(error);
  return isRecoverableWorkspaceSelectError(message) || /Invalid authorization step/i.test(message);
}

function isOpenAiAccountBannedMessage(value: unknown): boolean {
  const message = value instanceof Error ? value.message : String(value || "");
  return /account_deactivated|account disabled|account has been (?:deleted|deactivated|disabled|suspended)|account.*(?:suspended|banned|terminated|deactivated|disabled)|user.*(?:suspended|banned|deactivated|disabled)|账号已停用|账户已停用|账号已被删除|账户已被删除|账号已封|账号被封|封号|被封禁|停用/i.test(message);
}

function isEmailOtpSendStepError(error: unknown): boolean {
  const message = error instanceof Error
    ? error.message
    : typeof error === "object" && error && "message" in error
      ? String((error as {message?: unknown}).message || "")
      : String(error);
  return message.includes(AUTH_EMAIL_OTP_SEND_URL) || /email-otp\/send/i.test(message);
}

function authStepFromError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const knownSteps = [
    `${AUTH_BASE_URL}/log-in/password`,
    AUTH_CREATE_ACCOUNT_PASSWORD_URL,
    AUTH_EMAIL_OTP_SEND_URL,
    `${AUTH_BASE_URL}/email-verification`,
    AUTH_ABOUT_YOU_URL,
    `${AUTH_BASE_URL}/add-phone`,
    `${AUTH_BASE_URL}/add-email`,
    CODEX_CONSENT_URL,
  ];
  return knownSteps.find((step) => message.includes(step)) || "";
}

function normalizeFlowError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (isOpenAiAccountBannedMessage(message)) return "GPT 账号已被 OpenAI 停用/封禁";
  if (isGoogleSsoUnsupportedMessage(message)) {
    return googleSsoUnsupportedReason();
  }
  if (isAddPhoneFlowError(error)) {
    return "登录后触发 add-phone 手机接码页面，按 K12 规则判定失败";
  }
  return message;
}

function googleSsoUnsupportedReason(): string {
  return "OpenAI 识别为 Google 登录账号，当前自动流程不支持 Google OAuth，请换非 Google SSO 的 Gmail";
}

async function sleep(ms: number): Promise<void> {
  if (ms > 0) await new Promise((resolve) => setTimeout(resolve, ms));
}

async function sleepForTask(task: K12Task, ms: number): Promise<void> {
  const deadline = Date.now() + Math.max(0, ms);
  while (Date.now() < deadline) {
    assertNotCanceled(task);
    await sleep(Math.min(250, deadline - Date.now()));
  }
  assertNotCanceled(task);
}

async function sendK12Invite(task: K12Task, client: any, accessToken: string, workspaceId: string, route: K12Route): Promise<K12WorkspaceResult> {
  let last: K12WorkspaceResult | null = null;
  const maxAttempts = appConfig.joinMaxRetries + 1;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    assertNotCanceled(task);
    const url = `https://chatgpt.com/backend-api/accounts/${encodeURIComponent(workspaceId)}/invites/${route}`;
    appendLog(task, "info", `K12 ${route}: POST ${workspaceId.slice(0, 8)}... 第 ${attempt} 次`);
    try {
      const response = await client.fetch(url, {
        method: "POST",
        headers: {
          accept: "*/*",
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
          origin: CHATGPT_BASE_URL,
          referer: `${CHATGPT_BASE_URL}/`,
          "oai-device-id": randomUUID(),
          "oai-language": "zh-CN",
          "user-agent": "Mozilla/5.0 K12SpaceConsole/0.1",
        },
        body: "",
      });
      const body = await response.text();
      last = {
        workspaceId,
        route,
        ok: response.ok,
        status: response.status,
        body: body.slice(0, 500),
        attempt,
      };
      if (response.ok) {
        appendLog(task, "ok", `K12 ${workspaceId.slice(0, 8)}... HTTP ${response.status}`);
        return last;
      }
      appendLog(task, "warn", `K12 ${workspaceId.slice(0, 8)}... HTTP ${response.status}: ${body.slice(0, 180)}`);
      if (isSameDomainWorkspaceError(response.status, body)) {
        appendLog(task, "warn", `K12 ${workspaceId.slice(0, 8)}... 拒绝跨域邮箱申请，跳过该 workspace 后续重试`);
        break;
      }
    } catch (error) {
      last = {workspaceId, route, ok: false, status: 0, body: error instanceof Error ? error.message : String(error), attempt};
      appendLog(task, "warn", `K12 ${workspaceId.slice(0, 8)}... 网络错误: ${last.body}`);
    }
    if (shouldRetryK12Invite(attempt, maxAttempts, last?.status ?? 0, last?.body ?? "")) {
      await sleep(appConfig.joinIntervalMs * attempt);
    }
  }
  return last || {workspaceId, route, ok: false, status: 0, body: "未执行", attempt: 0};
}

async function appendTokenOut(token: string): Promise<void> {
  const filePath = appConfig.tokenOut;
  if (!filePath || !token) return;
  await mkdir(path.dirname(filePath), {recursive: true});
  const existing = await readFile(filePath, "utf8").catch(() => "");
  if (existing.includes(token)) return;
  await writeFile(filePath, `${existing}${existing && !existing.endsWith("\n") ? "\n" : ""}${token}\n`, "utf8");
}

async function hydrateTaskAccessTokensFromTokenOut(): Promise<boolean> {
  const filePath = appConfig.tokenOut;
  if (!filePath) return false;
  const raw = await readFile(filePath, "utf8").catch(() => "");
  const tokens = raw
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
  if (!tokens.length) return false;

  let changed = false;
  for (const token of tokens) {
    const info = summarizeToken(token);
    if (!info.hash) continue;
    for (const task of tasks) {
      if (task.accessToken) continue;
      if (task.accessTokenHash && task.accessTokenHash === info.hash) {
        task.accessToken = token;
        changed = true;
        continue;
      }
      if (task.accessTokenPreview && task.accessTokenPreview === info.preview) {
        task.accessToken = token;
        task.accessTokenHash ||= info.hash;
        changed = true;
      }
    }
  }
  return changed;
}

async function ensureChatGptCsrfCookie(client: any): Promise<void> {
  if (typeof client.readCookie !== "function") return;
  const existing = await client.readCookie(CHATGPT_BASE_URL, "__Host-next-auth.csrf-token").catch(() => "");
  if (existing) return;

  await client.fetch(`${CHATGPT_BASE_URL}/api/auth/csrf`, {
    method: "GET",
    headers: oauthBrowserHeaders(client, {
      accept: "application/json",
      referer: `${CHATGPT_BASE_URL}/`,
      "sec-fetch-dest": "empty",
      "sec-fetch-mode": "cors",
      "sec-fetch-site": "same-origin",
    }),
  }).catch(() => undefined);
}

async function sendEmailOtpForLogin(client: any, referer = `${AUTH_BASE_URL}/log-in/password`): Promise<string> {
  const response = await client.fetch(AUTH_PASSWORDLESS_SEND_OTP_URL, {
    method: "POST",
    headers: oauthBrowserHeaders(client, {
      accept: "application/json",
      "content-type": "application/json",
      origin: AUTH_BASE_URL,
      referer,
      "sec-fetch-dest": "empty",
      "sec-fetch-mode": "cors",
      "sec-fetch-site": "same-origin",
    }),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`PasswordlessSendOtp 请求失败: HTTP ${response.status} ${body.slice(0, 500)}`);
  }
  const payload = (await response.json()) as {continue_url?: string; page?: {payload?: {url?: string}}};
  const nextUrl = String(payload.page?.payload?.url || payload.continue_url || `${AUTH_BASE_URL}/email-verification`);
  return new URL(nextUrl, AUTH_BASE_URL).toString();
}

async function sendEmailOtpForSignup(client: any, referer = AUTH_CREATE_ACCOUNT_PASSWORD_URL): Promise<string> {
  const response = await client.fetch(AUTH_EMAIL_OTP_SEND_URL, {
    method: "GET",
    headers: oauthBrowserHeaders(client, {
      accept: "application/json",
      referer,
      "sec-fetch-dest": "empty",
      "sec-fetch-mode": "cors",
      "sec-fetch-site": "same-origin",
    }),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`EmailOtpSendSignup 请求失败: HTTP ${response.status} ${body.slice(0, 500)}`);
  }
  const payload = (await response.json()) as {continue_url?: string};
  return String(payload.continue_url || "");
}

function randomProfile(): {name: string; birthdate: string} {
  const firstNames = [
    "Ethan",
    "Noah",
    "Liam",
    "Mason",
    "Lucas",
    "Logan",
    "Owen",
    "Ryan",
    "Leo",
    "Adam",
    "Ella",
    "Ava",
    "Mia",
    "Luna",
    "Chloe",
    "Grace",
    "Ruby",
    "Nora",
    "Ivy",
    "Sofia",
  ];
  const lastNames = [
    "Smith",
    "Brown",
    "Taylor",
    "Walker",
    "Wilson",
    "Clark",
    "Hall",
    "Young",
    "Allen",
    "King",
    "Scott",
    "Green",
    "Baker",
    "Adams",
    "Turner",
  ];
  const pick = (items: string[]) => items[Math.floor(Math.random() * items.length)];
  const randomInt = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;
  const age = randomInt(25, 34);
  const today = new Date();
  const birthYear = today.getFullYear() - age;
  const birthMonth = randomInt(1, 12);
  const maxDay = new Date(birthYear, birthMonth, 0).getDate();
  const birthDay = randomInt(1, maxDay);
  return {
    name: `${pick(firstNames)} ${pick(lastNames)}`,
    birthdate: [
      birthYear,
      `${birthMonth}`.padStart(2, "0"),
      `${birthDay}`.padStart(2, "0"),
    ].join("-"),
  };
}

async function readAuthJsonResponse(response: Response): Promise<{continue_url?: string; page?: {payload?: {url?: string}}}> {
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`CreateAccount 请求失败: HTTP ${response.status} ${text.slice(0, 500)}`);
  }
  try {
    return JSON.parse(text) as {continue_url?: string; page?: {payload?: {url?: string}}};
  } catch {
    throw new Error(`CreateAccount 响应不是 JSON: ${text.slice(0, 300)}`);
  }
}

async function completeAboutYou(client: any, task?: K12Task): Promise<string> {
  const profile = randomProfile();
  if (task) appendLog(task, "info", `about-you 创建资料: ${profile.name}, ${profile.birthdate}`);
  const sentinelToken = typeof client.fetchSentinelToken === "function"
    ? await client.fetchSentinelToken("oauth_create_account")
    : "";
  const response = await client.fetch(`${AUTH_BASE_URL}/api/accounts/create_account`, {
    method: "POST",
    headers: oauthBrowserHeaders(client, {
      accept: "application/json",
      "content-type": "application/json",
      origin: AUTH_BASE_URL,
      referer: AUTH_ABOUT_YOU_URL,
      "sec-fetch-dest": "empty",
      "sec-fetch-mode": "cors",
      "sec-fetch-site": "same-origin",
      ...(sentinelToken ? {"openai-sentinel-token": sentinelToken} : {}),
    }),
    body: JSON.stringify(profile),
  });
  const payload = await readAuthJsonResponse(response);
  return String(payload.page?.payload?.url || payload.continue_url || "");
}

async function selectAuthWorkspace(client: any, task?: K12Task, referer = AUTH_WORKSPACE_URL): Promise<string> {
  const workspaceIds = task ? targetK12WorkspaceIds(task) : appConfig.workspaceIds;
  const authSessions = await getAuthSessionCandidates(client);
  let candidates = authWorkspaceSelectionCandidates(authSessions, workspaceIds);
  if (!candidates.length) {
    candidates = Array.from(new Set(workspaceIds.filter(Boolean)));
  }
  if (task && candidates.length) {
    appendLog(task, "info", `auth workspace 可选: ${candidates.map((item) => item.slice(0, 8)).join(", ")}`);
  }
  let lastError = "";

  for (const workspaceId of candidates) {
    if (task) appendLog(task, "info", `auth workspace/select: ${workspaceId}`);
    const response = await client.fetch(AUTH_WORKSPACE_SELECT_URL, {
      method: "POST",
      headers: oauthBrowserHeaders(client, {
        accept: "application/json",
        "content-type": "application/json",
        origin: AUTH_BASE_URL,
        referer,
        "sec-fetch-dest": "empty",
        "sec-fetch-mode": "cors",
        "sec-fetch-site": "same-origin",
      }),
      body: JSON.stringify({workspace_id: workspaceId}),
    });
    const text = await response.text().catch(() => "");
    if (!response.ok) {
      lastError = `workspace_id=${workspaceId} HTTP ${response.status}: ${text.slice(0, 240)}`;
      if (task) appendLog(task, "warn", lastError);
      if (isUnavailableWorkspaceSelectError(response.status, text)) {
        await removeUnavailableWorkspaceIdFromState(workspaceId, lastError, task);
      }
      continue;
    }
    try {
      const data = JSON.parse(text) as {continue_url?: string; page?: {payload?: {url?: string}}};
      const nextUrl = String(data.page?.payload?.url || data.continue_url || "");
      if (nextUrl) return new URL(nextUrl, AUTH_BASE_URL).toString();
      lastError = `workspace_id=${workspaceId} 响应缺少 continue_url: ${text.slice(0, 240)}`;
    } catch {
      lastError = `workspace_id=${workspaceId} 非 JSON 响应: ${text.slice(0, 240)}`;
    }
    if (task) appendLog(task, "warn", lastError);
  }

  throw new Error(`auth workspace/select 失败: ${lastError || "unknown"}`);
}

async function finishChatGptCallback(client: any, callbackUrl: string, task?: K12Task, referer = AUTH_BASE_URL): Promise<void> {
  const log = (level: LogLevel, message: string) => {
    if (task) appendLog(task, level, message);
  };
  log("info", "完成 ChatGPT callback，建立 Web session");
  const response = await client.fetch(callbackUrl, {
    method: "GET",
    redirect: "follow",
    headers: oauthBrowserHeaders(client, {
      referer,
      "sec-fetch-dest": "document",
      "sec-fetch-mode": "navigate",
      "sec-fetch-site": "same-site",
    }),
  });
  if (!response.ok) {
    throw new Error(`完成 ChatGPT callback 失败: HTTP ${response.status}`);
  }
}

async function emailOtpValidateWithRetry(client: any, task?: K12Task): Promise<string> {
  try {
    return await client.emailOtpValidate();
  } catch (error) {
    if (!task || !isWrongEmailOtpCodeMessage(error)) throw error;
    const email = emails.find((item) => item.id === task.emailId);
    if (!email) throw error;
    if (email.otpMode === "smsbower-mail") {
      appendLog(task, "warn", "OpenAI 判定邮箱验证码错误，SMSBower 请求下一封验证码后重试一次");
      await requestSmsBowerNextMailCode(email, task, "邮箱验证码错误后请求下一封");
      if (shouldResendLoginOtpAfterWrongCode({otpMode: email.otpMode})) {
        appendLog(task, "info", "OpenAI 判定邮箱验证码错误，准备重新请求发送登录验证码");
        const nextUrl = await sendEmailOtpForLogin(client, `${AUTH_BASE_URL}/email-verification`);
        appendLog(task, "ok", loginOtpSendSuccessMessage(nextUrl));
      }
      const code = await waitForSmsBowerMailCode(email, task, "登录重试");
      return client.emailOtpValidate(code);
    }
    if (shouldResendLoginOtpAfterWrongCode({otpMode: email.otpMode})) {
      appendLog(task, "info", "OpenAI 判定邮箱验证码错误，准备重新请求发送登录验证码");
      const nextUrl = await sendEmailOtpForLogin(client, `${AUTH_BASE_URL}/email-verification`);
      appendLog(task, "ok", loginOtpSendSuccessMessage(nextUrl));
    }
    task.freshEmailOtpOnlyOnce = true;
    appendLog(task, "warn", "OpenAI 判定邮箱验证码错误，重新等待下一封新验证码后重试一次");
    return client.emailOtpValidate();
  }
}

async function continueAuthSteps(
  client: any,
  startUrl: string,
  task: K12Task | undefined,
  options: {finishChatGptCallback?: boolean; allowConsent?: boolean} = {},
): Promise<string> {
  const log = (level: LogLevel, message: string) => {
    if (task) appendLog(task, level, message);
  };
  let continueUrl = startUrl;
  let emailOtpSentInFlow = false;

  for (let step = 0; step < 12; step += 1) {
    log("info", `OpenAI auth step: ${continueUrl}`);

    if (continueUrl === `${AUTH_BASE_URL}/log-in/password`) {
      log("warn", "当前账号进入密码页；按配置不提交密码，尝试改走邮箱验证码登录");
      try {
        continueUrl = await sendEmailOtpForLogin(client, `${AUTH_BASE_URL}/log-in/password`);
        log("ok", loginOtpSendSuccessMessage(continueUrl));
        emailOtpSentInFlow = true;
      } catch (error) {
        throw new Error(
          `账号当前被 OpenAI 判定为密码登录步骤，已按配置尝试邮箱验证码登录，但 OpenAI 未允许发送邮箱验证码；该账号无法仅凭邮箱接码登录。原始错误：${error instanceof Error ? error.message : String(error)}`,
        );
      }
      if (!continueUrl) {
        throw new Error("账号当前被 OpenAI 判定为密码登录步骤，已按配置尝试邮箱验证码登录，但 OpenAI 未返回下一步 continue_url");
      }
      continue;
    }

    if (continueUrl === AUTH_CREATE_ACCOUNT_PASSWORD_URL) {
      log("info", "新增邮箱账号要求创建密码，提交默认密码后继续");
      if (typeof client.registerPassword !== "function") {
        throw new Error("新增账号需要创建密码，但参考 OpenAIClient 未暴露 registerPassword()");
      }
      continueUrl = await client.registerPassword();
      continue;
    }

    if (continueUrl === AUTH_EMAIL_OTP_SEND_URL) {
      log("info", "OpenAI 要求发送邮箱验证码");
      continueUrl = await sendEmailOtpForSignup(client, AUTH_CREATE_ACCOUNT_PASSWORD_URL);
      emailOtpSentInFlow = true;
      continue;
    }

    if (continueUrl === `${AUTH_BASE_URL}/email-verification`) {
      if (shouldSendLoginOtpBeforeEmailVerification({otpSentInFlow: emailOtpSentInFlow})) {
        log("info", "直接进入邮箱验证码页，本轮未触发发码，先重新请求发送登录验证码");
        try {
          continueUrl = await sendEmailOtpForLogin(client, `${AUTH_BASE_URL}/email-verification`);
          log("ok", loginOtpSendSuccessMessage(continueUrl));
        } catch (error) {
          throw new Error(loginOtpSendFailureMessage(error));
        }
        emailOtpSentInFlow = true;
        continue;
      }
      log("info", "等待邮箱验证码并提交");
      continueUrl = await emailOtpValidateWithRetry(client, task);
      continue;
    }

    if (continueUrl === AUTH_ABOUT_YOU_URL) {
      log("info", "首次登录要求填写基础资料");
      continueUrl = await completeAboutYou(client, task);
      continue;
    }

    if (continueUrl === AUTH_WORKSPACE_URL || continueUrl.startsWith(`${AUTH_WORKSPACE_URL}?`)) {
      log("info", "登录要求选择 workspace，优先选择配置的 K12 空间");
      continueUrl = await selectAuthWorkspace(client, task, continueUrl);
      continue;
    }

    if (continueUrl === `${AUTH_BASE_URL}/add-phone`) {
      throw new Error("登录后触发 add-phone 手机接码页面，按 K12 规则判定失败");
    }

    if (continueUrl === `${AUTH_BASE_URL}/add-email`) {
      throw new Error("登录触发 add-email；K12 当前流程使用邮箱账号登录，未配置额外绑定邮箱");
    }

    if (options.allowConsent && continueUrl.startsWith(CODEX_CONSENT_URL)) {
      continueUrl = await continueCodexConsent(client, continueUrl, task);
      continue;
    }

    if (options.finishChatGptCallback && continueUrl.startsWith(`${CHATGPT_BASE_URL}/api/auth/callback/openai`)) {
      await finishChatGptCallback(client, continueUrl, task, AUTH_ABOUT_YOU_URL);
      return continueUrl;
    }

    return continueUrl;
  }

  throw new Error(`OpenAI auth step 处理次数过多，最后停在 ${continueUrl}`);
}

async function loginAuthFlowWithEmailOtp(
  client: any,
  task: K12Task | undefined,
  options: {finishChatGptCallback?: boolean; allowConsent?: boolean} = {},
): Promise<string> {
  let continueUrl = await client.authorizeContinue();
  return continueAuthSteps(client, continueUrl, task, options);
}

async function loginChatGptWebAndGetAccessToken(client: any, task: K12Task, emailAddress: string): Promise<string> {
  assertNotCanceled(task);
  appendLog(task, "info", `登录 ChatGPT Web session: ${emailAddress}`);
  await ensureChatGptCsrfCookie(client);
  try {
    await client.authLoginChatGPTWeb();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (isInvalidAuthStateError(error)) {
      appendLog(task, "warn", "登录 auth session 已失效，重新打开 ChatGPT auth 入口后接管流程");
      const nextUrl = await openChatGptAuthEntryForWorkspaceSwitch(client, task);
      await continueAuthSteps(client, nextUrl, task, {finishChatGptCallback: true});
    } else if (isInvalidPasswordError(error)) {
      appendLog(task, "warn", "登录流程进入密码验证失败；按配置改走邮箱验证码登录");
      await continueAuthSteps(client, `${AUTH_BASE_URL}/log-in/password`, task, {finishChatGptCallback: true});
    } else if (isEmailOtpSendStepError(error)) {
      appendLog(task, "warn", "登录流程要求邮箱验证码，开始邮件接码");
      await continueAuthSteps(client, authStepFromError(error) || AUTH_EMAIL_OTP_SEND_URL, task, {finishChatGptCallback: true});
    } else if (message.includes(AUTH_WORKSPACE_URL)) {
      appendLog(task, "warn", "登录流程停在 workspace 选择页，自动选择 K12 空间");
      await continueAuthSteps(client, AUTH_WORKSPACE_URL, task, {finishChatGptCallback: true});
    } else if (authStepFromError(error)) {
      appendLog(task, "warn", `接管 OpenAI auth step: ${authStepFromError(error)}`);
      await continueAuthSteps(client, authStepFromError(error), task, {finishChatGptCallback: true});
    } else if (!/__Host-next-auth\.csrf-token|csrf-token/i.test(message)) {
      throw error;
    } else {
      appendLog(task, "warn", "首次未拿到 ChatGPT csrf cookie，刷新 /api/auth/csrf 后重试一次");
      await client.fetch(`${CHATGPT_BASE_URL}/api/auth/csrf`, {
        method: "GET",
        headers: oauthBrowserHeaders(client, {
          accept: "application/json",
          referer: `${CHATGPT_BASE_URL}/`,
          "sec-fetch-dest": "empty",
          "sec-fetch-mode": "cors",
          "sec-fetch-site": "same-origin",
        }),
      });
      try {
        await client.authLoginChatGPTWeb();
      } catch (retryError) {
        if (isInvalidAuthStateError(retryError)) {
          appendLog(task, "warn", "重试后 auth session 仍失效，重新打开 ChatGPT auth 入口后接管流程");
          const nextUrl = await openChatGptAuthEntryForWorkspaceSwitch(client, task);
          await continueAuthSteps(client, nextUrl, task, {finishChatGptCallback: true});
          return readChatGptAccessTokenWithRetry(client, task);
        }
        if (isEmailOtpSendStepError(retryError)) {
          appendLog(task, "warn", "重试后进入邮箱验证码流程，开始邮件接码");
          await continueAuthSteps(client, authStepFromError(retryError) || AUTH_EMAIL_OTP_SEND_URL, task, {finishChatGptCallback: true});
          return readChatGptAccessTokenWithRetry(client, task);
        }
        if (String(retryError instanceof Error ? retryError.message : retryError).includes(AUTH_WORKSPACE_URL)) {
          appendLog(task, "warn", "重试后停在 workspace 选择页，自动选择 K12 空间");
          await continueAuthSteps(client, AUTH_WORKSPACE_URL, task, {finishChatGptCallback: true});
          return readChatGptAccessTokenWithRetry(client, task);
        }
        if (authStepFromError(retryError)) {
          appendLog(task, "warn", `重试后接管 OpenAI auth step: ${authStepFromError(retryError)}`);
          await continueAuthSteps(client, authStepFromError(retryError), task, {finishChatGptCallback: true});
          return readChatGptAccessTokenWithRetry(client, task);
        }
        if (!isInvalidPasswordError(retryError)) throw retryError;
        appendLog(task, "warn", "重试后仍进入密码验证失败；按配置改走邮箱验证码登录");
        await continueAuthSteps(client, `${AUTH_BASE_URL}/log-in/password`, task, {finishChatGptCallback: true});
        return readChatGptAccessTokenWithRetry(client, task);
      }
    }
  }
  appendLog(task, "info", "读取 https://chatgpt.com/api/auth/session accessToken");
  return readChatGptAccessTokenWithRetry(client, task);
}

async function readChatGptAccessTokenWithRetry(client: any, task: K12Task, attempts = 6): Promise<string> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return String(await client.getChatGPTAccessToken());
    } catch (error) {
      lastError = error;
      if (!isMissingChatGptAccessTokenError(error) || attempt >= attempts) break;
      appendLog(task, "warn", `ChatGPT session 暂无 accessToken，等待后重读 (${attempt}/${attempts})`);
      await sleepForTask(task, 1500 * attempt);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function extractAccessTokenFromCredentials(credentials: Record<string, unknown>): string {
  return String(credentials.access_token || credentials.accessToken || "").trim();
}

function recordAccessToken(task: K12Task, email: EmailRecord, accessToken: string): void {
  const tokenInfo = summarizeToken(accessToken);
  task.accessToken = accessToken;
  task.accessTokenHash = tokenInfo.hash;
  task.accessTokenPreview = tokenInfo.preview;
  task.accessTokenEmail = tokenInfo.email || email.email;
  task.accessTokenExpiresAt = tokenInfo.expiresAt;
  email.lastAccessTokenHash = tokenInfo.hash;
  appendLog(task, "ok", `AT 获取成功: ${tokenInfo.preview} plan=${tokenInfo.planType || "?"} account=${tokenInfo.accountId ? tokenInfo.accountId.slice(0, 8) : "?"}`);
}

function markEmailBanned(email: EmailRecord, reason: string, task?: K12Task): void {
  email.status = "banned";
  email.lastError = reason;
  email.updatedAt = nowIso();
  for (const queuedTask of tasks) {
    if (queuedTask.emailId !== email.id || queuedTask.id === task?.id || queuedTask.status !== "queued") continue;
    queuedTask.status = "failed";
    queuedTask.error = reason;
    queuedTask.finishedAt = nowIso();
    queuedTask.updatedAt = nowIso();
    appendLog(queuedTask, "error", `当前邮箱记录已标记 GPT 封号，队列任务跳过: ${reason}`);
  }
  if (task) {
    task.error = reason;
    task.updatedAt = nowIso();
    appendLog(task, "error", `当前邮箱记录已标记 GPT 封号: ${reason}`);
  }
}

function markEmailRegistrationExhausted(email: EmailRecord, reason: string, task?: K12Task): void {
  email.status = "banned";
  email.lastError = reason;
  email.smsBowerFissionChildrenRemaining = 0;
  email.updatedAt = nowIso();
  for (const queuedTask of tasks) {
    if (queuedTask.emailId !== email.id || queuedTask.id === task?.id || queuedTask.status !== "queued") continue;
    queuedTask.status = "failed";
    queuedTask.error = reason;
    queuedTask.finishedAt = nowIso();
    queuedTask.updatedAt = nowIso();
    appendLog(queuedTask, "warn", `当前邮箱已存在或达到注册上限，队列任务跳过: ${reason}`);
  }
  if (task) {
    task.error = reason;
    task.updatedAt = nowIso();
    appendLog(task, "warn", `当前邮箱已存在或达到注册上限，停止继续使用: ${reason}`);
  }
}

function normalizeChatGptUserId(auth: Record<string, unknown>): string {
  const direct = asString(auth.chatgpt_user_id || auth.user_id);
  if (direct) return direct;
  const accountUserId = asString(auth.chatgpt_account_user_id);
  return accountUserId.includes("__") ? accountUserId.split("__")[0] : accountUserId;
}

function targetK12WorkspaceIds(task: K12Task): string[] {
  return Array.from(new Set((task.workspaceIds.length ? task.workspaceIds : appConfig.workspaceIds)
    .map((item) => item.trim())
    .filter(Boolean)));
}

function targetNoRtFallbackWorkspaceIds(task: K12Task): string[] {
  return mergeWorkspaceFallbackIds(targetK12WorkspaceIds(task), appConfig.workspaceIds);
}

function isK12AccessToken(accessToken: string, task: K12Task): boolean {
  const tokenInfo = summarizeToken(accessToken);
  const plan = tokenInfo.planType.toLowerCase();
  const targetIds = new Set(targetK12WorkspaceIds(task).map((item) => item.toLowerCase()));
  return plan === "k12" || (!!tokenInfo.accountId && targetIds.has(tokenInfo.accountId.toLowerCase()));
}

function describeAccessTokenContext(accessToken: string): string {
  const tokenInfo = summarizeToken(accessToken);
  return `plan=${tokenInfo.planType || "?"} account=${tokenInfo.accountId || "?"} email=${tokenInfo.email || "?"}`;
}

function safeUrlForLog(value: string): string {
  try {
    const url = new URL(value, AUTH_BASE_URL);
    return `${url.origin}${url.pathname}`;
  } catch {
    return value.length > 120 ? `${value.slice(0, 120)}...` : value;
  }
}

async function readChatGptSessionAccessToken(client: any, task: K12Task, reason: string): Promise<string> {
  appendLog(task, "info", `重新读取 ChatGPT Web AT: ${reason}`);
  const token = await readChatGptAccessTokenWithRetry(client, task);
  appendLog(task, "info", `当前 Web AT 上下文: ${describeAccessTokenContext(token)}`);
  return token;
}

function findWorkspaceInAccountsCheck(payload: unknown, workspaceId: string): Record<string, unknown> | null {
  if (!payload || typeof payload !== "object") return null;
  const data = payload as Record<string, unknown>;
  const accounts = data.accounts;
  if (accounts && typeof accounts === "object" && !Array.isArray(accounts)) {
    const direct = (accounts as Record<string, unknown>)[workspaceId];
    if (direct && typeof direct === "object") return direct as Record<string, unknown>;
  }
  if (Array.isArray(accounts)) {
    for (const item of accounts) {
      if (!item || typeof item !== "object") continue;
      const record = item as Record<string, unknown>;
      const account = (record.account && typeof record.account === "object" ? record.account : record) as Record<string, unknown>;
      const id = asString(account.account_id || account.id || record.id);
      if (id === workspaceId) return record;
    }
  }
  return null;
}

async function checkK12WorkspaceMembership(client: any, task: K12Task, accessToken: string, workspaceId: string): Promise<boolean> {
  const tokenInfo = summarizeToken(accessToken);
  const payload = decodeJwtPayload(accessToken);
  const sessionId = asString(payload.session_id, randomUUID());
  const response = await client.fetch(`${CHATGPT_BASE_URL}${CHATGPT_ACCOUNTS_CHECK_PATH}`, {
    method: "GET",
    headers: oauthBrowserHeaders(client, {
      accept: "application/json",
      authorization: `Bearer ${accessToken}`,
      ...(tokenInfo.accountId ? {"chatgpt-account-id": tokenInfo.accountId} : {}),
      "oai-device-id": client?.deviceID || randomUUID(),
      "oai-language": "zh-CN",
      "oai-session-id": sessionId,
      "x-openai-target-path": CHATGPT_ACCOUNTS_CHECK_PATH,
      "x-openai-target-route": "/backend-api/accounts/check/{version}",
      referer: `${CHATGPT_BASE_URL}/`,
      origin: CHATGPT_BASE_URL,
      "sec-fetch-dest": "empty",
      "sec-fetch-mode": "cors",
      "sec-fetch-site": "same-origin",
    }),
  });
  const text = await response.text().catch(() => "");
  if (!response.ok) {
    appendLog(task, "warn", `K12 accounts/check 验证失败 HTTP ${response.status}: ${text.slice(0, 180)}`);
    return false;
  }
  try {
    const data = JSON.parse(text) as unknown;
    const workspace = findWorkspaceInAccountsCheck(data, workspaceId);
    if (workspace) {
      appendLog(task, "ok", `K12 accounts/check 已确认 workspace ${workspaceId.slice(0, 8)}... 可见`);
      return true;
    }
    appendLog(task, "warn", `K12 accounts/check 未看到 workspace ${workspaceId.slice(0, 8)}...，可能只是 request 成功但尚未成为成员`);
    return false;
  } catch {
    appendLog(task, "warn", `K12 accounts/check 响应不是 JSON: ${text.slice(0, 180)}`);
    return false;
  }
}

async function selectK12AuthWorkspace(client: any, task: K12Task, workspaceId: string, referer = AUTH_WORKSPACE_URL): Promise<string> {
  appendLog(task, "info", `auth workspace/select(K12): ${workspaceId}`);
  await client.fetch(AUTH_WORKSPACE_URL, {
    method: "GET",
    redirect: "manual",
    headers: oauthBrowserHeaders(client, {
      referer: AUTH_BASE_URL,
      "sec-fetch-dest": "document",
      "sec-fetch-mode": "navigate",
      "sec-fetch-site": "same-origin",
    }),
  }).catch(() => undefined);

  const response = await client.fetch(AUTH_WORKSPACE_SELECT_URL, {
    method: "POST",
    headers: oauthBrowserHeaders(client, {
      accept: "application/json",
      "content-type": "application/json",
      origin: AUTH_BASE_URL,
      referer,
      "sec-fetch-dest": "empty",
      "sec-fetch-mode": "cors",
      "sec-fetch-site": "same-origin",
    }),
    body: JSON.stringify({workspace_id: workspaceId}),
  });
  const text = await response.text().catch(() => "");
  if (!response.ok) {
    const message = `auth workspace/select(K12) workspace_id=${workspaceId} HTTP ${response.status}: ${text.slice(0, 240)}`;
    if (isUnavailableWorkspaceSelectError(response.status, text)) {
      await removeUnavailableWorkspaceIdFromState(workspaceId, message, task);
    }
    throw new Error(message);
  }
  try {
    const data = JSON.parse(text) as {continue_url?: string; page?: {payload?: {url?: string}}};
    const nextUrl = String(data.page?.payload?.url || data.continue_url || "");
    if (!nextUrl) throw new Error(`响应缺少 continue_url: ${text.slice(0, 240)}`);
    const resolved = new URL(nextUrl, AUTH_BASE_URL).toString();
    appendLog(task, "info", `auth workspace/select(K12) -> ${safeUrlForLog(resolved)}`);
    return resolved;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("响应缺少")) throw error;
    throw new Error(`auth workspace/select(K12) 非 JSON 响应: ${text.slice(0, 240)}`);
  }
}

async function followK12WorkspaceSelection(client: any, task: K12Task, nextUrl: string): Promise<void> {
  if (nextUrl.startsWith(`${CHATGPT_BASE_URL}/api/auth/callback/openai`)) {
    await finishChatGptCallback(client, nextUrl, task, AUTH_WORKSPACE_URL);
    return;
  }
  if (nextUrl.startsWith(`${CHATGPT_BASE_URL}/`)) {
    const response = await client.fetch(nextUrl, {
      method: "GET",
      redirect: "follow",
      headers: oauthBrowserHeaders(client, {
        referer: AUTH_WORKSPACE_URL,
        "sec-fetch-dest": "document",
        "sec-fetch-mode": "navigate",
        "sec-fetch-site": "same-site",
      }),
    });
    if (!response.ok) throw new Error(`进入 K12 workspace 跳转失败: HTTP ${response.status}`);
    return;
  }
  await continueAuthSteps(client, nextUrl, task, {finishChatGptCallback: true, allowConsent: true});
}

async function openChatGptAuthEntryForWorkspaceSwitch(client: any, task: K12Task): Promise<string> {
  appendLog(task, "info", "复用当前 ChatGPT cookie 打开 auth 入口，刷新 workspace/select 会话");
  await client.fetch(`${CHATGPT_BASE_URL}/`, {
    method: "GET",
    redirect: "follow",
    headers: oauthBrowserHeaders(client, {
      "accept-encoding": "gzip, deflate, br",
      "sec-fetch-dest": "document",
      "sec-fetch-mode": "navigate",
      "sec-fetch-site": "none",
    }),
  });
  await ensureChatGptCsrfCookie(client);

  const csrfCookie = typeof client.readCookie === "function"
    ? await client.readCookie(CHATGPT_BASE_URL, "__Host-next-auth.csrf-token").catch(() => "")
    : "";
  const csrfToken = decodeURIComponent(csrfCookie).split("|")[0] || "";
  if (!csrfToken) throw new Error("刷新 auth 入口失败：缺少 ChatGPT CSRF cookie");

  const deviceId = client?.deviceID
    || (typeof client.readCookie === "function" ? await client.readCookie(CHATGPT_BASE_URL, "oai-did").catch(() => "") : "")
    || (typeof client.readCookie === "function" ? await client.readCookie("https://openai.com", "oai-did").catch(() => "") : "")
    || randomUUID();
  client.deviceID = deviceId;

  const query = new URLSearchParams({
    prompt: "login",
    "ext-oai-did": deviceId,
    auth_session_logging_id: randomUUID(),
    "ext-passkey-client-capabilities": "0111",
    screen_hint: "login_or_signup",
    login_hint: task.email,
  });
  const body = new URLSearchParams({
    callbackUrl: `${CHATGPT_BASE_URL}/`,
    csrfToken,
    json: "true",
  });

  const signInResponse = await client.fetch(`${CHATGPT_BASE_URL}/api/auth/signin/openai?${query.toString()}`, {
    method: "POST",
    redirect: "follow",
    headers: oauthBrowserHeaders(client, {
      accept: "*/*",
      "content-type": "application/x-www-form-urlencoded",
      origin: CHATGPT_BASE_URL,
      referer: `${CHATGPT_BASE_URL}/`,
      "sec-fetch-dest": "empty",
      "sec-fetch-mode": "cors",
      "sec-fetch-site": "same-origin",
    }),
    body,
  });
  if (!signInResponse.ok) {
    throw new Error(`刷新 auth 入口失败: HTTP ${signInResponse.status}`);
  }
  const payload = (await signInResponse.json()) as {url?: string};
  const authorizeUrl = String(payload.url || "");
  if (!authorizeUrl) throw new Error(`刷新 auth 入口响应缺少 url: ${JSON.stringify(payload).slice(0, 240)}`);

  const authorizeResponse = await client.fetch(authorizeUrl, {
    method: "GET",
    redirect: "manual",
    headers: oauthBrowserHeaders(client, {
      "accept-encoding": "gzip, deflate, br",
      referer: `${CHATGPT_BASE_URL}/`,
      "sec-fetch-dest": "document",
      "sec-fetch-mode": "navigate",
      "sec-fetch-site": "same-site",
    }),
  });
  const location = authorizeResponse.headers.get("location");
  const nextUrl = location ? new URL(location, authorizeUrl).toString() : (authorizeResponse.url || authorizeUrl);
  appendLog(task, "info", `auth 入口刷新后 -> ${safeUrlForLog(nextUrl)}`);
  return nextUrl;
}

async function runWorkspaceSwitchAuthFlow(client: any, task: K12Task, startUrl: string, workspaceId: string): Promise<void> {
  let currentUrl = startUrl;
  for (let hop = 0; hop < 12; hop += 1) {
    if (currentUrl.startsWith(`${CHATGPT_BASE_URL}/api/auth/callback/openai`)) {
      await finishChatGptCallback(client, currentUrl, task, AUTH_WORKSPACE_URL);
      return;
    }
    if (currentUrl === AUTH_WORKSPACE_URL || currentUrl.startsWith(`${AUTH_WORKSPACE_URL}?`)) {
      currentUrl = await selectK12AuthWorkspace(client, task, workspaceId, currentUrl);
      continue;
    }
    if (currentUrl.startsWith(AUTH_CHOOSE_ACCOUNT_URL)) {
      currentUrl = await chooseCurrentAuthAccount(client, task, currentUrl);
      continue;
    }
    if (isAddPhoneUrl(currentUrl)) {
      throw new Error("切换 K12 workspace 时触发 add-phone，无法仅靠当前 Web session 完成");
    }
    if (isRecoverableWorkspaceSwitchAuthStep(currentUrl)) {
      appendLog(task, "info", `切换 K12 workspace 时接管 auth step: ${safeUrlForLog(currentUrl)}`);
      currentUrl = await continueAuthSteps(client, currentUrl, task, {finishChatGptCallback: true, allowConsent: true});
      if (currentUrl.startsWith(`${CHATGPT_BASE_URL}/api/auth/callback/openai`)) return;
      continue;
    }
    if (
      currentUrl === `${AUTH_BASE_URL}/log-in`
      || currentUrl.startsWith(`${AUTH_BASE_URL}/log-in`)
      || currentUrl === AUTH_CREATE_ACCOUNT_PASSWORD_URL
    ) {
      throw new Error(`切换 K12 workspace 需要重新登录，当前停在 ${safeUrlForLog(currentUrl)}`);
    }
    if (currentUrl.startsWith(AUTH_BASE_URL)) {
      const response = await client.fetch(currentUrl, {
        method: "GET",
        redirect: "manual",
        headers: oauthBrowserHeaders(client, {
          referer: CHATGPT_BASE_URL,
          "sec-fetch-dest": "document",
          "sec-fetch-mode": "navigate",
          "sec-fetch-site": "same-site",
        }),
      });
      const location = response.headers.get("location");
      if (location) {
        currentUrl = new URL(location, currentUrl).toString();
        continue;
      }
      if (response.url && response.url !== currentUrl) {
        currentUrl = response.url;
        continue;
      }
    }
    if (currentUrl.startsWith(CHATGPT_BASE_URL)) {
      const response = await client.fetch(currentUrl, {
        method: "GET",
        redirect: "follow",
        headers: oauthBrowserHeaders(client, {
          referer: AUTH_BASE_URL,
          "sec-fetch-dest": "document",
          "sec-fetch-mode": "navigate",
          "sec-fetch-site": "same-site",
        }),
      });
      if (!response.ok) throw new Error(`切换 K12 workspace 跳转失败: HTTP ${response.status}`);
      return;
    }
    throw new Error(`切换 K12 workspace 跳转未识别: ${safeUrlForLog(currentUrl)}`);
  }
  throw new Error(`切换 K12 workspace 跳转次数过多，最后停在 ${safeUrlForLog(currentUrl)}`);
}

async function switchToK12WorkspaceAccessToken(client: any, task: K12Task, accessToken: string, workspaceId: string): Promise<string> {
  if (isK12AccessToken(accessToken, task)) return accessToken;

  appendLog(task, "warn", `当前 Web AT 仍不是 K12，尝试直接 workspace/select 切到 K12: ${describeAccessTokenContext(accessToken)}`);
  try {
    const nextUrl = await selectK12AuthWorkspace(client, task, workspaceId);
    await followK12WorkspaceSelection(client, task, nextUrl);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!isInvalidAuthStateError(error)) throw error;
    appendLog(task, "warn", "当前 auth session 已失效；改为复用 ChatGPT cookie 刷新 auth session 后直接切 K12");
    const refreshedUrl = await openChatGptAuthEntryForWorkspaceSwitch(client, task);
    await runWorkspaceSwitchAuthFlow(client, task, refreshedUrl, workspaceId);
  }

  let latestToken = "";
  for (let attempt = 1; attempt <= K12_WORKSPACE_SWITCH_TOKEN_RETRIES; attempt += 1) {
    latestToken = await readChatGptSessionAccessToken(
      client,
      task,
      `workspace/select ${workspaceId.slice(0, 8)}... 后 第 ${attempt}/${K12_WORKSPACE_SWITCH_TOKEN_RETRIES} 次`,
    );
    if (isK12AccessToken(latestToken, task)) return latestToken;
    if (attempt < K12_WORKSPACE_SWITCH_TOKEN_RETRIES) await sleep(1000);
  }
  appendLog(task, "warn", `workspace/select 后 session AT 仍不是 K12: ${describeAccessTokenContext(latestToken || accessToken)}`);
  return latestToken || accessToken;
}

async function ensureK12AccessTokenForNoRt(client: any, task: K12Task, accessToken: string): Promise<string> {
  if (isK12AccessToken(accessToken, task)) return accessToken;

  appendLog(task, "warn", `当前 AT 不是 K12 上下文，不能直接 noRT 入库: ${describeAccessTokenContext(accessToken)}`);
  let latestToken = accessToken;
  for (const workspaceId of targetNoRtFallbackWorkspaceIds(task)) {
    const existingOk = task.workspaceResults.some((item) => item.workspaceId === workspaceId && item.route === task.route && item.ok);
    if (!existingOk) {
      const result = await sendK12Invite(task, client, latestToken, workspaceId, task.route);
      task.workspaceResults.push(result);
      await persistTasks();
      if (!result.ok) continue;
    }
    await checkK12WorkspaceMembership(client, task, latestToken, workspaceId);
    latestToken = await switchToK12WorkspaceAccessToken(client, task, latestToken, workspaceId);
    if (isK12AccessToken(latestToken, task)) return latestToken;
    appendLog(task, "warn", `K12 请求成功后 session AT 仍不是 K12: ${describeAccessTokenContext(latestToken)}`);
  }

  throw new Error(
    `noRT fallback 需要 K12 workspace AT，但当前仍是 ${describeAccessTokenContext(latestToken)}。` +
    "说明邮箱登录后停在个人/free 账户，未切到 K12 团队 token，已阻止导入不可用账号。",
  );
}

function buildSub2ApiCredentialsFromAccessToken(accessToken: string, fallbackEmail: string): Record<string, unknown> {
  const payload = decodeJwtPayload(accessToken);
  const auth = (payload["https://api.openai.com/auth"] || {}) as Record<string, unknown>;
  const profile = (payload["https://api.openai.com/profile"] || {}) as Record<string, unknown>;
  const credentials: Record<string, unknown> = {
    access_token: accessToken,
    email: asString(profile.email || payload.email, fallbackEmail),
    chatgpt_account_id: asString(auth.chatgpt_account_id),
    chatgpt_user_id: normalizeChatGptUserId(auth),
    plan_type: asString(auth.chatgpt_plan_type),
    client_id: asString(payload.client_id, "app_X8zY6vW2pQ9tR3dE7nK1jL5gH"),
  };
  for (const key of Object.keys(credentials)) {
    if (!credentials[key]) delete credentials[key];
  }
  if (appConfig.requireChatgptAccountId && !credentials.chatgpt_account_id) {
    throw new Error(`AT 中缺少 chatgpt_account_id: ${credentials.email || fallbackEmail || "(unknown)"}`);
  }
  return credentials;
}

function firstNonEmpty(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(Math.trunc(value));
  }
  return "";
}

function normalizeTimestampValue(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  if (typeof value === "number" && Number.isFinite(value)) {
    const ms = value > 1e11 ? value : value * 1000;
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? "" : date.toISOString();
  }
  if (typeof value === "string" && value.trim()) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return normalizeTimestampValue(numeric);
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "" : date.toISOString();
  }
  return "";
}

function epochSecondsFromValue(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    const seconds = numeric > 1e11 ? numeric / 1000 : numeric;
    return seconds > 0 ? Math.trunc(seconds) : undefined;
  }
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? Math.trunc(parsed / 1000) : undefined;
}

function firstPositiveEpochSeconds(...values: unknown[]): number | undefined {
  for (const value of values) {
    const seconds = epochSecondsFromValue(value);
    if (seconds && seconds > 0) return seconds;
  }
  return undefined;
}

function encodeBase64UrlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function buildSyntheticCodexIdToken(email: string, accountId: string, planType: string, userId: string, expiresAt: string): string {
  if (!accountId) return "";
  const now = Math.trunc(Date.now() / 1000);
  const expires = epochSecondsFromValue(expiresAt) || now + 90 * 24 * 60 * 60;
  const authInfo: Record<string, unknown> = {chatgpt_account_id: accountId};
  if (planType) authInfo.chatgpt_plan_type = planType;
  if (userId) {
    authInfo.chatgpt_user_id = userId;
    authInfo.user_id = userId;
  }
  const payload: Record<string, unknown> = {
    iat: now,
    exp: expires,
    "https://api.openai.com/auth": authInfo,
  };
  if (email) payload.email = email;
  return `${encodeBase64UrlJson({alg: "none", typ: "JWT", cpa_synthetic: true})}.${encodeBase64UrlJson(payload)}.synthetic`;
}

function stripJsonUnavailable(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stripJsonUnavailable).filter((item) => item !== undefined);
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => [key, stripJsonUnavailable(item)] as const)
      .filter(([, item]) => item !== undefined);
    return entries.length ? Object.fromEntries(entries) : undefined;
  }
  if (value === undefined || value === null || value === "") return undefined;
  return value;
}

function stripUndefinedNull(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== null));
}

function sanitizeFileToken(value: string, fallback = "account"): string {
  const text = String(value || fallback)
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1f]+/g, "_")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  return (text || fallback).slice(0, 120);
}

function resolveJsonOutDir(): string {
  const configured = asString(appConfig.jsonOutDir) || defaultJsonOutDir;
  return path.isAbsolute(configured) ? configured : path.join(rootDir, configured);
}

function buildAccountJsonOutput(
  task: K12Task,
  email: EmailRecord,
  accessToken: string,
  options: {credentials?: Record<string, unknown>; accountName?: string; source?: string} = {},
): {format: JsonOutFormat; accountName: string; data: unknown} {
  const format = normalizeJsonOutFormat(appConfig.jsonOutFormat);
  const credentials = options.credentials || {};
  const payload = decodeJwtPayload(accessToken);
  const auth = (payload["https://api.openai.com/auth"] || {}) as Record<string, unknown>;
  const profile = (payload["https://api.openai.com/profile"] || {}) as Record<string, unknown>;
  const inputIdToken = firstNonEmpty(credentials.id_token, credentials.idToken);
  const idPayload = inputIdToken ? decodeJwtPayload(inputIdToken) : {};
  const idAuth = (idPayload["https://api.openai.com/auth"] || {}) as Record<string, unknown>;

  const accountId = firstNonEmpty(
    auth.chatgpt_account_id,
    credentials.chatgpt_account_id,
    credentials.chatgptAccountId,
    idAuth.chatgpt_account_id,
    idAuth.account_id,
  );
  const userId = firstNonEmpty(
    normalizeChatGptUserId(auth),
    credentials.chatgpt_user_id,
    credentials.chatgptUserId,
    idAuth.chatgpt_user_id,
    idAuth.user_id,
  );
  const outputEmail = firstNonEmpty(
    profile.email,
    payload.email,
    credentials.email,
    idPayload.email,
    task.accessTokenEmail,
    email.email,
  );
  const planType = firstNonEmpty(auth.chatgpt_plan_type, credentials.plan_type, credentials.planType, idAuth.chatgpt_plan_type);
  const expiresAt = firstNonEmpty(
    normalizeTimestampValue(credentials.expires_at),
    normalizeTimestampValue(credentials.expiresAt),
    normalizeTimestampValue(credentials.expired),
    normalizeTimestampValue(payload.exp),
    task.accessTokenExpiresAt,
  );
  const expiresEpoch = firstPositiveEpochSeconds(credentials.expires_at, credentials.expiresAt, credentials.expired, payload.exp, expiresAt);
  const idTokenAccountId = firstNonEmpty(idAuth.chatgpt_account_id, idAuth.account_id);
  const idTokenMatchesAccessToken = !inputIdToken || !accountId || !idTokenAccountId || idTokenAccountId === accountId;
  const syntheticIdToken = idTokenMatchesAccessToken ? "" : buildSyntheticCodexIdToken(outputEmail, accountId, planType, userId, expiresAt);
  const idToken = idTokenMatchesAccessToken
    ? firstNonEmpty(inputIdToken, buildSyntheticCodexIdToken(outputEmail, accountId, planType, userId, expiresAt))
    : syntheticIdToken;
  const refreshToken = firstNonEmpty(credentials.refresh_token, credentials.refreshToken);
  const sessionToken = firstNonEmpty(credentials.session_token, credentials.sessionToken);
  const clientId = firstNonEmpty(credentials.client_id, credentials.clientId, payload.client_id, "app_X8zY6vW2pQ9tR3dE7nK1jL5gH");
  const organizationId = firstNonEmpty(credentials.organization_id, credentials.organizationId);
  const accountName = firstNonEmpty(
    options.accountName,
    task.sub2apiAccount,
    email.sub2apiAccount,
    outputEmail,
    accountId,
    email.email,
  );
  const exportedAt = nowIso();

  const sub2apiAccount = stripJsonUnavailable({
    name: accountName,
    platform: "openai",
    type: "oauth",
    expires_at: expiresEpoch,
    proxy_key: asString(credentials.proxy_key || credentials.proxyKey),
    proxy_id: normalizePositiveId(credentials.proxy_id || credentials.proxyId),
    group_ids: Array.isArray(credentials.group_ids)
      ? credentials.group_ids.map(normalizePositiveId).filter((id): id is number => Boolean(id))
      : undefined,
    auto_pause_on_expired: true,
    concurrency: appConfig.sub2apiConcurrency,
    priority: appConfig.sub2apiAccountPriority,
    rate_multiplier: 1,
    credentials: {
      access_token: accessToken,
      refresh_token: refreshToken,
      id_token: idToken,
      session_token: sessionToken,
      chatgpt_account_id: accountId,
      chatgpt_user_id: userId,
      client_id: clientId,
      email: outputEmail,
      expires_at: expiresEpoch,
      organization_id: organizationId,
      plan_type: planType,
    },
    extra: {
      email: outputEmail,
      privacy_mode: "training_off",
      openai_oauth_responses_websockets_v2_enabled: false,
      openai_oauth_responses_websockets_v2_mode: "off",
      source: options.source || "gpt-k12",
      no_rt: task.sub2apiNoRtMode === true || accountName.endsWith("--noRT") || undefined,
    },
  });

  if (format === "sub2api") {
    return {
      format,
      accountName,
      data: {
        exported_at: exportedAt,
        proxies: [],
        accounts: [sub2apiAccount],
      },
    };
  }

  return {
    format,
    accountName,
    data: stripUndefinedNull({
      type: "codex",
      account_id: accountId,
      chatgpt_account_id: accountId,
      email: outputEmail,
      name: accountName,
      plan_type: planType,
      chatgpt_plan_type: planType,
      id_token: idToken,
      id_token_synthetic: idToken.endsWith(".synthetic") || undefined,
      access_token: accessToken,
      refresh_token: refreshToken || "",
      session_token: sessionToken,
      last_refresh: exportedAt,
      expired: expiresAt,
      source: options.source || "gpt-k12",
    }),
  };
}

async function writeAccountJsonFile(
  task: K12Task,
  email: EmailRecord,
  accessToken: string,
  options: {credentials?: Record<string, unknown>; accountName?: string; source?: string} = {},
): Promise<void> {
  if (!accessToken) return;
  const output = buildAccountJsonOutput(task, email, accessToken, options);
  const outDir = resolveJsonOutDir();
  await mkdir(outDir, {recursive: true});
  const filename = `${output.format}-${sanitizeFileToken(output.accountName || email.email)}.json`;
  const filePath = path.join(outDir, filename);
  await writeFile(filePath, `${JSON.stringify(output.data, null, 2)}\n`, "utf8");
  task.jsonOutFile = filePath;
  task.jsonOutFormat = output.format;
  appendLog(task, "ok", `账号 JSON 已写出: ${filePath}`);
}

async function tryWriteAccountJsonFile(
  task: K12Task,
  email: EmailRecord,
  accessToken: string,
  options: {credentials?: Record<string, unknown>; accountName?: string; source?: string} = {},
): Promise<void> {
  try {
    await writeAccountJsonFile(task, email, accessToken, options);
  } catch (error) {
    appendLog(task, "warn", `账号 JSON 写出失败: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function pickErrorMessage(payload: unknown, fallback = "unknown error"): string {
  if (!payload || typeof payload !== "object") return fallback;
  const record = payload as Record<string, unknown>;
  const error = record.error && typeof record.error === "object" ? record.error as Record<string, unknown> : null;
  return asString(error?.message || error?.code || record.detail || record.message || record.error, fallback);
}

function extractItems(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  const record = payload as Record<string, unknown>;
  for (const key of ["items", "accounts", "data", "records", "list"]) {
    const value = record[key];
    if (Array.isArray(value)) return value;
    if (value && typeof value === "object") {
      const nested = extractItems(value);
      if (nested.length) return nested;
    }
  }
  return [];
}

function unwrapSub2ApiAccount(value: Record<string, unknown>): Record<string, unknown> {
  const nested = value.account || value.Account;
  if (nested && typeof nested === "object") return nested as Record<string, unknown>;
  return value;
}

function asIdString(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) return String(Math.trunc(value));
  if (typeof value === "string") return value.trim();
  return "";
}

function sub2ApiAccountId(account: Record<string, unknown>): string {
  const unwrapped = unwrapSub2ApiAccount(account);
  return asIdString(unwrapped.id) || asIdString(unwrapped.db_id) || asIdString(unwrapped.account_id);
}

function sub2ApiAccountName(account: Record<string, unknown>): string {
  const unwrapped = unwrapSub2ApiAccount(account);
  return asString(unwrapped.name || unwrapped.account_name);
}

function sub2ApiAccountCredentials(account: Record<string, unknown>): Record<string, unknown> {
  const unwrapped = unwrapSub2ApiAccount(account);
  return (unwrapped.credentials && typeof unwrapped.credentials === "object" ? unwrapped.credentials : {}) as Record<string, unknown>;
}

function sub2ApiAccountK12PlanMismatch(account: Record<string, unknown>, accessToken: string, workspaceIds: string[]): string | undefined {
  const credentials = sub2ApiAccountCredentials(account);
  const tokenInfo = accessToken ? summarizeToken(accessToken) : null;
  return k12PlanMismatchReason({
    planType: asString(
      credentials.plan_type
      || credentials.planType
      || credentials.chatgpt_plan_type
      || tokenInfo?.planType,
    ),
    accountId: asString(
      credentials.chatgpt_account_id
      || credentials.chatgptAccountId
      || credentials.account_id
      || tokenInfo?.accountId,
    ),
    workspaceIds,
  });
}

function sub2ApiAccountK12StatusError(account: Record<string, unknown>, accessToken: string, workspaceIds: string[]): string | undefined {
  const unwrapped = unwrapSub2ApiAccount(account);
  const credentials = sub2ApiAccountCredentials(unwrapped);
  const tokenInfo = accessToken ? summarizeToken(accessToken) : null;
  return sub2ApiK12StatusErrorReason({
    planType: asString(
      credentials.plan_type
      || credentials.planType
      || credentials.chatgpt_plan_type
      || unwrapped.plan_type
      || unwrapped.planType
      || tokenInfo?.planType,
    ),
    accountId: asString(
      credentials.chatgpt_account_id
      || credentials.chatgptAccountId
      || credentials.account_id
      || unwrapped.chatgpt_account_id
      || unwrapped.account_id
      || tokenInfo?.accountId,
    ),
    workspaceIds,
    status: asString(unwrapped.status),
    state: asString(unwrapped.state),
    accountStatus: asString(unwrapped.account_status || unwrapped.accountStatus),
    disabled: asBoolean(unwrapped.disabled, false),
    isDisabled: asBoolean(unwrapped.is_disabled ?? unwrapped.isDisabled, false),
    paused: asBoolean(unwrapped.paused, false),
    isPaused: asBoolean(unwrapped.is_paused ?? unwrapped.isPaused, false),
    deleted: asBoolean(unwrapped.deleted, false),
    isDeleted: asBoolean(unwrapped.is_deleted ?? unwrapped.isDeleted, false),
    banned: asBoolean(unwrapped.banned, false),
    isBanned: asBoolean(unwrapped.is_banned ?? unwrapped.isBanned, false),
    expired: asBoolean(unwrapped.expired, false),
    isExpired: asBoolean(unwrapped.is_expired ?? unwrapped.isExpired, false),
    enabled: unwrapped.enabled !== undefined ? asBoolean(unwrapped.enabled, true) : undefined,
    isEnabled: (unwrapped.is_enabled ?? unwrapped.isEnabled) !== undefined ? asBoolean(unwrapped.is_enabled ?? unwrapped.isEnabled, true) : undefined,
    active: unwrapped.active !== undefined ? asBoolean(unwrapped.active, true) : undefined,
    isActive: (unwrapped.is_active ?? unwrapped.isActive) !== undefined ? asBoolean(unwrapped.is_active ?? unwrapped.isActive, true) : undefined,
    deletedAt: asString(unwrapped.deleted_at || unwrapped.deletedAt),
    message: unwrapped.message || unwrapped.msg,
    error: unwrapped.error || unwrapped.err,
    errorMessage: unwrapped.error_message
      || unwrapped.errorMessage
      || unwrapped.last_error
      || unwrapped.lastError
      || unwrapped.last_test_error
      || unwrapped.lastTestError
      || unwrapped.status_message
      || unwrapped.statusMessage,
    detail: unwrapped.detail,
    reason: unwrapped.reason,
    metadata: {
      status_reason: unwrapped.status_reason,
      statusReason: unwrapped.statusReason,
      cooldown_reason: unwrapped.cooldown_reason,
      cooldownReason: unwrapped.cooldownReason,
    },
  });
}

function mergeCredentials(existing: Record<string, unknown>, accessToken: string, email: EmailRecord): Record<string, unknown> {
  const next: Record<string, unknown> = {
    ...existing,
    ...buildSub2ApiCredentialsFromAccessToken(accessToken, email.email),
    access_token: accessToken,
  };
  for (const key of Object.keys(next)) {
    if (next[key] === undefined || next[key] === null || next[key] === "") delete next[key];
  }
  return next;
}

function sub2ApiWorkspaceAccountSuffix(workspaceIds?: string[]): string {
  const workspaceKey = taskWorkspaceKey(workspaceIds);
  if (workspaceKey === "__no_workspace__") return "";
  return `--ws-${workspaceKey.replace(/[^a-z0-9_-]/gi, "").slice(0, 48)}`;
}

function sub2ApiOAuthAccountName(email: EmailRecord, groupName = appConfig.sub2apiGroupName || "k12", workspaceIds?: string[]): string {
  const primaryGroupName = primarySub2ApiGroupName(groupName);
  return `${email.email}---${primaryGroupName}${sub2ApiWorkspaceAccountSuffix(workspaceIds)}`;
}

function sub2ApiNoRtAccountName(email: EmailRecord, workspaceIds?: string[]): string {
  return `${email.email}--noRT${sub2ApiWorkspaceAccountSuffix(workspaceIds)}`;
}

function expectedSub2ApiAccountNames(email: EmailRecord, groupName = appConfig.sub2apiGroupName || "k12", workspaceIds?: string[]): string[] {
  const primaryGroupName = primarySub2ApiGroupName(groupName);
  const savedAccount = asString(email.sub2apiAccount);
  const workspaceSuffix = sub2ApiWorkspaceAccountSuffix(workspaceIds).toLowerCase();
  const savedAccountMatchesWorkspace = savedAccount && (
    !workspaceSuffix
    || savedAccount.toLowerCase().includes(workspaceSuffix)
  );
  return Array.from(new Set([
    sub2ApiOAuthAccountName(email, primaryGroupName, workspaceIds),
    sub2ApiNoRtAccountName(email, workspaceIds),
    savedAccountMatchesWorkspace ? savedAccount : "",
    `${email.email}---${primaryGroupName}`,
    `${email.email}--noRT`,
  ].filter(Boolean)));
}

function expectedSub2ApiAccountNamesForWorkspaceCandidates(
  email: EmailRecord,
  groupName = appConfig.sub2apiGroupName || "k12",
  workspaceCandidates: string[] = appConfig.workspaceIds,
): string[] {
  const names = new Set<string>();
  for (const name of expectedSub2ApiAccountNames(email, groupName)) {
    if (name) names.add(name);
  }
  for (const workspaceId of workspaceCandidates) {
    for (const name of expectedSub2ApiAccountNames(email, groupName, workspaceId ? [workspaceId] : [])) {
      if (name) names.add(name);
    }
  }
  return [...names];
}

function workspaceIdsForSub2ApiAccountIssue(account: Record<string, unknown>, localEmail?: EmailRecord, fallbackWorkspaceIds: string[] = appConfig.workspaceIds): string[] {
  const accountName = sub2ApiAccountName(account).toLowerCase();
  const byAccountName = appConfig.workspaceIds.filter((workspaceId) => {
    const suffix = sub2ApiWorkspaceAccountSuffix([workspaceId]).toLowerCase();
    return suffix && accountName.includes(suffix);
  });
  if (byAccountName.length) return uniqueStringList(byAccountName);

  const byTaskHistory = tasks
    .filter((task) => (
      task.workspaceIds.length
      && (
        (localEmail && task.emailId === localEmail.id)
        || (accountName && asString(task.sub2apiAccount).toLowerCase() === accountName)
      )
    ))
    .flatMap((task) => task.workspaceIds);
  if (byTaskHistory.length) return uniqueStringList(byTaskHistory);

  const fallback = uniqueStringList(fallbackWorkspaceIds);
  return fallback.length === 1 ? fallback : [];
}

function findAccountsByNames(accounts: unknown[], names: string[]): Record<string, unknown>[] {
  const normalizedNames = new Set(names.map((item) => item.toLowerCase()));
  const found: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  for (const item of accounts) {
    if (!item || typeof item !== "object") continue;
    const account = unwrapSub2ApiAccount(item as Record<string, unknown>);
    const name = sub2ApiAccountName(account);
    if (!normalizedNames.has(name.toLowerCase())) continue;
    const key = sub2ApiAccountId(account) || name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    found.push(account);
  }
  return found;
}

function findAccountByNames(accounts: unknown[], names: string[]): Record<string, unknown> | null {
  return findAccountsByNames(accounts, names)[0] || null;
}

function normalizeSub2ApiOrigin(rawUrl: string): string {
  const normalized = asString(rawUrl).replace(/\/+$/, "");
  if (!normalized) throw new Error("Sub2API 地址为空");
  return new URL(normalized).origin;
}

async function requestSub2ApiJson(
  origin: string,
  pathname: string,
  options: {method?: string; token?: string; body?: unknown; timeoutMs?: number; accept?: string} = {},
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1000, options.timeoutMs ?? 30000));
  try {
    const response = await fetch(`${origin}${pathname}`, {
      method: options.method ?? "GET",
      headers: {
        Accept: options.accept || "application/json",
        "Content-Type": "application/json",
        ...(options.token ? {Authorization: `Bearer ${options.token}`} : {}),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal,
    });
    const text = await response.text();
    let payload: unknown = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = {raw: text};
    }
    if (payload && typeof payload === "object" && "code" in payload) {
      const record = payload as Record<string, unknown>;
      if (Number(record.code) === 0) return record.data;
      const message = asString(record.message || record.detail || record.error || record.reason, JSON.stringify(payload).slice(0, 300));
      throw new Error(`Sub2API ${pathname} 失败: ${message}`);
    }
    if (!response.ok) {
      throw new Error(`Sub2API ${pathname} HTTP ${response.status}: ${JSON.stringify(payload).slice(0, 300)}`);
    }
    return payload;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Sub2API 请求超时: ${pathname}`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function loginSub2ApiAdmin(): Promise<{origin: string; token: string}> {
  if (!appConfig.sub2apiUrl || !appConfig.sub2apiEmail || !appConfig.sub2apiPassword) {
    throw new Error("Sub2API 配置不完整：地址、账号、密码均不能为空");
  }
  return loginSub2ApiAdminWithCredentials(appConfig.sub2apiUrl, appConfig.sub2apiEmail, appConfig.sub2apiPassword);
}

const sub2ApiAdminLoginManager = createSub2ApiAdminLoginManager({
  authenticate: async ({origin, email, password}) => {
    const loginData = (await requestSub2ApiJson(origin, "/api/v1/auth/login", {
      method: "POST",
      body: {email, password},
    })) as Record<string, unknown>;
    const token = asString(loginData.access_token || loginData.accessToken);
    if (!token) throw new Error("Sub2API 登录响应缺少 access_token");
    return token;
  },
});

async function loginSub2ApiAdminWithCredentials(
  sub2apiUrl: string,
  sub2apiEmail: string,
  sub2apiPassword: string,
  options: {force?: boolean} = {},
): Promise<{origin: string; token: string}> {
  const origin = normalizeSub2ApiOrigin(sub2apiUrl);
  const token = await sub2ApiAdminLoginManager.login({
    origin,
    email: sub2apiEmail,
    password: sub2apiPassword,
  }, options);
  return {origin, token};
}

interface Sub2ApiGroupSelection {
  id: number;
  name: string;
}

interface Sub2ApiProxySelection {
  id: number;
  name: string;
  proxyKey: string;
  raw: Record<string, unknown>;
}

async function resolveSub2ApiGroups(
  origin: string,
  adminToken: string,
  groupNames: string[],
): Promise<Sub2ApiGroupSelection[]> {
  const targetNames = parseSub2ApiGroupNames(groupNames);
  const groupsData = await requestSub2ApiJson(origin, "/api/v1/admin/groups/all", {token: adminToken});
  const groups = Array.isArray(groupsData) ? groupsData : extractItems(groupsData);
  const matched: Sub2ApiGroupSelection[] = [];
  const missing: string[] = [];

  for (const groupName of targetNames) {
    const found = groups.find((item) => {
      const record = item as Record<string, unknown>;
      const name = asString(record.name).toLowerCase();
      const platform = asString(record.platform).toLowerCase();
      return name === groupName.toLowerCase() && (!platform || platform === "openai");
    }) as Record<string, unknown> | undefined;
    const id = normalizePositiveId(found?.id);
    if (found && id) matched.push({id, name: asString(found.name, groupName)});
    else missing.push(groupName);
  }

  if (missing.length) {
    throw new Error(`Sub2API 未找到 openai 分组: ${missing.join(", ")}`);
  }
  return matched;
}

function formatSub2ApiGroups(groups: Sub2ApiGroupSelection[]): string {
  return groups.map((group) => `${group.name}#${group.id}`).join(", ");
}

async function resolveSub2ApiProxy(
  origin: string,
  adminToken: string,
  preference = appConfig.sub2apiProxyName,
): Promise<Sub2ApiProxySelection | undefined> {
  const target = asString(preference);
  if (!target) return undefined;
  const preferredId = normalizePositiveId(target);
  const proxiesData = await requestSub2ApiJson(origin, "/api/v1/admin/proxies/all?with_count=true", {token: adminToken});
  const proxies = Array.isArray(proxiesData) ? proxiesData : extractItems(proxiesData);
  const active = proxies
    .map((item) => item as Record<string, unknown>)
    .filter((record) => {
      const status = asString(record.status).toLowerCase();
      return normalizePositiveId(record.id) && (!status || status === "active");
    });
  const found = preferredId
    ? active.find((record) => normalizePositiveId(record.id) === preferredId)
    : active.find((record) => {
      const name = asString(record.name).toLowerCase();
      const proxyKey = asString(record.proxy_key || record.proxyKey || record.key).toLowerCase();
      return name === target.toLowerCase() || proxyKey === target.toLowerCase();
    });

  if (!found) {
    const sample = active
      .slice(0, 8)
      .map((record) => `${asString(record.name, "(unnamed)")}#${String(record.id ?? "")}`)
      .join(", ");
    throw new Error(`Sub2API IP管理未匹配: ${target}; 可用: ${sample || "无"}`);
  }

  const id = normalizePositiveId(found.id);
  if (!id) throw new Error(`Sub2API IP管理 ID 无效: ${target}`);
  return {
    id,
    name: asString(found.name, `proxy-${id}`),
    proxyKey: asString(found.proxy_key || found.proxyKey || found.key),
    raw: found,
  };
}

function formatSub2ApiProxy(proxy?: Sub2ApiProxySelection): string {
  return proxy ? `${proxy.name}#${proxy.id}` : "";
}

async function findSub2ApiAccountByName(
  origin: string,
  adminToken: string,
  names: string[],
): Promise<Record<string, unknown> | null> {
  return (await findSub2ApiAccountsByName(origin, adminToken, names))[0] || null;
}

async function findSub2ApiAccountsByName(
  origin: string,
  adminToken: string,
  names: string[],
): Promise<Record<string, unknown>[]> {
  const uniqueNames = Array.from(new Set(names.map((item) => item.trim()).filter(Boolean)));
  const found: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  for (const name of uniqueNames) {
    const data = await requestSub2ApiJson(
      origin,
      `/api/v1/admin/accounts?page=1&page_size=20&platform=openai&type=oauth&search=${encodeURIComponent(name)}`,
      {token: adminToken},
    );
    for (const account of findAccountsByNames(extractItems(data), uniqueNames)) {
      const accountName = sub2ApiAccountName(account);
      const key = sub2ApiAccountId(account) || accountName.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      found.push(account);
    }
  }
  return found;
}

function buildQueryString(params: Record<string, string | number | boolean | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === "") continue;
    query.set(key, String(value));
  }
  return query.toString();
}

function sub2ApiAccountGroupIds(account: Record<string, unknown>): number[] {
  const unwrapped = unwrapSub2ApiAccount(account);
  const ids = new Set<number>();
  const add = (value: unknown) => {
    const id = normalizePositiveId(value);
    if (id) ids.add(id);
  };
  add(unwrapped.group_id);
  add(unwrapped.groupId);
  if (unwrapped.group && typeof unwrapped.group === "object") {
    add((unwrapped.group as Record<string, unknown>).id);
  }
  if (Array.isArray(unwrapped.group_ids)) unwrapped.group_ids.forEach(add);
  if (Array.isArray(unwrapped.groupIds)) unwrapped.groupIds.forEach(add);
  for (const key of ["groups", "account_groups", "accountGroups"]) {
    const value = unwrapped[key];
    if (!Array.isArray(value)) continue;
    for (const item of value) {
      if (item && typeof item === "object") {
        const record = item as Record<string, unknown>;
        add(record.id);
        add(record.group_id);
        add(record.groupId);
      } else {
        add(item);
      }
    }
  }
  return [...ids];
}

function sub2ApiAccountGroupNames(account: Record<string, unknown>): string[] {
  const unwrapped = unwrapSub2ApiAccount(account);
  const names = new Set<string>();
  const add = (value: unknown) => {
    const name = asString(value).toLowerCase();
    if (name) names.add(name);
  };
  add(unwrapped.group_name);
  add(unwrapped.groupName);
  if (unwrapped.group && typeof unwrapped.group === "object") {
    add((unwrapped.group as Record<string, unknown>).name);
  }
  if (Array.isArray(unwrapped.group_names)) unwrapped.group_names.forEach(add);
  if (Array.isArray(unwrapped.groupNames)) unwrapped.groupNames.forEach(add);
  for (const key of ["groups", "account_groups", "accountGroups"]) {
    const value = unwrapped[key];
    if (!Array.isArray(value)) continue;
    for (const item of value) {
      if (item && typeof item === "object") {
        const record = item as Record<string, unknown>;
        add(record.name);
        add(record.group_name);
        add(record.groupName);
      }
    }
  }
  return [...names];
}

function sub2ApiAccountHasGroupFields(account: Record<string, unknown>): boolean {
  const unwrapped = unwrapSub2ApiAccount(account);
  return [
    "group_id",
    "groupId",
    "group",
    "group_ids",
    "groupIds",
    "group_name",
    "groupName",
    "group_names",
    "groupNames",
    "groups",
    "account_groups",
    "accountGroups",
  ].some((key) => unwrapped[key] !== undefined);
}

function sub2ApiAccountMatchesGroup(account: Record<string, unknown>, group: Sub2ApiGroupSelection): boolean {
  const ids = sub2ApiAccountGroupIds(account);
  if (ids.includes(group.id)) return true;
  const names = sub2ApiAccountGroupNames(account);
  return names.includes(group.name.toLowerCase());
}

async function listSub2ApiAccountsPage(
  origin: string,
  adminToken: string,
  page: number,
  pageSize: number,
  groupId?: number,
): Promise<unknown[]> {
  const query = buildQueryString({
    page,
    page_size: pageSize,
    platform: "openai",
    type: "oauth",
    group_id: groupId,
  });
  const data = await requestSub2ApiJson(origin, `/api/v1/admin/accounts?${query}`, {token: adminToken, timeoutMs: 60000});
  return extractItems(data);
}

async function listSub2ApiAccountsForGroup(
  origin: string,
  adminToken: string,
  group: Sub2ApiGroupSelection,
): Promise<{accounts: Record<string, unknown>[]; matchedAccounts: Record<string, unknown>[]}> {
  const pageSize = 200;
  const maxPages = 50;
  const loadPages = async (groupId?: number): Promise<Record<string, unknown>[]> => {
    const out: Record<string, unknown>[] = [];
    for (let page = 1; page <= maxPages; page += 1) {
      const pageItems = await listSub2ApiAccountsPage(origin, adminToken, page, pageSize, groupId);
      const records = pageItems
        .filter((item) => item && typeof item === "object")
        .map((item) => unwrapSub2ApiAccount(item as Record<string, unknown>));
      out.push(...records);
      if (pageItems.length < pageSize) break;
    }
    return out;
  };

  try {
    const accounts = await loadPages(group.id);
    const hasGroupFields = accounts.some(sub2ApiAccountHasGroupFields);
    return {
      accounts,
      matchedAccounts: hasGroupFields ? accounts.filter((account) => sub2ApiAccountMatchesGroup(account, group)) : accounts,
    };
  } catch (error) {
    const accounts = await loadPages();
    if (!accounts.some(sub2ApiAccountHasGroupFields)) {
      throw new Error(`Sub2API 账号列表缺少分组字段，无法确认分组 ${group.name}#${group.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
    return {
      accounts,
      matchedAccounts: accounts.filter((account) => sub2ApiAccountMatchesGroup(account, group)),
    };
  }
}

interface LocalSub2ApiPruneResult {
  removedTasks: number;
  clearedEmails: number;
}

function isSub2ApiAccountNameInGroupScope(accountName: string, groupName: string): boolean {
  const name = asString(accountName).toLowerCase();
  if (!name) return false;
  const group = primarySub2ApiGroupName(groupName).toLowerCase();
  return name.endsWith(`---${group}`)
    || name.includes(`---${group}--ws-`)
    || name.endsWith("--nort")
    || name.includes("--nort--ws-");
}

async function pruneLocalSub2ApiRecordsForListedAccounts(
  listed: {matchedAccounts: Record<string, unknown>[]},
  groupName: string,
): Promise<LocalSub2ApiPruneResult> {
  const existingNames = listed.matchedAccounts.map(sub2ApiAccountName).filter(Boolean);
  const pruned = pruneTasksForMissingSub2ApiAccounts(emails, tasks, existingNames, {
    shouldInspectAccountName: (accountName) => isSub2ApiAccountNameInGroupScope(accountName, groupName),
  });
  emails = pruned.emails;
  tasks = pruned.tasks;
  if (pruned.removedTasks || pruned.clearedEmails) {
    await Promise.all([persistTasks(), persistEmails()]);
  }
  return {removedTasks: pruned.removedTasks, clearedEmails: pruned.clearedEmails};
}

async function pruneLocalSub2ApiRecordsForMissingAccountNames(accountNames: string[]): Promise<LocalSub2ApiPruneResult> {
  const missingNames = new Set(accountNames.map((item) => item.toLowerCase()).filter(Boolean));
  if (!missingNames.size) return {removedTasks: 0, clearedEmails: 0};
  const pruned = pruneTasksForMissingSub2ApiAccounts(emails, tasks, [], {
    shouldInspectAccountName: (accountName) => missingNames.has(accountName.toLowerCase()),
  });
  emails = pruned.emails;
  tasks = pruned.tasks;
  if (pruned.removedTasks || pruned.clearedEmails) {
    await Promise.all([persistTasks(), persistEmails()]);
  }
  return {removedTasks: pruned.removedTasks, clearedEmails: pruned.clearedEmails};
}

function credentialExpiryMs(value: unknown): number {
  if (value === undefined || value === null || value === "") return 0;
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 100000000000 ? value : value * 1000;
  }
  const text = String(value).trim();
  if (!text) return 0;
  if (/^\d+$/.test(text)) {
    const numeric = Number(text);
    return numeric > 100000000000 ? numeric : numeric * 1000;
  }
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : 0;
}

function sub2ApiAccountIsNormal(account: Record<string, unknown>): boolean {
  const unwrapped = unwrapSub2ApiAccount(account);
  const status = asString(unwrapped.status || unwrapped.state || unwrapped.account_status).toLowerCase();
  const unhealthyStatuses = new Set([
    "disabled",
    "disable",
    "inactive",
    "paused",
    "pause",
    "banned",
    "deleted",
    "removed",
    "expired",
    "error",
    "failed",
    "suspended",
    "invalid",
  ]);
  if (status && unhealthyStatuses.has(status)) return false;
  for (const key of ["disabled", "is_disabled", "paused", "is_paused", "deleted", "is_deleted", "banned", "is_banned", "expired", "is_expired"]) {
    if (asBoolean(unwrapped[key], false)) return false;
  }
  for (const key of ["enabled", "is_enabled", "active", "is_active"]) {
    if (unwrapped[key] !== undefined && !asBoolean(unwrapped[key], true)) return false;
  }
  if (unwrapped.deleted_at || unwrapped.deletedAt) return false;

  const credentials = sub2ApiAccountCredentials(unwrapped);
  const hasRefreshToken = Boolean(asString(credentials.refresh_token || credentials.refreshToken));
  const hasAccessToken = Boolean(extractAccessTokenFromCredentials(credentials));
  const expiresAt = credentialExpiryMs(
    credentials.expires_at
      || credentials.expiresAt
      || credentials.expired
      || unwrapped.expires_at
      || unwrapped.expiresAt,
  );
  if (hasAccessToken && !hasRefreshToken && expiresAt && expiresAt <= Date.now() + 60_000) return false;
  return true;
}

function pendingSub2ApiRefillTaskCount(groupName: string): number {
  const target = primarySub2ApiGroupName(groupName).toLowerCase();
  return tasks.filter((task) => (
    (task.status === "queued" || task.status === "running")
    && task.runSub2Api
    && primarySub2ApiGroupName(task.sub2apiGroupName || appConfig.sub2apiGroupName).toLowerCase() === target
  )).length;
}

function availableRefillEmails(): EmailRecord[] {
  if (appConfig.smsBowerMailEnabled) {
    return Array.from({length: Math.max(1, appConfig.sub2apiRefillEmailCount)}, (_, index) => ({
      id: `${appConfig.gmailMailProvider}_available_${index}`,
      email: `${appConfig.gmailMailProvider}-dynamic-${index}@gmail.com`,
      password: "",
      mailboxUrl: "",
      raw: "",
      status: "free" as EmailStatus,
      importedAt: nowIso(),
      updatedAt: nowIso(),
    }));
  }
  return emails.filter((email) => email.status === "free" && !hasActiveTask(email.id));
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workers = Array.from({length: Math.max(1, Math.min(limit, items.length || 1))}, async () => {
    while (nextIndex < items.length) {
      const current = nextIndex;
      nextIndex += 1;
      results[current] = await worker(items[current], current);
    }
  });
  await Promise.all(workers);
  return results;
}

async function appendSub2ApiRefillHistory(entry: Sub2ApiRefillHistoryEntry): Promise<void> {
  sub2apiRefillHistory.unshift(entry);
  if (sub2apiRefillHistory.length > 200) sub2apiRefillHistory = sub2apiRefillHistory.slice(0, 200);
  await persistSub2ApiRefillHistory();
}

function sub2ApiRefillStatus(): Record<string, unknown> {
  return {
    enabled: appConfig?.sub2apiAutoRefillEnabled === true,
    running: sub2apiRefillRunning,
    nextCheckAt: sub2apiRefillNextCheckAt,
    lastCheckedAt: sub2apiRefillLastCheckedAt,
    lastError: sub2apiRefillLastError,
    lastResult: sub2apiRefillLastResult,
    autoAtRepair: {
      enabled: appConfig?.sub2apiAutoAtRepairEnabled === true,
      running: sub2apiAutoAtRepairRunning,
      lastCheckedAt: sub2apiAutoAtRepairLastCheckedAt,
      lastError: sub2apiAutoAtRepairLastError,
      lastResult: sub2apiAutoAtRepairLastResult,
    },
    history: sub2apiRefillHistory.slice(0, 50),
  };
}

function updateSub2ApiRefillNextCheck(): void {
  const enabled = appConfig?.sub2apiAutoRefillEnabled || appConfig?.sub2apiAutoAtRepairEnabled;
  sub2apiRefillNextCheckAt = enabled
    ? new Date(Date.now() + Math.max(10000, appConfig.sub2apiRefillIntervalMs)).toISOString()
    : "";
}

function configureSub2ApiRefillTimer(): void {
  if (sub2apiRefillTimer) {
    clearInterval(sub2apiRefillTimer);
    sub2apiRefillTimer = undefined;
  }
  if (!appConfig?.sub2apiAutoRefillEnabled && !appConfig?.sub2apiAutoAtRepairEnabled) {
    sub2apiRefillNextCheckAt = "";
    return;
  }
  const intervalMs = Math.max(10000, appConfig.sub2apiRefillIntervalMs);
  updateSub2ApiRefillNextCheck();
  sub2apiRefillTimer = setInterval(() => {
    updateSub2ApiRefillNextCheck();
    if (appConfig.sub2apiAutoRefillEnabled && !sub2apiRefillRunning) {
      void runSub2ApiRefill("timer").catch((error) => {
        sub2apiRefillLastError = error instanceof Error ? error.message : String(error);
        console.error(`[sub2api-refill] ${sub2apiRefillLastError}`);
      });
    }
    if (appConfig.sub2apiAutoAtRepairEnabled && !sub2apiAutoAtRepairRunning) {
      void runSub2ApiAutoAtRepair("timer").catch((error) => {
        sub2apiAutoAtRepairLastError = error instanceof Error ? error.message : String(error);
        console.error(`[sub2api-auto-at-repair] ${sub2apiAutoAtRepairLastError}`);
      });
    }
  }, intervalMs);
}

async function runSub2ApiRefill(source: "manual" | "timer"): Promise<Sub2ApiRefillResult> {
  if (sub2apiRefillRunning) {
    throw new Error("Sub2API 补号检测正在运行，请稍后再试");
  }
  sub2apiRefillRunning = true;
  sub2apiRefillLastCheckedAt = nowIso();
  sub2apiRefillLastError = "";
  try {
    await reconcileAndPersistEmailStatuses();
    const groupName = primarySub2ApiGroupName(appConfig.sub2apiRefillGroupName || appConfig.sub2apiGroupName || "k12");
    const threshold = Math.max(0, appConfig.sub2apiRefillThreshold);
    const refillEmailCount = Math.max(1, appConfig.sub2apiRefillEmailCount);
    const deepCheckEnabled = appConfig.sub2apiRefillDeepCheckEnabled === true;
    const {origin, token: adminToken} = await loginSub2ApiAdmin();
    const [group] = await resolveSub2ApiGroups(origin, adminToken, [groupName]);
    if (!group) throw new Error(`Sub2API 未找到补号分组: ${groupName}`);

    const listed = await listSub2ApiAccountsForGroup(origin, adminToken, group);
    const localPrune = await pruneLocalSub2ApiRecordsForListedAccounts(listed, group.name);
    const basicNormalAccounts = listed.matchedAccounts.filter(sub2ApiAccountIsNormal);
    let normalAccounts = basicNormalAccounts.length;
    let deepChecked = 0;
    let deepOk = 0;
    let deepFailed = 0;
    const samples: string[] = [];
    if (deepCheckEnabled && basicNormalAccounts.length) {
      const deepResults = await mapWithConcurrency(
        basicNormalAccounts,
        Math.max(1, Math.min(appConfig.sub2apiConcurrency || 1, 5)),
        async (account) => {
          const accountName = sub2ApiAccountName(account) || "(unnamed)";
          const accountId = sub2ApiAccountId(account);
          const accessToken = extractAccessTokenFromCredentials(sub2ApiAccountCredentials(account));
          const result = accountId
            ? await testSub2ApiAccountLiveness(origin, adminToken, accountId)
            : accessToken
              ? await testOpenAiAccessToken(accessToken)
              : {ok: false, status: 0, message: "Sub2API 账号缺少 id 且 credentials 缺少 access_token", latencyMs: 0};
          return {accountName, result};
        },
      );
      deepChecked = deepResults.length;
      deepOk = deepResults.filter((item) => item.result.ok).length;
      deepFailed = deepResults.length - deepOk;
      normalAccounts = deepOk;
      for (const item of deepResults) {
        if (item.result.ok || samples.length >= 10) continue;
        samples.push(`${item.accountName}: ${item.result.message}`);
      }
    }
    const pendingTasks = pendingSub2ApiRefillTaskCount(group.name);
    const availableEmails = availableRefillEmails().length;
    const shouldRefill = normalAccounts < threshold;
    const desiredCreate = shouldRefill ? Math.max(0, Math.min(refillEmailCount - pendingTasks, availableEmails)) : 0;
    let createdTasks = 0;
    let skippedRunning = 0;
    let missing = 0;

    if (desiredCreate > 0) {
      const created = await createTasks({
        count: desiredCreate,
        workspaceIds: appConfig.workspaceIds,
        route: appConfig.route,
        runWorkspaceJoin: appConfig.runWorkspaceJoin,
        runSub2Api: true,
        sub2apiNoRtMode: appConfig.sub2apiNoRtMode,
        sub2apiGroupName: group.name,
      });
      createdTasks = created.created.length;
      skippedRunning = created.skippedRunning;
      missing = created.missing;
    }

    let message = `分组 ${group.name} 正常账号 ${normalAccounts}/${threshold}`;
    if (deepCheckEnabled) {
      message += `，深度测活 ${deepOk}/${deepChecked}`;
    }
    if (!shouldRefill) {
      message += "，未低于预警线";
    } else if (createdTasks > 0) {
      message += `，已创建补号任务 ${createdTasks} 个`;
    } else if (pendingTasks >= refillEmailCount) {
      message += `，已有补号任务 ${pendingTasks} 个在队列/运行中，本轮不重复创建`;
    } else if (!availableEmails) {
      message += "，但没有空闲邮箱可补";
    } else {
      message += "，未创建新任务";
    }
    if (localPrune.removedTasks || localPrune.clearedEmails) {
      message += `，已清理 Sub2 已删除本地任务 ${localPrune.removedTasks} 个/解绑 ${localPrune.clearedEmails} 个`;
    }

    const result: Sub2ApiRefillResult = {
      checkedAt: sub2apiRefillLastCheckedAt,
      source,
      groupName: group.name,
      groupLabel: `${group.name}#${group.id}`,
      threshold,
      refillEmailCount,
      deepCheckEnabled,
      totalAccounts: listed.accounts.length,
      matchedAccounts: listed.matchedAccounts.length,
      basicNormalAccounts: basicNormalAccounts.length,
      normalAccounts,
      deepChecked,
      deepOk,
      deepFailed,
      pendingTasks,
      availableEmails,
      shouldRefill,
      createdTasks,
      skippedRunning,
      missing,
      prunedTasks: localPrune.removedTasks,
      clearedSub2Links: localPrune.clearedEmails,
      message,
      samples,
    };
    sub2apiRefillLastResult = result;
    await appendSub2ApiRefillHistory({
      id: `refill_${Date.now()}_${randomUUID().slice(0, 8)}`,
      ok: true,
      ...result,
    });
    return result;
  } catch (error) {
    sub2apiRefillLastError = error instanceof Error ? error.message : String(error);
    await appendSub2ApiRefillHistory({
      id: `refill_${Date.now()}_${randomUUID().slice(0, 8)}`,
      checkedAt: sub2apiRefillLastCheckedAt || nowIso(),
      source,
      ok: false,
      groupName: primarySub2ApiGroupName(appConfig.sub2apiRefillGroupName || appConfig.sub2apiGroupName || "k12"),
      threshold: Math.max(0, appConfig.sub2apiRefillThreshold),
      refillEmailCount: Math.max(1, appConfig.sub2apiRefillEmailCount),
      deepCheckEnabled: appConfig.sub2apiRefillDeepCheckEnabled === true,
      message: `补号检测失败：${sub2apiRefillLastError}`,
      error: sub2apiRefillLastError,
      samples: [sub2apiRefillLastError],
    });
    throw error;
  } finally {
    sub2apiRefillRunning = false;
    updateSub2ApiRefillNextCheck();
  }
}

function sub2ApiAccountK12RepairIssue(account: Record<string, unknown>): {issue: K12RepairIssue; message: string; repairable: boolean} | null {
  const accessToken = extractAccessTokenFromCredentials(sub2ApiAccountCredentials(account));
  const statusError = sub2ApiAccountK12StatusError(account, accessToken, appConfig.workspaceIds);
  if (statusError) {
    return {
      issue: SUB2API_K12_STATUS_ERROR_ISSUE,
      message: statusError,
      repairable: !isTerminalK12AccessDeniedMessage(statusError),
    };
  }
  const planMismatch = sub2ApiAccountK12PlanMismatch(account, accessToken, appConfig.workspaceIds);
  if (planMismatch) {
    return {issue: K12_PLAN_MISMATCH_ISSUE, message: planMismatch, repairable: true};
  }
  return null;
}

function findLocalEmailForSub2ApiAccount(account: Record<string, unknown>): EmailRecord | undefined {
  const accountName = sub2ApiAccountName(account).toLowerCase();
  if (accountName) {
    const bySavedAccount = emails.find((email) => asString(email.sub2apiAccount).toLowerCase() === accountName);
    if (bySavedAccount) return bySavedAccount;
  }

  const credentials = sub2ApiAccountCredentials(account);
  const candidates = new Set<string>(sub2ApiAccountEmailCandidatesFromName(accountName));
  for (const value of [
    credentials.email,
    credentials.account_email,
    credentials.accountEmail,
    credentials.chatgpt_email,
    credentials.chatgptEmail,
  ]) {
    const email = asString(value).toLowerCase();
    if (email) candidates.add(email);
  }
  if (!candidates.size) return undefined;
  return emails.find((email) => candidates.has(email.email.toLowerCase()));
}

async function runSub2ApiAutoAtRepair(source: "manual" | "timer"): Promise<Sub2ApiAutoAtRepairResult> {
  if (sub2apiAutoAtRepairRunning) {
    throw new Error("Sub2API 自动补 AT 正在运行，请稍后再试");
  }
  sub2apiAutoAtRepairRunning = true;
  sub2apiAutoAtRepairLastCheckedAt = nowIso();
  sub2apiAutoAtRepairLastError = "";
  try {
    await reconcileAndPersistEmailStatuses();
    const groupName = primarySub2ApiGroupName(appConfig.sub2apiRefillGroupName || appConfig.sub2apiGroupName || "k12");
    const {origin, token: adminToken} = await loginSub2ApiAdmin();
    const [group] = await resolveSub2ApiGroups(origin, adminToken, [groupName]);
    if (!group) throw new Error(`Sub2API 未找到自动补 AT 分组: ${groupName}`);

    const listed = await listSub2ApiAccountsForGroup(origin, adminToken, group);
    const localPrune = await pruneLocalSub2ApiRecordsForListedAccounts(listed, group.name);
    const samples: string[] = [];
    const queuedEmailIds = new Set<string>();
    let issueAccounts = 0;
    let matchedEmails = 0;
    let createdTasks = 0;
    let skippedRunning = 0;
    let skippedUnmatched = 0;
    let skippedTerminal = 0;

    for (const account of listed.matchedAccounts) {
      const accountName = sub2ApiAccountName(account) || "(unnamed)";
      let issue = sub2ApiAccountK12RepairIssue(account);
      if (!issue) {
        const accountId = sub2ApiAccountId(account);
        const accessToken = extractAccessTokenFromCredentials(sub2ApiAccountCredentials(account));
        const planMismatch = sub2ApiAccountK12PlanMismatch(account, accessToken, appConfig.workspaceIds);
        if (!planMismatch && accountId && sub2ApiAccountIsNormal(account)) {
          const liveness = await testSub2ApiAccountLiveness(origin, adminToken, accountId);
          issue = sub2ApiK12LivenessIssue({planMismatch, liveness});
        }
      }
      if (!issue) continue;
      if (!isAutoAtRepairIssue(issue.issue)) continue;
      const localEmail = findLocalEmailForSub2ApiAccount(account);
      if (!issue.repairable) {
        skippedTerminal += 1;
        const issueWorkspaceIds = workspaceIdsForSub2ApiAccountIssue(account, localEmail, appConfig.workspaceIds);
        const candidateEmail = sub2ApiAccountEmailCandidatesFromName(accountName)[0] || "";
        const blockedEmail = localEmail?.email || candidateEmail;
        if (blockedEmail && issueWorkspaceIds.length) {
          await blockEmailWorkspace({
            email: blockedEmail,
            workspaceIds: issueWorkspaceIds,
            reason: issue.message,
            source: `sub2api-auto-at-repair:${source}`,
            accountName,
          });
          if (samples.length < 10) {
            samples.push(`${blockedEmail}: ${issue.message}，已标记该邮箱/workspace 为 403 死号，跳过补 AT`);
          }
        } else {
          skippedUnmatched += 1;
          if (samples.length < 10) samples.push(`${accountName}: ${issue.message}，403 工作区拒绝访问，但未能确定本地邮箱或 workspace`);
        }
        continue;
      }
      issueAccounts += 1;
      if (!localEmail) {
        skippedUnmatched += 1;
        if (samples.length < 10) samples.push(`${accountName}: ${issue.message}，未匹配到本地邮箱`);
        continue;
      }
      matchedEmails += 1;
      const canCreate = shouldCreateAutoAtRepairTask({
        issue: issue.issue,
        matchedLocalEmail: true,
        emailStatus: localEmail.status,
        hasActiveTask: hasActiveTask(localEmail.id) || queuedEmailIds.has(localEmail.id),
        message: issue.message,
      });
      if (!canCreate) {
        skippedRunning += 1;
        if (samples.length < 10) samples.push(`${localEmail.email}: ${issue.message}，已有任务或邮箱不可用`);
        continue;
      }
      const created = createAtRepairTasks({
        emailIds: [localEmail.id],
        sub2apiGroupName: group.name,
      });
      const task = created.created[0];
      if (task) {
        queuedEmailIds.add(localEmail.id);
        createdTasks += 1;
        appendLog(task, "info", `自动补 AT 来源: ${accountName}; ${issue.message}`);
        if (samples.length < 10) samples.push(`${localEmail.email}: ${issue.message}，已创建 ${task.id}`);
      } else {
        skippedRunning += created.skippedRunning || 1;
        if (samples.length < 10) samples.push(`${localEmail.email}: ${issue.message}，未创建修复任务`);
      }
    }

    const terminalSuffix = skippedTerminal ? `，跳过 403 死号 ${skippedTerminal} 个` : "";
    const pruneSuffix = localPrune.removedTasks || localPrune.clearedEmails
      ? `，已清理 Sub2 已删除本地任务 ${localPrune.removedTasks} 个/解绑 ${localPrune.clearedEmails} 个`
      : "";
    const message = issueAccounts
      ? `自动补 AT 扫描 ${listed.matchedAccounts.length} 个账号，发现可补 K12 错误 ${issueAccounts} 个，已创建修复任务 ${createdTasks} 个${terminalSuffix}`
      : `自动补 AT 扫描 ${listed.matchedAccounts.length} 个账号，未发现可补 K12 错误${terminalSuffix}`;
    const result: Sub2ApiAutoAtRepairResult = {
      checkedAt: sub2apiAutoAtRepairLastCheckedAt,
      source,
      groupName: group.name,
      groupLabel: `${group.name}#${group.id}`,
      scannedAccounts: listed.matchedAccounts.length,
      issueAccounts,
      matchedEmails,
      createdTasks,
      skippedRunning,
      skippedUnmatched,
      skippedTerminal,
      prunedTasks: localPrune.removedTasks,
      clearedSub2Links: localPrune.clearedEmails,
      message: `${message}${pruneSuffix}`,
      samples,
    };
    sub2apiAutoAtRepairLastResult = result;
    return result;
  } catch (error) {
    sub2apiAutoAtRepairLastError = error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    sub2apiAutoAtRepairRunning = false;
    updateSub2ApiRefillNextCheck();
  }
}

async function testOpenAiAccessToken(accessToken: string, model = DEFAULT_AT_LIVENESS_MODEL): Promise<{ok: boolean; status: number; message: string; latencyMs: number; banned?: boolean}> {
  const tokenInfo = summarizeToken(accessToken);
  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45000);
  try {
    const response = await undiciFetch(CHATGPT_CODEX_RESPONSES_URL, {
      method: "POST",
      ...buildDownloadFetchOptions(),
      headers: {
        Accept: "text/event-stream, application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
        "OpenAI-Beta": "responses=experimental",
        originator: "opencode",
        ...(tokenInfo.accountId ? {"chatgpt-account-id": tokenInfo.accountId} : {}),
      },
      body: JSON.stringify({
        model,
        input: [{
          role: "user",
          content: [{type: "input_text", text: "hi"}],
        }],
        instructions: "You are a helpful assistant.",
        stream: true,
        store: false,
      }),
      signal: controller.signal,
    });
    const text = await response.text().catch(() => "");
    const parsed = (() => {
      try {
        return text ? JSON.parse(text) : null;
      } catch {
        return null;
      }
    })();
    const latencyMs = Date.now() - startedAt;
    if (response.ok) {
      return {ok: true, status: response.status, message: `AT 存活: HTTP ${response.status} / ${latencyMs}ms`, latencyMs};
    }
    const reason = pickErrorMessage(parsed, text.slice(0, 240) || `HTTP ${response.status}`);
    const message = `AT 失效/不可用: HTTP ${response.status}: ${reason}`;
    const terminalText = `${reason}\n${text}`;
    return {
      ok: false,
      status: response.status,
      message,
      latencyMs,
      banned: isOpenAiAccountBannedMessage(terminalText) || isOpenAiWorkspaceAccessDeniedMessage(terminalText),
    };
  } catch (error) {
    const latencyMs = Date.now() - startedAt;
    if (error instanceof Error && error.name === "AbortError") {
      return {ok: false, status: 0, message: "AT 测活超时", latencyMs};
    }
    const message = `AT 测活失败: ${error instanceof Error ? error.message : String(error)}`;
    return {ok: false, status: 0, message, latencyMs, banned: isOpenAiAccountBannedMessage(message)};
  } finally {
    clearTimeout(timer);
  }
}

async function testSub2ApiAccountLiveness(
  origin: string,
  adminToken: string,
  accountId: string,
  model = DEFAULT_AT_LIVENESS_MODEL,
): Promise<{ok: boolean; status: number; message: string; latencyMs: number; banned?: boolean}> {
  const startedAt = Date.now();
  try {
    const data = await requestSub2ApiJson(origin, `/api/v1/admin/accounts/${encodeURIComponent(accountId)}/test`, {
      method: "POST",
      token: adminToken,
      body: {model_id: model, prompt: ""},
      timeoutMs: 60000,
      accept: "text/event-stream, application/json",
    });
    const raw = typeof data === "string"
      ? data
      : data && typeof data === "object" && typeof (data as Record<string, unknown>).raw === "string"
        ? String((data as Record<string, unknown>).raw)
        : JSON.stringify(data || "");
    const lower = raw.toLowerCase();
    const latencyMs = Date.now() - startedAt;
    if (lower.includes("\"type\":\"error\"") || lower.includes("\"success\":false")) {
      return {
        ok: false,
        status: sub2ApiTestErrorStatus(raw),
        message: `Sub2API 测活失败: ${raw.slice(0, 240)}`,
        latencyMs,
        banned: isOpenAiWorkspaceAccessDeniedMessage(raw),
      };
    }
    return {ok: true, status: 200, message: `Sub2API 测活通过 / ${latencyMs}ms`, latencyMs};
  } catch (error) {
    const latencyMs = Date.now() - startedAt;
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      status: sub2ApiTestErrorStatus(message),
      message: `Sub2API 测活失败: ${message}`,
      latencyMs,
      banned: isOpenAiWorkspaceAccessDeniedMessage(message),
    };
  }
}

function sub2ApiTestErrorStatus(raw: string): number {
  const match = String(raw || "").match(/(?:API returned|HTTP|Access forbidden\s*\()\s*(\d{3})/i);
  return match ? Number(match[1]) || 0 : 0;
}

async function checkSub2ApiAccessTokens(body: Record<string, unknown>): Promise<{
  items: Array<{
    emailId: string;
    email: string;
    accountName: string;
    accountId: string;
    ok: boolean;
    issue?: K12RepairIssue;
    status: number;
    message: string;
    latencyMs: number;
    repairTaskId?: string;
    repairable?: boolean;
  }>;
  ok: number;
  failed: number;
  missing: number;
  skippedRunning: number;
  prunedTasks: number;
  clearedSub2Links: number;
}> {
  const requestedEmailIds = Array.isArray(body.emailIds)
    ? body.emailIds.map((item) => String(item)).filter(Boolean)
    : [];
  const requested = new Set(requestedEmailIds);
  const existingIds = new Set(emails.map((item) => item.id));
  const missing = requestedEmailIds.filter((id) => !existingIds.has(id)).length;
  const selectedEmails = emails.filter((item) => requested.has(item.id));
  const sub2apiGroupName = asString(body.sub2apiGroupName, appConfig.sub2apiGroupName) || "k12";
  const onlyK12RepairIssues = body.onlyK12RepairIssues === true || body.onlyK12Mismatch === true;
  const autoCreateRepairTasks = body.autoCreateRepairTasks !== false;
  const items: Array<{
    emailId: string;
    email: string;
    accountName: string;
    accountId: string;
    ok: boolean;
    issue?: K12RepairIssue;
    status: number;
    message: string;
    latencyMs: number;
    repairTaskId?: string;
    repairable?: boolean;
  }> = [];
  let skippedRunning = 0;
  let changedEmails = false;
  let prunedTasks = 0;
  let clearedSub2Links = 0;

  const {origin, token: adminToken} = await loginSub2ApiAdmin();

  for (const email of selectedEmails) {
    if (email.status === "running" || email.status === "banned" || hasActiveTask(email.id)) {
      skippedRunning += 1;
      continue;
    }

    const startedAt = Date.now();
    try {
      const names = expectedSub2ApiAccountNamesForWorkspaceCandidates(email, sub2apiGroupName, appConfig.workspaceIds);
      const account = await findSub2ApiAccountByName(origin, adminToken, names);
      if (!account) {
        const localPrune = await pruneLocalSub2ApiRecordsForMissingAccountNames(names);
        prunedTasks += localPrune.removedTasks;
        clearedSub2Links += localPrune.clearedEmails;
        if (onlyK12RepairIssues) continue;
        const message = `Sub2API 未找到账号: ${names.join(" / ")}`;
        items.push({
          emailId: email.id,
          email: email.email,
          accountName: "",
          accountId: "",
          ok: false,
          status: 404,
          message,
          latencyMs: Date.now() - startedAt,
        });
        continue;
      }

      const accountId = sub2ApiAccountId(account);
      const accountName = sub2ApiAccountName(account);
      if (accountName && email.sub2apiAccount !== accountName) {
        email.sub2apiAccount = accountName;
        email.updatedAt = nowIso();
        changedEmails = true;
      }
      if (!accountId) {
        if (onlyK12RepairIssues) continue;
        items.push({
          emailId: email.id,
          email: email.email,
          accountName,
          accountId: "",
          ok: false,
          status: 0,
          message: `Sub2API 账号缺少 id: ${accountName || "(unknown)"}`,
          latencyMs: Date.now() - startedAt,
        });
        continue;
      }

      const accessToken = extractAccessTokenFromCredentials(sub2ApiAccountCredentials(account));
      const k12StatusError = sub2ApiAccountK12StatusError(account, accessToken, appConfig.workspaceIds);
      if (k12StatusError) {
        const repairable = !isTerminalK12AccessDeniedMessage(k12StatusError);
        if (!repairable) {
          const issueWorkspaceIds = workspaceIdsForSub2ApiAccountIssue(account, email, appConfig.workspaceIds);
          await blockEmailWorkspace({
            email: email.email,
            workspaceIds: issueWorkspaceIds,
            reason: k12StatusError,
            source: "email-check-at",
            accountName,
          });
          if (onlyK12RepairIssues) continue;
        }
        if (onlyK12RepairIssues && !repairable) continue;
        items.push({
          emailId: email.id,
          email: email.email,
          accountName,
          accountId,
          ok: false,
          issue: SUB2API_K12_STATUS_ERROR_ISSUE,
          status: repairable ? 409 : 403,
          message: k12StatusError,
          latencyMs: Date.now() - startedAt,
          repairable,
        });
        continue;
      }

      const planMismatch = sub2ApiAccountK12PlanMismatch(account, accessToken, appConfig.workspaceIds);
      if (planMismatch) {
        const created = autoCreateRepairTasks
          ? createAtRepairTasks({
            emailIds: [email.id],
            sub2apiGroupName,
          })
          : {created: [], skippedRunning: 0};
        const repairTask = created.created[0];
        const message = repairTask
          ? `${planMismatch}，已自动创建 AT 修复任务 ${repairTask.id}`
          : autoCreateRepairTasks
            ? `${planMismatch}，但 AT 修复任务未创建${created.skippedRunning ? "：该邮箱已有运行中任务" : ""}`
            : planMismatch;
        items.push({
          emailId: email.id,
          email: email.email,
          accountName,
          accountId,
          ok: false,
          issue: K12_PLAN_MISMATCH_ISSUE,
          status: 409,
          message,
          latencyMs: Date.now() - startedAt,
          repairTaskId: repairTask?.id,
        });
        continue;
      }
      if (onlyK12RepairIssues) continue;
      let result: AccessTokenLivenessResult;
      if (accessToken) {
        const directResult = await testOpenAiAccessToken(accessToken);
        if (shouldTrySub2LivenessAfterDirectFailure(directResult)) {
          const sub2apiResult = await testSub2ApiAccountLiveness(origin, adminToken, accountId);
          result = combineDirectAndSub2Liveness(directResult, sub2apiResult);
        } else {
          result = directResult;
        }
      } else {
        result = await testSub2ApiAccountLiveness(origin, adminToken, accountId);
      }
      if (isOpenAiWorkspaceAccessDeniedMessage(result.message)) {
        const issueWorkspaceIds = workspaceIdsForSub2ApiAccountIssue(account, email, appConfig.workspaceIds);
        await blockEmailWorkspace({
          email: email.email,
          workspaceIds: issueWorkspaceIds,
          reason: result.message,
          source: "email-check-at-liveness",
          accountName,
        });
      }
      items.push({
        emailId: email.id,
        email: email.email,
        accountName,
        accountId,
        ok: result.ok,
        status: result.status,
        message: result.message,
        latencyMs: result.latencyMs,
      });
    } catch (error) {
      if (onlyK12RepairIssues) continue;
      items.push({
        emailId: email.id,
        email: email.email,
        accountName: "",
        accountId: "",
        ok: false,
        status: 0,
        message: error instanceof Error ? error.message : String(error),
        latencyMs: Date.now() - startedAt,
      });
    }
  }

  if (changedEmails) await persistEmails();
  return {
    items,
    ok: items.filter((item) => item.ok).length,
    failed: items.filter((item) => !item.ok).length,
    missing,
    skippedRunning,
    prunedTasks,
    clearedSub2Links,
  };
}

async function checkTaskAccessToken(task: K12Task): Promise<{
  task: Record<string, unknown>;
  email?: Record<string, unknown>;
  result: {ok: boolean; status: number; message: string; latencyMs: number; banned?: boolean};
  repairTask?: Record<string, unknown>;
}> {
  return checkTaskAccessTokenWithOptions(task, {autoRepair: true});
}

function isInactiveAccessTokenResult(result: {ok: boolean; status: number; message: string; banned?: boolean}): boolean {
  if (result.ok) return false;
  if (result.banned) return true;
  if (result.status === 401 || result.status === 403 || result.status === 409) return true;
  return /unauthorized|invalid[_ -]?token|token.*expired|access.*denied|套餐不是\s*K12|account.*(?:deactivated|disabled|suspended|banned)|封号|停用|被封禁/i.test(result.message);
}

function recordTaskAccessTokenLiveness(
  task: K12Task,
  result: {ok: boolean; status: number; message: string; banned?: boolean} | null,
  fallback: "unknown" | "error" = "error",
): void {
  if (!result) {
    task.accessTokenLiveness = fallback;
    task.accessTokenLivenessStatus = 0;
    task.accessTokenLivenessMessage = fallback === "unknown" ? "" : "未完成测活";
  } else {
    task.accessTokenLiveness = result.banned
      ? "banned"
      : result.ok
        ? "alive"
        : isInactiveAccessTokenResult(result)
          ? "inactive"
          : "error";
    task.accessTokenLivenessStatus = result.status;
    task.accessTokenLivenessMessage = result.message;
  }
  task.accessTokenLivenessCheckedAt = nowIso();
}

async function checkTaskAccessTokenWithOptions(
  task: K12Task,
  options: {autoRepair?: boolean} = {},
): Promise<{
  task: Record<string, unknown>;
  email?: Record<string, unknown>;
  result: {ok: boolean; status: number; message: string; latencyMs: number; banned?: boolean};
  repairTask?: Record<string, unknown>;
}> {
  if (task.status === "queued" || task.status === "running") {
    throw new Error("任务正在运行/排队中，不能测活");
  }
  const email = emails.find((item) => item.id === task.emailId);
  if (!email) throw new Error("邮箱记录不存在");
  if (email.status === "banned") throw new Error("该邮箱已标记封号，不再测活/修复");

  if (!task.accessToken && appConfig.tokenOut) {
    if (await hydrateTaskAccessTokensFromTokenOut()) await persistTasks();
  }
  if (!task.accessToken) {
    throw new Error("该任务没有保存完整 AT，无法测活；需要先重新跑一次获取 AT");
  }

  appendLog(task, "info", "开始使用任务保存的 AT 测活");
  let result: AccessTokenLivenessResult = await testOpenAiAccessToken(task.accessToken);
  if (result.ok && !isK12AccessToken(task.accessToken, task)) {
    result = {
      ok: false,
      status: 409,
      message: `任务 AT 套餐不是 K12: ${describeAccessTokenContext(task.accessToken)}`,
      latencyMs: result.latencyMs,
    };
  }
  if (shouldTrySub2LivenessAfterDirectFailure(result)) {
    try {
      appendLog(task, "info", "直接 AT 返回授权失败，改查 Sub2API 账号测活");
      const {origin, token: adminToken} = await loginSub2ApiAdmin();
      const names = expectedSub2ApiAccountNames(email, task.sub2apiGroupName || appConfig.sub2apiGroupName, task.workspaceIds);
      const matchedAccounts = await findSub2ApiAccountsByName(origin, adminToken, names);
      const account = matchedAccounts[0];
      const accountId = account ? sub2ApiAccountId(account) : "";
      const accountName = account ? sub2ApiAccountName(account) : "";
      if (account && accountId) {
        if (accountName) {
          task.sub2apiAccount = accountName;
          email.sub2apiAccount = accountName;
        }
        const planMismatch = sub2ApiAccountK12PlanMismatch(account, extractAccessTokenFromCredentials(sub2ApiAccountCredentials(account)), targetK12WorkspaceIds(task));
        if (planMismatch) {
          result = {
            ok: false,
            status: 409,
            message: planMismatch,
            latencyMs: result.latencyMs,
          };
          appendLog(task, "warn", planMismatch);
        } else {
        const sub2apiResult = await testSub2ApiAccountLiveness(origin, adminToken, accountId);
        appendLog(task, sub2apiResult.ok ? "ok" : "warn", `Sub2API 账号测活: ${sub2apiResult.message}`);
        result = combineDirectAndSub2Liveness(result, sub2apiResult);
        }
      } else {
        appendLog(task, "warn", `Sub2API 未找到可测活账号: ${names.join(" / ")}`);
      }
    } catch (error) {
      appendLog(task, "warn", `Sub2API fallback 测活失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  recordTaskAccessTokenLiveness(task, result);
  appendLog(task, result.ok ? "ok" : "warn", `任务 AT 测活: ${result.message}`);

  let repairTask: K12Task | undefined;
  if (result.banned) {
    if (isOpenAiWorkspaceAccessDeniedMessage(result.message)) {
      await blockEmailWorkspace({
        email: task.email || email.email,
        workspaceIds: targetK12WorkspaceIds(task),
        reason: result.message,
        source: "task-check-at",
        accountName: task.sub2apiAccount || email.sub2apiAccount,
      });
    } else {
      markEmailBanned(email, "GPT 账号已被 OpenAI 停用/封禁，停止继续获取 AT", task);
    }
  } else if (options.autoRepair !== false && !result.ok && (result.status === 401 || result.status === 409)) {
    appendLog(task, "warn", `${result.status === 409 ? "AT 套餐不是 K12" : "AT 返回 401"}，自动创建 AT 修复任务`);
    const created = createAtRepairTasks({
      emailIds: [task.emailId],
      sub2apiGroupName: task.sub2apiGroupName || appConfig.sub2apiGroupName || "k12",
    });
    repairTask = created.created[0];
    if (!repairTask && created.skippedRunning) {
      appendLog(task, "warn", "AT 修复任务未创建：该邮箱已有运行中任务");
    }
  } else if (!result.ok) {
    email.lastError = result.message;
    email.updatedAt = nowIso();
  }

  task.updatedAt = nowIso();
  await Promise.all([persistTasks(), persistEmails()]);
  return {
    task: publicTask(task),
    email: publicEmail(email),
    result,
    repairTask: repairTask ? publicTask(repairTask) : undefined,
  };
}

async function checkTaskAccessTokens(body: Record<string, unknown>): Promise<{
  items: Array<{
    taskId: string;
    emailId: string;
    email: string;
    ok: boolean;
    inactive: boolean;
    status: number;
    message: string;
    latencyMs: number;
    banned?: boolean;
    repairTaskId?: string;
    skipped?: boolean;
  }>;
  checked: number;
  inactive: number;
  ok: number;
  repaired: number;
  skipped: number;
}> {
  if (await hydrateTaskAccessTokensFromTokenOut()) await persistTasks();
  const taskIds = Array.isArray(body.taskIds)
    ? body.taskIds.map((item) => String(item)).filter(Boolean)
    : [];
  const idSet = new Set(taskIds);
  const onlyInactive = asBoolean(body.onlyInactive, false);
  const autoRepair = asBoolean(body.autoRepair, false);
  const candidates = taskIds.length
    ? tasks.filter((task) => idSet.has(task.id))
    : tasks.filter((task) => task.status !== "queued" && task.status !== "running" && (task.accessToken || task.accessTokenPreview));

  const items: Array<{
    taskId: string;
    emailId: string;
    email: string;
    ok: boolean;
    inactive: boolean;
    status: number;
    message: string;
    latencyMs: number;
    banned?: boolean;
    repairTaskId?: string;
    skipped?: boolean;
  }> = [];

  for (const task of candidates) {
    try {
      const checked = await checkTaskAccessTokenWithOptions(task, {autoRepair});
      const inactive = isInactiveAccessTokenResult(checked.result);
      if (onlyInactive && !inactive) continue;
      items.push({
        taskId: task.id,
        emailId: task.emailId,
        email: task.email,
        ok: checked.result.ok,
        inactive,
        status: checked.result.status,
        message: checked.result.message,
        latencyMs: checked.result.latencyMs,
        banned: checked.result.banned,
        repairTaskId: asString(checked.repairTask && (checked.repairTask as Record<string, unknown>).id),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (onlyInactive) continue;
      recordTaskAccessTokenLiveness(task, {ok: false, status: 0, message});
      items.push({
        taskId: task.id,
        emailId: task.emailId,
        email: task.email,
        ok: false,
        inactive: false,
        status: 0,
        message,
        latencyMs: 0,
        skipped: true,
      });
    }
  }

  return {
    items,
    checked: items.filter((item) => !item.skipped).length,
    inactive: items.filter((item) => item.inactive).length,
    ok: items.filter((item) => item.ok).length,
    repaired: items.filter((item) => item.repairTaskId).length,
    skipped: items.filter((item) => item.skipped).length,
  };
}

async function updateSub2ApiAccountAccessToken(
  origin: string,
  adminToken: string,
  account: Record<string, unknown>,
  email: EmailRecord,
  accessToken: string,
): Promise<void> {
  const accountId = sub2ApiAccountId(account);
  if (!accountId) throw new Error("Sub2API 账号缺少 id，无法更新");
  const credentials = mergeCredentials(
    sub2ApiAccountCredentials(account),
    accessToken,
    email,
  );
  await requestSub2ApiJson(origin, `/api/v1/admin/accounts/${encodeURIComponent(accountId)}/apply-oauth-credentials`, {
    method: "POST",
    token: adminToken,
    body: {
      type: "oauth",
      credentials,
      extra: {
        email: credentials.email || email.email,
        at_repaired_at: nowIso(),
        at_repair_source: "gpt-k12",
      },
    },
    timeoutMs: 60000,
  });
}

async function updateSub2ApiAccountPlacement(
  origin: string,
  adminToken: string,
  account: Record<string, unknown>,
  groups: Sub2ApiGroupSelection[],
  proxy?: Sub2ApiProxySelection,
): Promise<void> {
  const accountId = sub2ApiAccountId(account);
  if (!accountId) throw new Error("Sub2API 账号缺少 id，无法更新分组/IP管理");
  const body: Record<string, unknown> = {
    group_ids: groups.map((group) => group.id),
  };
  if (proxy) body.proxy_id = proxy.id;
  await requestSub2ApiJson(origin, `/api/v1/admin/accounts/${encodeURIComponent(accountId)}`, {
    method: "PUT",
    token: adminToken,
    body,
    timeoutMs: 60000,
  });
}

async function tryUpdateSub2ApiAccountPlacement(
  task: K12Task,
  origin: string,
  adminToken: string,
  account: Record<string, unknown>,
  groups: Sub2ApiGroupSelection[],
  proxy?: Sub2ApiProxySelection,
): Promise<void> {
  try {
    await updateSub2ApiAccountPlacement(origin, adminToken, account, groups, proxy);
    appendLog(
      task,
      "ok",
      `Sub2API noRT 账号已同步分组${proxy ? "/IP管理" : ""}: ${formatSub2ApiGroups(groups)}${proxy ? `; ${formatSub2ApiProxy(proxy)}` : ""}`,
    );
  } catch (error) {
    appendLog(task, "warn", `Sub2API noRT 账号分组/IP管理同步失败: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function buildSub2ApiNoRtCreateBody(
  accountName: string,
  credentials: Record<string, unknown>,
  email: EmailRecord,
  groups: Sub2ApiGroupSelection[],
  notes: string,
  source: string,
  proxy?: Sub2ApiProxySelection,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    name: accountName,
    notes,
    platform: "openai",
    type: "oauth",
    credentials,
    concurrency: appConfig.sub2apiConcurrency,
    priority: appConfig.sub2apiAccountPriority,
    rate_multiplier: 1,
    group_ids: groups.map((group) => group.id),
    auto_pause_on_expired: true,
    extra: {email: credentials.email || email.email, no_rt: true, source},
  };
  if (proxy) body.proxy_id = proxy.id;
  return body;
}

async function createSub2ApiNoRtAccountFromAccessToken(task: K12Task, email: EmailRecord, accessToken: string): Promise<string> {
  const groupNames = parseSub2ApiGroupNames(task.sub2apiGroupName || appConfig.sub2apiGroupName);
  const {origin, token: adminToken} = await loginSub2ApiAdmin();
  const groups = await resolveSub2ApiGroups(origin, adminToken, groupNames);
  const proxy = await resolveSub2ApiProxy(origin, adminToken);

  const credentials = buildSub2ApiCredentialsFromAccessToken(accessToken, email.email);
  const accountName = sub2ApiNoRtAccountName(email, task.workspaceIds);
  await requestSub2ApiJson(origin, "/api/v1/admin/accounts", {
    method: "POST",
    token: adminToken,
    body: buildSub2ApiNoRtCreateBody(
      accountName,
      credentials,
      email,
      groups,
      "noRT fallback: OAuth add-phone blocked; imported access_token only, no refresh_token",
      "ai-gpt-k12-add-phone-fallback",
      proxy,
    ),
  });
  appendLog(
    task,
    "warn",
    `Sub2API 已用 AT fallback 创建 noRT 账号: ${accountName} (${formatSub2ApiGroups(groups)}${proxy ? `; IP管理 ${formatSub2ApiProxy(proxy)}` : ""})`,
  );
  return accountName;
}

async function upsertSub2ApiNoRtAccountFromAccessToken(task: K12Task, email: EmailRecord, accessToken: string): Promise<string> {
  const groupNames = parseSub2ApiGroupNames(task.sub2apiGroupName || appConfig.sub2apiGroupName);
  const accountName = sub2ApiNoRtAccountName(email, task.workspaceIds);
  const {origin, token: adminToken} = await loginSub2ApiAdmin();
  const groups = await resolveSub2ApiGroups(origin, adminToken, groupNames);
  const proxy = await resolveSub2ApiProxy(origin, adminToken);
  const existing = await findSub2ApiAccountByName(origin, adminToken, [accountName]);
  if (existing) {
    await updateSub2ApiAccountAccessToken(origin, adminToken, existing, email, accessToken);
    await tryUpdateSub2ApiAccountPlacement(task, origin, adminToken, existing, groups, proxy);
    appendLog(task, "ok", `Sub2API noRT 账号已存在，已更新 AT: ${accountName}`);
    return accountName;
  }

  const credentials = buildSub2ApiCredentialsFromAccessToken(accessToken, email.email);
  await requestSub2ApiJson(origin, "/api/v1/admin/accounts", {
    method: "POST",
    token: adminToken,
    body: buildSub2ApiNoRtCreateBody(
      accountName,
      credentials,
      email,
      groups,
      "noRT mode: imported K12 access_token only, no refresh_token",
      "ai-gpt-k12-nort-mode",
      proxy,
    ),
    timeoutMs: 60000,
  });
  appendLog(
    task,
    "ok",
    `Sub2API noRT 账号已创建: ${accountName} (${formatSub2ApiGroups(groups)}${proxy ? `; IP管理 ${formatSub2ApiProxy(proxy)}` : ""})`,
  );
  return accountName;
}

async function getAuthSessionCandidates(client: any): Promise<Record<string, unknown>[]> {
  const candidates: Record<string, unknown>[] = [];
  if (typeof client.readCookie !== "function") return candidates;

  const cookieNames = [
    "oai-client-auth-session",
    "__Secure-oai-client-auth-session",
    "__Host-oai-client-auth-session",
  ];
  for (const cookieName of cookieNames) {
    const raw = await client.readCookie(AUTH_BASE_URL, cookieName).catch(() => "");
    if (!raw) continue;
    const encoded = String(raw).split(".")[0] || "";
    if (!encoded) continue;
    try {
      const decoded = decodeBase64UrlJson(encoded);
      if (decoded && typeof decoded === "object") {
        candidates.push(decoded as Record<string, unknown>);
      }
    } catch {
      // Cookie may not be a signed JSON payload in all auth variants.
    }
  }
  return candidates;
}

async function createOpenAIClientForEmail(task: K12Task, email: EmailRecord): Promise<any> {
  await ensureSentinelSdk();
  const {OpenAIClient, generateRandomDeviceProfile, MailboxUrlCodeProvider} = await loadBundleModules();
  let baseline: unknown = null;
  let fetchOtp: (label: string) => Promise<string>;

  if (email.otpMode === "manual") {
    appendLog(task, "info", "当前邮箱为手动接码模式");
    fetchOtp = (label: string) => waitForManualEmailOtp(task, email, label);
  } else if (email.otpMode === "smsbower-mail") {
    appendLog(task, "info", `当前邮箱为 SMSBower Gmail 动态接码模式: ${email.smsBowerMailId || "-"}`);
    fetchOtp = async (label: string) => {
      if (shouldRequestSmsBowerNextCodeBeforeWait({retryAfterWrongOtp: false})) {
        await requestSmsBowerNextMailCode(email, task, `${label}前准备等待验证码`);
      }
      return waitForSmsBowerMailCode(email, task, label);
    };
  } else if (email.otpMode === "emailnator") {
    appendLog(task, "info", `当前邮箱为 Emailnator Gmail 动态接码模式: ${email.email}`);
    fetchOtp = (label: string) => waitForEmailnatorCode(email, task, label);
  } else {
    const mailboxProvider = new MailboxUrlCodeProvider(email.mailboxUrl);
    try {
      baseline = await mailboxProvider.snapshot();
      appendLog(task, "info", "邮箱基线已读取，等待新验证码");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (isMailboxAccountInvalidMessage(message)) {
        throw new Error(`邮箱池账号不可用，停止任务: ${message}`);
      }
      appendLog(task, "warn", `邮箱基线读取失败，将直接轮询新验证码: ${message}`);
    }

    fetchOtp = async (label: string) => {
      appendLog(task, "info", `等待 ${label} 验证码: ${email.email}`);
      const retryAfterWrongOtp = task.freshEmailOtpOnlyOnce === true;
      task.freshEmailOtpOnlyOnce = false;
      if (retryAfterWrongOtp) {
        const retryWait = mailboxOtpWaitOptions({retryAfterWrongOtp});
        appendLog(task, "info", `本次只接受新验证码，不再使用邮箱基线旧验证码兜底，最多等待 ${Math.ceil(retryWait.timeoutMs / 1000)} 秒`);
      }
      let code = "";
      try {
        code = await mailboxProvider.waitForCode({
          baseline,
          ...mailboxOtpWaitOptions({retryAfterWrongOtp}),
          fetchTimeoutMs: 10000,
          progressIntervalMs: 30000,
          onProgress: (event: {attempt: number; elapsedMs: number; lastError: string}) => {
            appendLog(task, "info", `${label} 验证码暂未收到，继续等待 (${Math.ceil(event.elapsedMs / 1000)}s): ${event.lastError}`);
          },
        });
      } catch (error) {
        if (retryAfterWrongOtp && isMailboxBaselineCodeTimeoutMessage(error)) {
          throw new Error(`邮箱池未收到新的登录验证码，仍然只返回旧验证码: ${error instanceof Error ? error.message : String(error)}`);
        }
        throw error;
      }
      appendLog(task, "ok", `${label} 验证码已获取`);
      try {
        baseline = await mailboxProvider.snapshot();
      } catch {
        // Baseline refresh is best effort only.
      }
      return code;
    };
  }

  return new OpenAIClient({
    email: email.email,
    password: appConfig.defaultPassword,
    deviceProfile: generateRandomDeviceProfile(),
    signupScreenHint: "signup",
    bindEmail: email.email,
    fetchEmailOtp: () => fetchOtp("登录"),
    fetchAddEmailOtp: () => fetchOtp("绑定邮箱"),
  });
}

function collectIds(value: unknown, names: string[], out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) collectIds(item, names, out);
    return out;
  }
  if (!value || typeof value !== "object") return out;
  const record = value as Record<string, unknown>;
  for (const [key, child] of Object.entries(record)) {
    if (names.includes(key.toLowerCase()) && typeof child === "string" && child.trim()) {
      out.add(child.trim());
    }
    collectIds(child, names, out);
  }
  return out;
}

interface AuthAccountChoice {
  sessionId: string;
  email: string;
  label: string;
  source: string;
}

function decodeHtmlEntities(value: string): string {
  const named: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: "\"",
    apos: "'",
    nbsp: " ",
  };
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
    const key = entity.toLowerCase();
    if (key.startsWith("#x")) {
      const code = Number.parseInt(key.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    if (key.startsWith("#")) {
      const code = Number.parseInt(key.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return named[key] ?? match;
  });
}

function textFromHtml(value: string): string {
  return decodeHtmlEntities(value.replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim());
}

function parseChooseAccountChoices(html: string): AuthAccountChoice[] {
  const choices: AuthAccountChoice[] = [];
  const seen = new Set<string>();
  const buttonMatches = html.matchAll(/<button\b[\s\S]*?<\/button>/gi);
  for (const match of buttonMatches) {
    const button = match[0];
    if (!/\bname\s*=\s*["']session_id["']/i.test(button)) continue;
    const valueMatch = button.match(/\bvalue\s*=\s*["']([^"']+)["']/i);
    const sessionId = decodeHtmlEntities(valueMatch?.[1] || "").trim();
    if (!sessionId || seen.has(sessionId)) continue;
    seen.add(sessionId);
    const decodedButton = decodeHtmlEntities(button);
    const email = decodedButton.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0]?.toLowerCase() || "";
    choices.push({
      sessionId,
      email,
      label: textFromHtml(button).slice(0, 120),
      source: "html",
    });
  }
  return choices;
}

function orderChooseAccountChoices(choices: AuthAccountChoice[], expectedEmail = ""): AuthAccountChoice[] {
  const expected = expectedEmail.trim().toLowerCase();
  if (!expected) return choices;
  const exact = choices.filter((item) => item.email === expected);
  const unknown = choices.filter((item) => !item.email);
  const mismatched = choices.filter((item) => item.email && item.email !== expected);
  return [...exact, ...unknown, ...mismatched];
}

async function extractNextAuthUrl(response: Response, baseUrl: string): Promise<{nextUrl: string; error: string}> {
  const location = response.headers.get("location");
  if (location) return {nextUrl: new URL(location, baseUrl).toString(), error: ""};

  const text = await response.text().catch(() => "");
  const trimmed = text.slice(0, 500);
  try {
    const data = JSON.parse(text) as {continue_url?: string; page?: {payload?: {url?: string}}};
    const nextUrl = String(data.page?.payload?.url || data.continue_url || "");
    if (nextUrl) return {nextUrl: new URL(nextUrl, baseUrl).toString(), error: ""};
  } catch {
    // Some auth endpoints return HTML after a form submit.
  }

  const callbackMatch = text.match(/http:\/\/localhost:1455\/auth\/callback\?[^"' <]+/i);
  if (callbackMatch) return {nextUrl: callbackMatch[0].replace(/&amp;/g, "&"), error: ""};

  const authUrlMatch = text.match(/https:\/\/auth\.openai\.com\/[^"' <]+/i);
  if (authUrlMatch) return {nextUrl: authUrlMatch[0].replace(/&amp;/g, "&"), error: ""};

  if (!response.ok) return {nextUrl: "", error: `HTTP ${response.status}: ${trimmed}`};
  return {nextUrl: "", error: `无跳转地址: ${trimmed}`};
}

async function submitChooseAccountPayload(
  client: any,
  payload: Record<string, unknown>,
  refererUrl: string,
  task?: K12Task,
): Promise<{nextUrl: string; error: string}> {
  const payloadKey = JSON.stringify(payload);
  const response = await client.fetch(`${AUTH_BASE_URL}/api/accounts/session/select`, {
    method: "POST",
    redirect: "manual",
    headers: oauthBrowserHeaders(client, {
      accept: "application/json",
      "content-type": "application/json",
      origin: AUTH_BASE_URL,
      referer: refererUrl,
      "sec-fetch-dest": "empty",
      "sec-fetch-mode": "cors",
      "sec-fetch-site": "same-origin",
    }),
    body: JSON.stringify(payload),
  });
  const result = await extractNextAuthUrl(response, refererUrl);
  if (task) {
    appendLog(task, result.nextUrl ? "info" : "warn", `choose-account api ${payloadKey} -> ${result.nextUrl || result.error}`);
  }
  return result;
}

async function submitChooseAccountForm(
  client: any,
  sessionId: string,
  refererUrl: string,
  task?: K12Task,
): Promise<{nextUrl: string; error: string}> {
  const response = await client.fetch(AUTH_CHOOSE_ACCOUNT_URL, {
    method: "POST",
    redirect: "manual",
    headers: oauthBrowserHeaders(client, {
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "content-type": "application/x-www-form-urlencoded",
      origin: AUTH_BASE_URL,
      referer: refererUrl,
      "sec-fetch-dest": "document",
      "sec-fetch-mode": "navigate",
      "sec-fetch-site": "same-origin",
    }),
    body: new URLSearchParams({session_id: sessionId}).toString(),
  });
  const result = await extractNextAuthUrl(response, refererUrl);
  if (task) {
    appendLog(task, result.nextUrl ? "info" : "warn", `choose-account form session_id=${sessionId} -> ${result.nextUrl || result.error}`);
  }
  return result;
}

async function restartAuthFromChooseAccount(client: any, task: K12Task | undefined, chooseUrl: string): Promise<string> {
  if (task) appendLog(task, "warn", "choose-account 未匹配到当前邮箱，改走“登录至另一个帐户”重新接码");
  const response = await client.fetch(`${AUTH_BASE_URL}/log-in-or-create-account`, {
    method: "GET",
    redirect: "manual",
    headers: oauthBrowserHeaders(client, {
      referer: chooseUrl,
      "sec-fetch-dest": "document",
      "sec-fetch-mode": "navigate",
      "sec-fetch-site": "same-origin",
    }),
  });
  const location = response.headers.get("location");
  const currentUrl = location ? new URL(location, chooseUrl).toString() : (response.url || `${AUTH_BASE_URL}/log-in-or-create-account`);
  if (currentUrl === `${AUTH_BASE_URL}/log-in-or-create-account` || currentUrl.startsWith(`${AUTH_BASE_URL}/log-in-or-create-account`)) {
    return loginAuthFlowWithEmailOtp(client, task, {allowConsent: true});
  }
  return continueAuthSteps(client, currentUrl, task, {allowConsent: true});
}

async function chooseCurrentAuthAccount(client: any, task?: K12Task, chooseUrl = AUTH_CHOOSE_ACCOUNT_URL): Promise<string> {
  const expectedEmail = task?.email?.trim().toLowerCase() || "";
  const pageResp = await client.fetch(chooseUrl, {
    method: "GET",
    redirect: "manual",
    headers: oauthBrowserHeaders(client, {
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      referer: AUTH_BASE_URL,
      "sec-fetch-dest": "document",
      "sec-fetch-mode": "navigate",
      "sec-fetch-site": "same-origin",
    }),
  });
  const redirected = pageResp.headers.get("location");
  if (redirected) return new URL(redirected, chooseUrl).toString();
  const pageHtml = await pageResp.text().catch(() => "");
  const htmlChoices = parseChooseAccountChoices(pageHtml);
  for (const choice of htmlChoices) {
    if (task) appendLog(task, "info", `choose-account html session_id=${choice.sessionId} email=${choice.email || "(unknown)"}`);
  }

  const sessionCandidates = await getAuthSessionCandidates(client);
  const accountIds = new Set<string>();
  const sessionIds = new Set<string>();
  const userIds = new Set<string>();
  for (const candidate of sessionCandidates) {
    collectIds(candidate, ["account_id", "accountid", "account"], accountIds);
    collectIds(candidate, ["session_id", "sessionid", "id"], sessionIds);
    collectIds(candidate, ["user_id", "userid"], userIds);
  }

  for (const choice of orderChooseAccountChoices(htmlChoices, expectedEmail)) {
    if (expectedEmail && choice.email && choice.email !== expectedEmail) {
      if (task) appendLog(task, "warn", `choose-account 跳过非当前邮箱 session: ${choice.email}`);
      continue;
    }
    const apiResult = await submitChooseAccountPayload(client, {session_id: choice.sessionId}, chooseUrl, task);
    if (apiResult.nextUrl && !apiResult.nextUrl.startsWith(AUTH_CHOOSE_ACCOUNT_URL)) return apiResult.nextUrl;
    const formResult = await submitChooseAccountForm(client, choice.sessionId, chooseUrl, task);
    if (formResult.nextUrl && !formResult.nextUrl.startsWith(AUTH_CHOOSE_ACCOUNT_URL)) return formResult.nextUrl;
  }

  const hasOnlyMismatchedHtmlChoices = expectedEmail
    && htmlChoices.length > 0
    && htmlChoices.every((item) => item.email && item.email !== expectedEmail);
  if (hasOnlyMismatchedHtmlChoices) {
    return restartAuthFromChooseAccount(client, task, chooseUrl);
  }

  const payloads: Record<string, unknown>[] = [{}];
  for (const accountId of accountIds) payloads.push({account_id: accountId});
  for (const sessionId of sessionIds) payloads.push({session_id: sessionId});
  for (const userId of userIds) payloads.push({user_id: userId});
  for (const accountId of accountIds) {
    for (const sessionId of sessionIds) payloads.push({account_id: accountId, session_id: sessionId});
  }
  payloads.push({account_id: "default"}, {session_id: "default"});

  let lastError = "";
  const seen = new Set<string>();

  for (const payload of payloads) {
    const payloadKey = JSON.stringify(payload);
    if (seen.has(payloadKey)) continue;
    seen.add(payloadKey);
    const result = await submitChooseAccountPayload(client, payload, chooseUrl, task);
    if (result.nextUrl && !result.nextUrl.startsWith(AUTH_CHOOSE_ACCOUNT_URL)) return result.nextUrl;
    lastError = result.error || (result.nextUrl ? `仍停在 choose-an-account: ${result.nextUrl}` : "");
  }

  if (expectedEmail) return restartAuthFromChooseAccount(client, task, chooseUrl);
  throw new Error(`choose-an-account 自动选择失败: ${lastError || "unknown"}`);
}

async function followToLocalhostCallback(client: any, startUrl: string, task?: K12Task): Promise<string> {
  let currentUrl = startUrl;
  for (let hop = 0; hop < 12; hop += 1) {
    if (currentUrl.startsWith(DEFAULT_OAUTH_REDIRECT_URI)) return currentUrl;
    if (currentUrl.startsWith(CODEX_CONSENT_URL)) {
      currentUrl = await continueCodexConsent(client, currentUrl, task);
      continue;
    }
    if (isAddPhoneUrl(currentUrl)) {
      throw new Error("登录后触发 add-phone 手机接码页面，按 K12 规则判定失败");
    }
    if (currentUrl.startsWith(AUTH_CHOOSE_ACCOUNT_URL)) {
      currentUrl = await chooseCurrentAuthAccount(client, task, currentUrl);
      continue;
    }
    const response = await client.fetch(currentUrl, {
      method: "GET",
      redirect: "manual",
      headers: oauthBrowserHeaders(client),
    });
    const location = response.headers.get("location");
    if (location) {
      currentUrl = new URL(location, currentUrl).toString();
      if (currentUrl.startsWith(DEFAULT_OAUTH_REDIRECT_URI)) return currentUrl;
      if (isAddPhoneUrl(currentUrl)) {
        throw new Error("登录后触发 add-phone 手机接码页面，按 K12 规则判定失败");
      }
      continue;
    }
    if (response.url?.startsWith(DEFAULT_OAUTH_REDIRECT_URI)) return response.url;
    if (response.url?.startsWith(CODEX_CONSENT_URL)) {
      currentUrl = await continueCodexConsent(client, response.url, task);
      continue;
    }
    if (response.url && isAddPhoneUrl(response.url)) {
      throw new Error("登录后触发 add-phone 手机接码页面，按 K12 规则判定失败");
    }
    if (response.url?.startsWith(AUTH_CHOOSE_ACCOUNT_URL)) {
      currentUrl = await chooseCurrentAuthAccount(client, task, response.url);
      continue;
    }
    throw new Error(`OAuth 跳转未到达 callback: status=${response.status} url=${response.url || currentUrl}`);
  }
  throw new Error(`OAuth 跳转次数过多，最后停在 ${currentUrl}`);
}

async function continueCodexConsent(client: any, consentUrl: string, task?: K12Task): Promise<string> {
  if (task) appendLog(task, "info", "已到 Codex consent 页，优先选择 K12 workspace");
  await client.fetch(consentUrl, {
    method: "GET",
    redirect: "manual",
    headers: oauthBrowserHeaders(client, {
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      referer: AUTH_BASE_URL,
      "sec-fetch-dest": "document",
      "sec-fetch-mode": "navigate",
      "sec-fetch-site": "same-origin",
    }),
  }).catch(() => undefined);

  try {
    const nextUrl = await selectAuthWorkspace(client, task, consentUrl);
    if (nextUrl && !nextUrl.startsWith(CODEX_CONSENT_URL)) return nextUrl;
  } catch (error) {
    if (task) appendLog(task, "warn", `consent workspace/select 不可用，改为直接 Continue: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (task) appendLog(task, "info", "Codex consent fallback：直接点击 Continue");
  const response = await client.fetch(consentUrl, {
    method: "POST",
    redirect: "manual",
    headers: oauthBrowserHeaders(client, {
      "content-type": "application/x-www-form-urlencoded",
      origin: AUTH_BASE_URL,
      referer: consentUrl,
    }),
    body: "consent=true",
  });
  const location = response.headers.get("location");
  if (location) {
    return new URL(location, consentUrl).toString();
  }
  if (response.url?.startsWith(DEFAULT_OAUTH_REDIRECT_URI)) return response.url;
  if (response.status >= 200 && response.status < 300) {
    const text = await response.text().catch(() => "");
    const callbackMatch = text.match(/http:\/\/localhost:1455\/auth\/callback\?[^"' <]+/i);
    if (callbackMatch) return callbackMatch[0].replace(/&amp;/g, "&");
  }
  throw new Error(`Codex consent Continue 未返回 callback/location: HTTP ${response.status}`);
}

async function loginViaSub2ApiAuthorizeUrl(client: any, authorizeUrl: string, task?: K12Task): Promise<string> {
  const openResponse = await client.fetch(authorizeUrl, {
    redirect: "follow",
    headers: oauthBrowserHeaders(client, {
      "accept-encoding": "gzip, deflate, br",
      "sec-fetch-dest": "document",
      "sec-fetch-mode": "navigate",
      "sec-fetch-site": "none",
    }),
  });
  if (!openResponse.ok) {
    throw new Error(`Sub2API OAuth URL 请求失败: HTTP ${openResponse.status}`);
  }
  let currentUrl = openResponse.url || authorizeUrl;
  if (currentUrl.startsWith(DEFAULT_OAUTH_REDIRECT_URI)) return currentUrl;
  if (isAddPhoneUrl(currentUrl)) {
    throw new Error("登录后触发 add-phone 手机接码页面，按 K12 规则判定失败");
  }
  if (currentUrl.startsWith(AUTH_CHOOSE_ACCOUNT_URL)) {
    currentUrl = await chooseCurrentAuthAccount(client, task, currentUrl);
    return followToLocalhostCallback(client, currentUrl, task);
  }

  if (currentUrl === CODEX_CONSENT_URL) {
    currentUrl = await continueCodexConsent(client, currentUrl, task);
    return followToLocalhostCallback(client, currentUrl, task);
  }

  if (currentUrl === `${AUTH_BASE_URL}/log-in`) {
    let continueUrl = await loginAuthFlowWithEmailOtp(client, task, {allowConsent: true});
    return followToLocalhostCallback(client, continueUrl, task);
  }

  if (currentUrl.startsWith(CODEX_CONSENT_URL)) {
    currentUrl = await continueCodexConsent(client, currentUrl, task);
    return followToLocalhostCallback(client, currentUrl, task);
  }

  return followToLocalhostCallback(client, currentUrl, task);
}

async function runK12WorkspaceJoin(client: any, task: K12Task, email: EmailRecord, accessToken: string): Promise<string> {
  if (!task.runWorkspaceJoin) return accessToken;
  if (!accessToken) {
    throw new Error("K12 空间执行需要 AT：请启用 Sub2API OAuth，或先建立 ChatGPT Web session 后从 /api/auth/session 获取 accessToken");
  }
  let latestToken = accessToken;
  for (const workspaceId of task.workspaceIds) {
    if (task.workspaceResults.some((item) => item.workspaceId === workspaceId && item.route === task.route)) continue;
    const result = await sendK12Invite(task, client, latestToken, workspaceId, task.route);
    task.workspaceResults.push(result);
    await persistTasks();
    if (result.ok) {
      await checkK12WorkspaceMembership(client, task, latestToken, workspaceId);
      const switchedToken = await switchToK12WorkspaceAccessToken(client, task, latestToken, workspaceId);
      if (switchedToken !== latestToken) {
        latestToken = switchedToken;
        recordAccessToken(task, email, latestToken);
        await appendTokenOut(latestToken);
      }
    }
    if (task.workspaceIds.length > 1) await sleep(appConfig.joinIntervalMs);
  }
  return latestToken;
}

async function runTask(task: K12Task): Promise<void> {
  const email = emails.find((item) => item.id === task.emailId);
  if (!email) {
    task.status = "failed";
    task.error = "邮箱记录不存在";
    task.finishedAt = nowIso();
    await persistTasks();
    return;
  }
  const blockedReason = exactWorkspaceBlockReason(task.email || email.email, task.workspaceIds);
  if (blockedReason) {
    task.status = "canceled";
    task.error = blockedReason;
    task.finishedAt = nowIso();
    task.updatedAt = nowIso();
    appendLog(task, "warn", `该邮箱当前 workspace 已标记 403 死号，任务跳过: ${blockedReason}`);
    await persistTasks();
    return;
  }
  task.status = "running";
  task.startedAt = nowIso();
  task.updatedAt = nowIso();
  email.status = "running";
  email.lastTaskId = task.id;
  email.lastError = "";
  await Promise.all([persistTasks(), persistEmails()]);

  try {
    process.env.OPENAI_PROXY_URL = appConfig.defaultProxyUrl || "direct";
    process.env.DEFAULT_PROXY_URL = appConfig.defaultProxyUrl || "direct";
    process.env.OPENAI_FETCH_TIMEOUT_MS = String(appConfig.openaiFetchTimeoutMs);
    await ensureSentinelSdk();
    await waitForPoolFissionChildCooldown(task, email);

    const client = await createOpenAIClientForEmail(task, email);
    const useNoRtMode = task.sub2apiNoRtMode === true;

    let accessToken = "";
    let jsonCredentials: Record<string, unknown> | undefined;
    let jsonSource = "gpt-k12";
    if (task.runWorkspaceJoin) {
      accessToken = await loginChatGptWebAndGetAccessToken(client, task, email.email);
      recordAccessToken(task, email, accessToken);
      await appendTokenOut(accessToken);
    }

    if (task.runSub2Api) {
      assertNotCanceled(task);
      if (!appConfig.sub2apiUrl || !appConfig.sub2apiEmail || !appConfig.sub2apiPassword) {
        throw new Error("Sub2API 配置不完整：地址、账号、密码均不能为空");
      }
      if (useNoRtMode) {
        appendLog(task, "info", "Sub2API noRT 模式已开启：跳过 OAuth，先加入/切换 K12，再用 K12 AT 入库");
        if (!accessToken) {
          accessToken = await loginChatGptWebAndGetAccessToken(client, task, email.email);
          recordAccessToken(task, email, accessToken);
          await appendTokenOut(accessToken);
        }
        accessToken = await runK12WorkspaceJoin(client, task, email, accessToken);
        accessToken = await ensureK12AccessTokenForNoRt(client, task, accessToken);
        recordAccessToken(task, email, accessToken);
        await appendTokenOut(accessToken);
        const accountName = await upsertSub2ApiNoRtAccountFromAccessToken(task, email, accessToken);
        task.sub2apiAccount = accountName;
        email.sub2apiAccount = accountName;
        jsonSource = "gpt-k12-nort";
      } else {
        try {
          const {Sub2ApiClient} = await loadBundleModules();
          const groupNames = parseSub2ApiGroupNames(task.sub2apiGroupName || appConfig.sub2apiGroupName);
          const primaryGroupName = groupNames[0] || "k12";
          appendLog(task, "info", `Sub2API OA 授权入库，分组 ${groupNames.join(", ")}${appConfig.sub2apiProxyName ? `，IP管理 ${appConfig.sub2apiProxyName}` : ""}`);
          const sub2api = new Sub2ApiClient({
            url: appConfig.sub2apiUrl,
            email: appConfig.sub2apiEmail,
            password: appConfig.sub2apiPassword,
            groupName: primaryGroupName,
            groupNames,
            proxyName: appConfig.sub2apiProxyName,
            accountPriority: appConfig.sub2apiAccountPriority,
            concurrency: appConfig.sub2apiConcurrency,
          });
          const prepared = await sub2api.prepareOpenAiOAuth();
          appendLog(task, "info", `Sub2API OAuth URL 已生成: ${prepared.groupLabel}`);
          const callbackUrl = await loginViaSub2ApiAuthorizeUrl(client, prepared.oauthUrl, task);
          appendLog(task, "info", "OAuth callback 已获取，交给 Sub2API exchange-code");
          const accountName = sub2ApiOAuthAccountName(email, primaryGroupName, task.workspaceIds);
          const created = await sub2api.exchangeCallbackAndCreateAccount(
            prepared,
            callbackUrl,
            email.email,
            accountName,
            {requireChatgptAccountId: appConfig.requireChatgptAccountId},
          );
          task.sub2apiAccount = created.accountName;
          email.sub2apiAccount = created.accountName;
          jsonCredentials = {
            ...(created.credentials || {}),
            group_ids: prepared.groupIds,
            proxy_id: prepared.proxyId,
          };
          jsonSource = "gpt-k12-oauth";
          appendLog(task, "ok", `Sub2API 账号已创建: ${created.accountName}`);
          if (!accessToken) {
            accessToken = extractAccessTokenFromCredentials(created.credentials || {});
            if (!accessToken) {
              throw new Error("Sub2API OAuth 已完成，但 exchange-code 返回中缺少 access_token");
            }
            recordAccessToken(task, email, accessToken);
            await appendTokenOut(accessToken);
          }
        } catch (error) {
          if (!isAddPhoneFlowError(error)) throw error;
          appendLog(task, "warn", "Sub2API OA 授权触发 add-phone，尝试使用 K12 Web AT 创建 noRT 账号");
          if (!accessToken) {
            accessToken = await loginChatGptWebAndGetAccessToken(client, task, email.email);
            recordAccessToken(task, email, accessToken);
            await appendTokenOut(accessToken);
          }
          accessToken = await ensureK12AccessTokenForNoRt(client, task, accessToken);
          recordAccessToken(task, email, accessToken);
          await appendTokenOut(accessToken);
          const accountName = await createSub2ApiNoRtAccountFromAccessToken(task, email, accessToken);
          task.sub2apiAccount = accountName;
          email.sub2apiAccount = accountName;
          jsonSource = "gpt-k12-add-phone-fallback";
        }
      }
    }

    if (task.runWorkspaceJoin && !useNoRtMode) {
      accessToken = await runK12WorkspaceJoin(client, task, email, accessToken);
    }
    if (accessToken) {
      await tryWriteAccountJsonFile(task, email, accessToken, {
        credentials: jsonCredentials,
        accountName: task.sub2apiAccount || email.sub2apiAccount,
        source: jsonSource,
      });
    }

    assertNotCanceled(task);
    task.status = "success";
    email.status = "success";
    appendLog(task, "ok", "任务完成");
  } catch (error) {
    let message = normalizeFlowError(error);
    if (email.otpMode === "smsbower-mail" && isSmsBowerActivationCanceledMessage(message)) {
      message = smsBowerClosedByRemoteStatusReason(email);
    }
    const userAlreadyExists = isOpenAiUserAlreadyExistsMessage(message);
    task.status = task.cancelRequested ? "canceled" : "failed";
    task.error = message;
    if (isOpenAiWorkspaceAccessDeniedMessage(message)) {
      await blockEmailWorkspace({
        email: task.email || email.email,
        workspaceIds: task.workspaceIds,
        reason: message,
        source: "k12-task",
        accountName: task.sub2apiAccount || email.sub2apiAccount,
      });
      email.status = task.status === "canceled" ? "free" : "failed";
      email.lastError = message;
    } else if (isOpenAiAccountBannedMessage(message)) {
      markEmailBanned(email, message, task);
    } else if (shouldMarkPoolRootUnusableAfterUserAlreadyExists({
      isSmsBowerMail: email.otpMode === "smsbower-mail",
      isChildEmail: Boolean(email.parentEmail),
      userAlreadyExists,
    })) {
      markEmailRegistrationExhausted(email, `OpenAI user_already_exists，邮箱已存在或达到注册上限: ${email.email}`, task);
    } else {
      email.status = task.status === "canceled" ? "free" : "failed";
      email.lastError = message;
    }
    appendLog(task, task.status === "canceled" ? "warn" : "error", message);
  } finally {
    cancelManualEmailOtp(task.id, "任务已结束，手动验证码等待关闭");
    task.finishedAt = nowIso();
    task.updatedAt = nowIso();
    email.updatedAt = nowIso();
    activeWorkers = Math.max(0, activeWorkers - 1);
    await Promise.all([persistTasks(), persistEmails()]);
    await enqueueNextSmsBowerFissionTask(email, task).catch((error) => {
      appendLog(task, "warn", `SMSBower Gmail 裂变子任务创建失败: ${error instanceof Error ? error.message : String(error)}`);
    });
    await enqueueNextPoolFissionTask(email, task).catch((error) => {
      appendLog(task, "warn", `邮箱池裂变子任务创建失败: ${error instanceof Error ? error.message : String(error)}`);
    });
    await finalizeSmsBowerMailIfDone(email).catch((error) => {
      appendLog(task, "warn", `SMSBower 邮箱释放失败: ${error instanceof Error ? error.message : String(error)}`);
    });
    await enqueueReplacementSmsBowerMailTask(email, task).catch((error) => {
      appendLog(task, "warn", `SMSBower 自动换邮箱失败: ${error instanceof Error ? error.message : String(error)}`);
    });
    scheduleTasks();
  }
}

async function runAtRepairTask(task: K12Task): Promise<void> {
  const email = emails.find((item) => item.id === task.emailId);
  if (!email) {
    task.status = "failed";
    task.error = "邮箱记录不存在";
    task.finishedAt = nowIso();
    await persistTasks();
    return;
  }
  if (email.status === "banned") {
    task.status = "failed";
    task.error = "邮箱已标记封号，跳过 AT 修复";
    task.finishedAt = nowIso();
    task.updatedAt = nowIso();
    appendLog(task, "error", task.error);
    await persistTasks();
    return;
  }
  const blockedReason = exactWorkspaceBlockReason(task.email || email.email, task.workspaceIds);
  if (blockedReason) {
    task.status = "canceled";
    task.error = blockedReason;
    task.finishedAt = nowIso();
    task.updatedAt = nowIso();
    appendLog(task, "warn", `该邮箱当前 workspace 已标记 403 死号，AT 修复跳过: ${blockedReason}`);
    await persistTasks();
    return;
  }

  task.status = "running";
  task.startedAt = nowIso();
  task.updatedAt = nowIso();
  email.status = "running";
  email.lastTaskId = task.id;
  email.lastError = "";
  await Promise.all([persistTasks(), persistEmails()]);

  try {
    process.env.OPENAI_PROXY_URL = appConfig.defaultProxyUrl || "direct";
    process.env.DEFAULT_PROXY_URL = appConfig.defaultProxyUrl || "direct";
    process.env.OPENAI_FETCH_TIMEOUT_MS = String(appConfig.openaiFetchTimeoutMs);

    const {origin, token: adminToken} = await loginSub2ApiAdmin();
    const names = expectedSub2ApiAccountNames(email, task.sub2apiGroupName || appConfig.sub2apiGroupName, task.workspaceIds);
    appendLog(task, "info", `按名称查找 Sub2API 账号: ${names.join(" / ")}`);
    const matchedAccounts = await findSub2ApiAccountsByName(origin, adminToken, names);
    const account = matchedAccounts[0];
    if (!account) {
      appendLog(task, "warn", `Sub2API 未找到账号，改为重新获取 K12 AT 后新增账号: ${names.join(" / ")}`);
      const client = await createOpenAIClientForEmail(task, email);
      let newAccessToken = await loginChatGptWebAndGetAccessToken(client, task, email.email);
      newAccessToken = await ensureK12AccessTokenForNoRt(client, task, newAccessToken);
      recordAccessToken(task, email, newAccessToken);
      await appendTokenOut(newAccessToken);
      const createdName = await createSub2ApiNoRtAccountFromAccessToken(task, email, newAccessToken);
      task.sub2apiAccount = createdName;
      email.sub2apiAccount = createdName;
      await tryWriteAccountJsonFile(task, email, newAccessToken, {accountName: createdName, source: "gpt-k12-at-repair-create"});
      assertNotCanceled(task);
      task.status = "success";
      email.status = "success";
      appendLog(task, "ok", `Sub2API 未有旧账号，已新增账号: ${createdName}`);
      return;
    }

    const accountId = sub2ApiAccountId(account);
    const accountName = sub2ApiAccountName(account);
    if (!accountId) throw new Error(`Sub2API 账号缺少 id: ${accountName || "(unknown)"}`);
    task.sub2apiAccount = accountName;
    email.sub2apiAccount = accountName;
    appendLog(task, "info", `已找到 Sub2API 账号: ${accountName}#${accountId}${matchedAccounts.length > 1 ? `，同名账号 ${matchedAccounts.length} 个` : ""}`);

    const credentials = sub2ApiAccountCredentials(account);
    const oldAccessToken = extractAccessTokenFromCredentials(credentials);
    if (oldAccessToken) {
      const local = await testOpenAiAccessToken(oldAccessToken);
      appendLog(task, local.ok ? "ok" : "warn", `当前 AT 在线检验: ${local.message}`);
      if (local.banned) {
        if (isOpenAiWorkspaceAccessDeniedMessage(local.message)) {
          await blockEmailWorkspace({
            email: task.email || email.email,
            workspaceIds: task.workspaceIds,
            reason: local.message,
            source: "at-repair-local-check",
            accountName,
          });
          task.error = "OpenAI 403 workspace access denied，停止 AT 修复";
          appendLog(task, "error", task.error);
        } else {
          markEmailBanned(email, "GPT 账号已被 OpenAI 停用/封禁，停止 AT 修复", task);
        }
        task.status = "failed";
        return;
      }
      if (local.ok) {
        recordAccessToken(task, email, oldAccessToken);
        await tryWriteAccountJsonFile(task, email, oldAccessToken, {
          credentials,
          accountName,
          source: "gpt-k12-at-repair-existing",
        });
        task.status = "success";
        email.status = "success";
        appendLog(task, "ok", "当前 AT 仍可用，无需更新 Sub2API");
        return;
      }
    } else {
      appendLog(task, "warn", "Sub2API 账号缺少 credentials.access_token，准备重新获取");
    }

    const sub2apiTest = await testSub2ApiAccountLiveness(origin, adminToken, accountId);
    appendLog(task, sub2apiTest.ok ? "ok" : "warn", `Sub2API 账号测活: ${sub2apiTest.message}`);
    if (sub2apiTest.banned) {
      await blockEmailWorkspace({
        email: task.email || email.email,
        workspaceIds: task.workspaceIds,
        reason: sub2apiTest.message,
        source: "at-repair-sub2api-check",
        accountName,
      });
      task.error = "OpenAI 403 workspace access denied，停止 AT 修复";
      appendLog(task, "error", task.error);
      task.status = "failed";
      return;
    }
    if (sub2apiTest.ok && oldAccessToken) {
      recordAccessToken(task, email, oldAccessToken);
      await tryWriteAccountJsonFile(task, email, oldAccessToken, {
        credentials,
        accountName,
        source: "gpt-k12-at-repair-sub2api-ok",
      });
      task.status = "success";
      email.status = "success";
      appendLog(task, "ok", "Sub2API 测活通过，无需更新");
      return;
    }

    appendLog(task, "warn", "AT 不可用，开始重新登录获取新 K12 AT");
    const client = await createOpenAIClientForEmail(task, email);
    let newAccessToken = await loginChatGptWebAndGetAccessToken(client, task, email.email);
    newAccessToken = await ensureK12AccessTokenForNoRt(client, task, newAccessToken);
    recordAccessToken(task, email, newAccessToken);
    await appendTokenOut(newAccessToken);

    for (const matchedAccount of matchedAccounts) {
      await updateSub2ApiAccountAccessToken(origin, adminToken, matchedAccount, email, newAccessToken);
    }
    await tryWriteAccountJsonFile(task, email, newAccessToken, {
      credentials,
      accountName,
      source: "gpt-k12-at-repair-updated",
    });
    appendLog(task, "ok", `Sub2API 账号 AT 已更新: ${accountName}#${accountId}${matchedAccounts.length > 1 ? ` 等 ${matchedAccounts.length} 个同名账号` : ""}`);
    task.status = "success";
    email.status = "success";
  } catch (error) {
    const message = normalizeFlowError(error);
    task.status = task.cancelRequested ? "canceled" : "failed";
    task.error = message;
    if (isOpenAiWorkspaceAccessDeniedMessage(message)) {
      await blockEmailWorkspace({
        email: task.email || email.email,
        workspaceIds: task.workspaceIds,
        reason: message,
        source: "at-repair-error",
        accountName: task.sub2apiAccount || email.sub2apiAccount,
      });
      email.status = task.status === "canceled" ? "free" : "failed";
      email.lastError = message;
    } else if (isOpenAiAccountBannedMessage(message)) {
      markEmailBanned(email, message, task);
    } else {
      email.status = task.status === "canceled" ? "free" : "failed";
      email.lastError = message;
    }
    appendLog(task, task.status === "canceled" ? "warn" : "error", message);
  } finally {
    cancelManualEmailOtp(task.id, "任务已结束，手动验证码等待关闭");
    task.finishedAt = nowIso();
    task.updatedAt = nowIso();
    email.updatedAt = nowIso();
    activeWorkers = Math.max(0, activeWorkers - 1);
    await Promise.all([persistTasks(), persistEmails()]);
    scheduleTasks();
  }
}

function taskNotBeforeMs(task: K12Task): number {
  if (!task.notBefore) return 0;
  const value = Date.parse(task.notBefore);
  return Number.isFinite(value) ? value : 0;
}

function taskReadyToRun(task: K12Task, nowMs: number): boolean {
  const notBeforeMs = taskNotBeforeMs(task);
  return !notBeforeMs || notBeforeMs <= nowMs;
}

function armNextTaskScheduleWakeup(nowMs = Date.now()): void {
  if (taskScheduleTimer) {
    clearTimeout(taskScheduleTimer);
    taskScheduleTimer = undefined;
  }
  let nextAt = 0;
  for (const task of tasks) {
    if (task.status !== "queued" || task.cancelRequested) continue;
    const notBeforeMs = taskNotBeforeMs(task);
    if (notBeforeMs <= nowMs) continue;
    nextAt = nextAt ? Math.min(nextAt, notBeforeMs) : notBeforeMs;
  }
  if (!nextAt) return;
  taskScheduleTimer = setTimeout(() => {
    taskScheduleTimer = undefined;
    scheduleTasks();
  }, Math.max(1, nextAt - nowMs));
}

function scheduleTasks(): void {
  const limit = Math.max(1, appConfig.taskConcurrency);
  const nowMs = Date.now();
  for (const task of tasks) {
    if (task.status !== "queued") continue;
    if (!taskReadyToRun(task, nowMs)) continue;
    const email = emails.find((item) => item.id === task.emailId);
    if (email?.status === "banned") {
      task.status = "failed";
      task.error = email.lastError || "邮箱已标记封号，队列任务跳过";
      task.finishedAt = nowIso();
      task.updatedAt = nowIso();
      appendLog(task, "error", task.error);
      continue;
    }
    const blockedReason = email ? exactWorkspaceBlockReason(task.email || email.email, task.workspaceIds) : "";
    if (blockedReason) {
      task.status = "canceled";
      task.error = blockedReason;
      task.finishedAt = nowIso();
      task.updatedAt = nowIso();
      appendLog(task, "warn", `该邮箱当前 workspace 已标记 403 死号，队列任务跳过: ${blockedReason}`);
      continue;
    }
    if (shouldSkipDuplicateQueuedTask({
      taskKind: task.kind || "k12",
      taskStatus: task.status,
      hasPriorSuccess: hasPriorSuccessfulK12Task(task.emailId, task.id, task.workspaceIds),
    })) {
      task.status = "canceled";
      task.error = "该邮箱已有成功任务，跳过重复队列任务";
      task.finishedAt = nowIso();
      task.updatedAt = nowIso();
      appendLog(task, "warn", task.error);
    }
  }
  while (activeWorkers < limit) {
    const activeRoots = new Set(
      tasks
        .filter((item) => item.status === "running")
        .map((item) => rootMailboxIdentityByEmailId(item.emailId)),
    );
    const task = tasks.find((item) => (
      item.status === "queued"
      && !item.cancelRequested
      && taskReadyToRun(item, Date.now())
      && emails.find((email) => email.id === item.emailId)?.status !== "banned"
      && !activeRoots.has(rootMailboxIdentityByEmailId(item.emailId))
    ));
    if (!task) break;
    activeRoots.add(rootMailboxIdentityByEmailId(task.emailId));
    activeWorkers += 1;
    void (task.kind === "at-repair" ? runAtRepairTask(task) : runTask(task));
  }
  armNextTaskScheduleWakeup();
}

function enqueueK12Task(
  email: EmailRecord,
  options: {
    route: K12Route;
    workspaceIds: string[];
    runWorkspaceJoin: boolean;
    runSub2Api: boolean;
    sub2apiNoRtMode: boolean;
    sub2apiGroupName: string;
    fissionRemainingAfterThis?: number;
    smsBowerAutoReplaceOnFailure?: boolean;
    smsBowerReplacementRemaining?: number;
    smsBowerReplacementSourceTaskId?: string;
    smsBowerBatchId?: string;
    smsBowerBatchTargetSuccesses?: number;
    notBefore?: string;
  },
): K12Task {
  const task: K12Task = {
    id: `k12_${Date.now()}_${randomUUID().slice(0, 8)}`,
    kind: "k12",
    emailId: email.id,
    email: email.email,
    status: "queued",
    route: options.route,
    workspaceIds: options.workspaceIds,
    runWorkspaceJoin: options.runWorkspaceJoin,
    runSub2Api: options.runSub2Api,
    sub2apiNoRtMode: options.sub2apiNoRtMode,
    sub2apiGroupName: options.sub2apiGroupName,
    smsBowerFissionRemainingAfterThis: options.fissionRemainingAfterThis,
    smsBowerAutoReplaceOnFailure: options.smsBowerAutoReplaceOnFailure,
    smsBowerReplacementRemaining: options.smsBowerReplacementRemaining,
    smsBowerReplacementSourceTaskId: options.smsBowerReplacementSourceTaskId,
    smsBowerBatchId: options.smsBowerBatchId,
    smsBowerBatchTargetSuccesses: options.smsBowerBatchTargetSuccesses,
    notBefore: options.notBefore,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    workspaceResults: [],
    logs: [],
  };
  tasks.push(task);
  email.status = "running";
  email.lastTaskId = task.id;
  return task;
}

async function enqueueReplacementSmsBowerMailTask(email: EmailRecord, sourceTask: K12Task): Promise<K12Task | undefined> {
  if (sourceTask.smsBowerBatchId) {
    const batchTasks = tasks.filter((item) => item.smsBowerBatchId === sourceTask.smsBowerBatchId);
    const successfulTasks = batchTasks.filter((item) => item.status === "success").length;
    const activeTasks = batchTasks.filter((item) => (
      item.id !== sourceTask.id
      && !item.cancelRequested
      && (item.status === "queued" || item.status === "running")
    )).length;
    if (!shouldEnqueueSmsBowerBatchReplacement({
      targetSuccesses: sourceTask.smsBowerBatchTargetSuccesses,
      successfulTasks,
      activeTasks,
    })) {
      appendLog(sourceTask, "info", `SMSBower 批次 ${sourceTask.smsBowerBatchId.slice(-8)} 已达到或已有足够任务在跑：成功 ${successfulTasks}/${sourceTask.smsBowerBatchTargetSuccesses || 0}，运行/排队 ${activeTasks}`);
      return undefined;
    }
  }

  if (!shouldAutoReplaceSmsBowerMailFailure({
    otpMode: email.otpMode,
    smsBowerMailId: email.smsBowerMailId,
    autoReplace: sourceTask.smsBowerAutoReplaceOnFailure,
    replacementRemaining: sourceTask.smsBowerBatchId ? 1 : sourceTask.smsBowerReplacementRemaining,
    taskStatus: sourceTask.status,
    error: sourceTask.error,
  })) {
    return undefined;
  }

  const remaining = sourceTask.smsBowerBatchId
    ? sourceTask.smsBowerReplacementRemaining
    : Math.max(0, (sourceTask.smsBowerReplacementRemaining || 0) - 1);
  const [replacement] = await createSmsBowerMailRecords(1);
  if (!replacement) return undefined;

  const task = enqueueK12Task(replacement, {
    route: sourceTask.route,
    workspaceIds: sourceTask.workspaceIds,
    runWorkspaceJoin: sourceTask.runWorkspaceJoin,
    runSub2Api: sourceTask.runSub2Api,
    sub2apiNoRtMode: sourceTask.sub2apiNoRtMode === true,
    sub2apiGroupName: sourceTask.sub2apiGroupName || appConfig.sub2apiGroupName || "k12",
    fissionRemainingAfterThis: poolFissionRemainingForNewTask({
      enabled: appConfig.smsBowerGmailFissionEnabled,
      count: appConfig.smsBowerGmailFissionCount,
      isChildEmail: false,
      isSmsBowerMail: true,
      existingRemaining: replacement.smsBowerFissionChildrenRemaining,
    }),
    smsBowerAutoReplaceOnFailure: true,
    smsBowerReplacementRemaining: remaining,
    smsBowerReplacementSourceTaskId: sourceTask.id,
    smsBowerBatchId: sourceTask.smsBowerBatchId,
    smsBowerBatchTargetSuccesses: sourceTask.smsBowerBatchTargetSuccesses,
  });
  const batchSuffix = sourceTask.smsBowerBatchId
    ? `，批次目标 ${sourceTask.smsBowerBatchTargetSuccesses || 0} 个成功`
    : `，剩余自动替换 ${remaining} 次`;
  appendLog(sourceTask, "warn", `SMSBower 邮箱不可用，已自动换下一个: ${replacement.email}${batchSuffix}`);
  appendLog(task, "info", `自动换 SMSBower 邮箱，来源失败任务 ${sourceTask.id}${batchSuffix}`);
  await Promise.all([persistTasks(), persistEmails()]);
  return task;
}

type TaskCreateSkipReason = "missing" | "smsbowerClosed" | "googleSsoUnsupported" | "running" | "banned" | "success" | "active" | "workspaceBlocked";

function addTaskCreateSkipReason(reasons: Partial<Record<TaskCreateSkipReason, number>>, reason: TaskCreateSkipReason, count = 1): void {
  reasons[reason] = (reasons[reason] || 0) + count;
}

async function createTasks(body: Record<string, unknown>): Promise<{
  created: K12Task[];
  skippedRunning: number;
  missing: number;
  skippedReasons: Partial<Record<TaskCreateSkipReason, number>>;
}> {
  const requestedEmailIds = Array.isArray(body.emailIds)
    ? body.emailIds.map((item) => String(item)).filter(Boolean)
    : [];
  const requested = new Set(requestedEmailIds);
  const existingIds = new Set(emails.map((item) => item.id));
  const missing = requestedEmailIds.filter((id) => !existingIds.has(id)).length;
  const skippedReasons: Partial<Record<TaskCreateSkipReason, number>> = {};
  if (missing) addTaskCreateSkipReason(skippedReasons, "missing", missing);
  const dynamicGmailMode = !requestedEmailIds.length && appConfig.smsBowerMailEnabled;
  let selectedEmails = requestedEmailIds.length
    ? emails.filter((item) => requested.has(item.id))
    : emails.filter((item) => shouldAutoSelectEmailForK12Launch({
      emailStatus: item.status,
      isChildEmail: Boolean(item.parentEmail),
    }));
  const defaultLimit = dynamicGmailMode ? 1 : selectedEmails.length || 1;
  const limit = asNumber(body.count, defaultLimit, 1, 500);
  if (dynamicGmailMode) {
    selectedEmails = appConfig.gmailMailProvider === "emailnator"
      ? await createEmailnatorMailRecords(limit)
      : await createSmsBowerMailRecords(limit);
  }
  const workspaceCandidates = uniqueStringList(parseStringList(body.workspaceIds).length ? parseStringList(body.workspaceIds) : appConfig.workspaceIds);
  const route = body.route === "accept" ? "accept" : appConfig.route;
  const runSub2Api = asBoolean(body.runSub2Api, appConfig.runSub2Api);
  const sub2apiNoRtMode = runSub2Api && asBoolean(body.sub2apiNoRtMode, appConfig.sub2apiNoRtMode);
  const runWorkspaceJoin = sub2apiNoRtMode ? true : asBoolean(body.runWorkspaceJoin, appConfig.runWorkspaceJoin);
  const sub2apiGroupName = asString(body.sub2apiGroupName, appConfig.sub2apiGroupName) || "k12";
  const workspaceLaunchMode = normalizeWorkspaceLaunchMode(body.workspaceLaunchMode);
  const created: K12Task[] = [];
  let skippedRunning = 0;
  const smsBowerBatchId = dynamicGmailMode && appConfig.gmailMailProvider === "smsbower"
    ? `smsbatch_${Date.now()}_${randomUUID().slice(0, 8)}`
    : undefined;

  const launchVariantCount = workspaceLaunchMode === "random-one" ? 1 : workspaceTaskVariantsForLaunch({workspaceCandidates, workspaceLaunchMode}).length;
  const totalTaskTarget = selectedEmails.slice(0, limit).length * launchVariantCount;

  for (const email of selectedEmails.slice(0, limit)) {
    const eligibleRandomWorkspaceCandidates = workspaceLaunchMode === "random-one"
      ? workspaceCandidates.filter((workspaceId) => {
        const taskWorkspaceIds = workspaceId ? [workspaceId] : [];
        if (exactWorkspaceBlockReason(email.email, taskWorkspaceIds)) return false;
        return !taskCreationSkipReason({
          emailStatus: email.status,
          hasActiveTask: hasActiveTask(email.id, taskWorkspaceIds),
          hasPriorSuccess: hasPriorSuccessfulK12Task(email.id, "", taskWorkspaceIds),
        });
      })
      : [];
    const workspaceTaskVariants = workspaceLaunchMode === "random-one"
      ? (
        workspaceCandidates.length > 0 && eligibleRandomWorkspaceCandidates.length === 0
          ? []
          : workspaceTaskVariantsForLaunch({
            workspaceCandidates: eligibleRandomWorkspaceCandidates,
            workspaceLaunchMode,
            randomIndex: randomInt(0, Math.max(1, eligibleRandomWorkspaceCandidates.length || 1)),
          })
      )
      : workspaceTaskVariantsForLaunch({workspaceCandidates, workspaceLaunchMode});
    const smsBowerBlockedReason = smsBowerActivationBlockReason(email);
    if (smsBowerBlockedReason) {
      email.status = "failed";
      email.lastError = smsBowerBlockedReason;
      email.updatedAt = nowIso();
      skippedRunning += workspaceTaskVariants.length;
      addTaskCreateSkipReason(skippedReasons, "smsbowerClosed", workspaceTaskVariants.length);
      continue;
    }
    if (email.otpMode === "smsbower-mail" && isGoogleSsoUnsupportedMessage(email.lastError)) {
      email.status = "failed";
      email.updatedAt = nowIso();
      skippedRunning += workspaceTaskVariants.length;
      addTaskCreateSkipReason(skippedReasons, "googleSsoUnsupported", workspaceTaskVariants.length);
      continue;
    }
    if (!workspaceTaskVariants.length) {
      skippedRunning += launchVariantCount;
      addTaskCreateSkipReason(skippedReasons, "active", launchVariantCount);
      continue;
    }
    for (const workspaceId of workspaceTaskVariants) {
      const taskWorkspaceIds = workspaceId ? [workspaceId] : [];
      const blockedReason = exactWorkspaceBlockReason(email.email, taskWorkspaceIds);
      if (blockedReason) {
        skippedRunning += 1;
        addTaskCreateSkipReason(skippedReasons, "workspaceBlocked");
        continue;
      }
      const skipReason = taskCreationSkipReason({
        emailStatus: email.status,
        hasActiveTask: hasActiveTask(email.id, taskWorkspaceIds),
        hasPriorSuccess: hasPriorSuccessfulK12Task(email.id, "", taskWorkspaceIds),
      });
      if (skipReason) {
        skippedRunning += 1;
        addTaskCreateSkipReason(skippedReasons, skipReason);
        continue;
      }
      const task = enqueueK12Task(email, {
        route,
        workspaceIds: taskWorkspaceIds,
        runWorkspaceJoin,
        runSub2Api,
        sub2apiNoRtMode,
        sub2apiGroupName,
        fissionRemainingAfterThis: poolFissionRemainingForNewTask({
          enabled: appConfig.smsBowerGmailFissionEnabled,
          count: appConfig.smsBowerGmailFissionCount,
          isChildEmail: Boolean(email.parentEmail),
          isSmsBowerMail: email.otpMode === "smsbower-mail",
          existingRemaining: email.smsBowerFissionChildrenRemaining,
        }),
        smsBowerAutoReplaceOnFailure: dynamicGmailMode && appConfig.gmailMailProvider === "smsbower",
        smsBowerReplacementRemaining: dynamicGmailMode && appConfig.gmailMailProvider === "smsbower"
          ? DEFAULT_SMSBOWER_AUTO_REPLACEMENT_LIMIT
          : undefined,
        smsBowerBatchId,
        smsBowerBatchTargetSuccesses: smsBowerBatchId ? totalTaskTarget : undefined,
      });
      appendLog(
        task,
        "info",
        `已排队: ${email.email}${workspaceId ? `，workspace=${workspaceId}` : ""}`,
      );
      created.push(task);
    }
  }
  void Promise.all([persistTasks(), persistEmails()]);
  scheduleTasks();
  return {created, skippedRunning, missing, skippedReasons};
}

function createAtRepairTasks(body: Record<string, unknown>): {created: K12Task[]; skippedRunning: number; missing: number; skippedNoAccount: number} {
  const requestedEmailIds = Array.isArray(body.emailIds)
    ? body.emailIds.map((item) => String(item)).filter(Boolean)
    : [];
  const requested = new Set(requestedEmailIds);
  const existingIds = new Set(emails.map((item) => item.id));
  const missing = requestedEmailIds.filter((id) => !existingIds.has(id)).length;
  const selectedEmails = emails.filter((item) => requested.has(item.id));
  const sub2apiGroupName = asString(body.sub2apiGroupName, appConfig.sub2apiGroupName) || "k12";
  const created: K12Task[] = [];
  let skippedRunning = 0;
  let skippedNoAccount = 0;

  for (const email of selectedEmails) {
    if (email.status === "running" || email.status === "banned" || hasActiveTask(email.id)) {
      skippedRunning += 1;
      continue;
    }
    const task: K12Task = {
      id: `at_repair_${Date.now()}_${randomUUID().slice(0, 8)}`,
      kind: "at-repair",
      emailId: email.id,
      email: email.email,
      status: "queued",
      route: appConfig.route,
      workspaceIds: appConfig.workspaceIds,
      runWorkspaceJoin: false,
      runSub2Api: false,
      sub2apiGroupName,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      workspaceResults: [],
      logs: [],
    };
    appendLog(task, "info", `AT 修复已排队: ${email.email}`);
    tasks.push(task);
    email.status = "running";
    email.lastTaskId = task.id;
    email.lastError = "";
    created.push(task);
  }

  void Promise.all([persistTasks(), persistEmails()]);
  scheduleTasks();
  return {created, skippedRunning, missing, skippedNoAccount};
}

function retryTask(source: K12Task): K12Task {
  if (!["failed", "canceled"].includes(source.status)) {
    throw new Error("只能重试失败或已取消的任务");
  }
  const email = emails.find((item) => item.id === source.emailId);
  if (!email) throw new Error("邮箱记录不存在");
  const blockedReason = exactWorkspaceBlockReason(source.email || email.email, source.workspaceIds);
  if (blockedReason) throw new Error(`该邮箱当前 workspace 已标记 403 死号，不能重试: ${blockedReason}`);
  if (hasActiveTask(email.id, source.workspaceIds)) throw new Error("该邮箱当前 workspace 已有任务，不能重复重试");
  if ((source.kind || "k12") === "k12" && hasPriorSuccessfulK12Task(email.id, source.id, source.workspaceIds)) {
    throw new Error("该邮箱当前 workspace 已成功，不需要重试");
  }
  const smsBowerBlockedReason = smsBowerActivationBlockReason(email);
  if (smsBowerBlockedReason) {
    email.status = "failed";
    email.lastError = smsBowerBlockedReason;
    email.updatedAt = nowIso();
    throw new Error(smsBowerBlockedReason);
  }

  const task: K12Task = {
    id: `k12_${Date.now()}_${randomUUID().slice(0, 8)}`,
    kind: source.kind || "k12",
    emailId: source.emailId,
    email: source.email,
    status: "queued",
    route: source.route,
    workspaceIds: source.workspaceIds,
    runWorkspaceJoin: source.runWorkspaceJoin,
    runSub2Api: source.runSub2Api,
    sub2apiNoRtMode: source.sub2apiNoRtMode === true,
    sub2apiGroupName: source.sub2apiGroupName || appConfig.sub2apiGroupName || "k12",
    smsBowerAutoReplaceOnFailure: source.smsBowerAutoReplaceOnFailure,
    smsBowerReplacementRemaining: source.smsBowerReplacementRemaining,
    smsBowerReplacementSourceTaskId: source.smsBowerReplacementSourceTaskId,
    smsBowerBatchId: source.smsBowerBatchId,
    smsBowerBatchTargetSuccesses: source.smsBowerBatchTargetSuccesses,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    workspaceResults: [],
    logs: [],
  };
  appendLog(task, "info", `重试任务，来源: ${source.id}`);
  tasks.push(task);
  email.status = "running";
  email.lastTaskId = task.id;
  email.lastError = "";
  void Promise.all([persistTasks(), persistEmails()]);
  scheduleTasks();
  return task;
}

function retryFailedTasks(): {created: K12Task[]; skipped: number; failed: Array<{taskId: string; email: string; error: string}>} {
  const failedTasks = tasks.filter((task) => task.status === "failed");
  const created: K12Task[] = [];
  const failed: Array<{taskId: string; email: string; error: string}> = [];
  let skipped = 0;

  for (const task of failedTasks) {
    try {
      created.push(retryTask(task));
    } catch (error) {
      skipped += 1;
      failed.push({
        taskId: task.id,
        email: task.email,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {created, skipped, failed};
}

function cancelTaskNow(task: K12Task, reason: string): void {
  const previousStatus = task.status;
  task.cancelRequested = true;
  cancelManualEmailOtp(task.id, "任务已取消，手动验证码等待结束");
  task.waitingOtp = false;
  task.waitingOtpLabel = undefined;
  task.waitingOtpEmail = undefined;
  task.waitingOtpSince = undefined;
  task.status = taskStatusAfterCancelRequest(task.status);
  task.updatedAt = nowIso();
  if (task.status === "canceled" && previousStatus !== "canceled") {
    task.finishedAt = nowIso();
    appendLog(task, "warn", reason);
  } else {
    appendLog(task, "warn", "已请求取消，正在快速停止当前任务");
  }
}

function cancelActiveTasks(reason = "一键停止，任务已取消"): {canceled: number} {
  let canceled = 0;
  for (const task of tasks) {
    if (!shouldCancelActiveTaskStatus(task.status)) continue;
    cancelTaskNow(task, reason);
    canceled += 1;
  }
  return {canceled};
}

function clearFailedTasks(): {removed: number} {
  const failedTasks = tasks.filter((task) => task.status === "failed");
  if (!failedTasks.length) return {removed: 0};
  const removedIds = new Set(failedTasks.map((task) => task.id));
  tasks = tasks.filter((task) => !removedIds.has(task.id));
  for (const email of emails) {
    if (email.lastTaskId && removedIds.has(email.lastTaskId)) {
      delete email.lastTaskId;
      email.updatedAt = nowIso();
    }
  }
  return {removed: removedIds.size};
}

function publicTask(task: K12Task): Record<string, unknown> {
  const email = emails.find((item) => item.id === task.emailId);
  const rootEmail = email ? rootMailboxIdentity(email) : task.email.toLowerCase();
  const workspaceBlockReason = exactWorkspaceBlockReason(task.email || email?.email || rootEmail, task.workspaceIds);
  return {
    ...task,
    parentEmail: email?.parentEmail,
    rootEmail,
    otpMode: email?.otpMode || "auto",
    workspaceBlocked: Boolean(workspaceBlockReason),
    workspaceBlockReason: workspaceBlockReason || undefined,
    smsBowerMailRoot: email?.smsBowerMailRoot,
    smsBowerFissionChildrenRemaining: email?.smsBowerFissionChildrenRemaining,
    smsBowerFissionParentEmailId: email?.smsBowerFissionParentEmailId,
    logs: task.logs.slice(-240),
  };
}

function summary(): Record<string, unknown> {
  const countByStatus = (items: Array<{status: string}>, status: string) => items.filter((item) => item.status === status).length;
  return {
    emails: {
      total: emails.length,
      free: countByStatus(emails, "free"),
      running: countByStatus(emails, "running"),
      success: countByStatus(emails, "success"),
      failed: countByStatus(emails, "failed"),
      banned: countByStatus(emails, "banned"),
    },
    tasks: {
      total: tasks.length,
      queued: countByStatus(tasks, "queued"),
      running: countByStatus(tasks, "running"),
      success: countByStatus(tasks, "success"),
      failed: countByStatus(tasks, "failed"),
      canceled: countByStatus(tasks, "canceled"),
    },
    config: publicConfig(),
  };
}

function reconcileEmailStatusesFromTasks(): boolean {
  let changed = restoreWorkspaceAccessDeniedEmailStatuses();
  for (const email of emails) {
    if (email.status === "banned") continue;
    if (email.otpMode === "smsbower-mail" && isGoogleSsoUnsupportedMessage(email.lastError)) {
      const nextError = googleSsoUnsupportedReason();
      if (email.lastError !== nextError) {
        email.lastError = nextError;
        changed = true;
      }
    }
    const related = tasks
      .filter((task) => task.emailId === email.id)
      .sort((a, b) => String(b.finishedAt || b.updatedAt || b.createdAt).localeCompare(String(a.finishedAt || a.updatedAt || a.createdAt)));
    const latestActive = related.find((task) => task.status === "queued" || task.status === "running");
    if (latestActive) {
      if (email.status !== "running") {
        email.status = "running";
        changed = true;
      }
      if (email.lastTaskId !== latestActive.id) {
        email.lastTaskId = latestActive.id;
        changed = true;
      }
      continue;
    }

    const latestSuccess = related.find((task) => task.status === "success");
    if (latestSuccess) {
      if (email.status !== "success") {
        email.status = "success";
        changed = true;
      }
      if (email.lastTaskId !== latestSuccess.id) {
        email.lastTaskId = latestSuccess.id;
        changed = true;
      }
      if (!email.sub2apiAccount && latestSuccess.sub2apiAccount) {
        email.sub2apiAccount = latestSuccess.sub2apiAccount;
        changed = true;
      }
      if (email.lastError) {
        email.lastError = "";
        changed = true;
      }
      continue;
    }

    const latestFailed = related.find((task) => task.status === "failed");
    if (latestFailed) {
      if (email.status !== "failed" && !email.sub2apiAccount) {
        email.status = "failed";
        changed = true;
      }
      if (email.lastTaskId !== latestFailed.id) {
        email.lastTaskId = latestFailed.id;
        changed = true;
      }
      const rawError = latestFailed.error || email.lastError || "";
      const nextError = isSmsBowerActivationCanceledMessage(rawError) && email.otpMode === "smsbower-mail"
        ? smsBowerClosedByRemoteStatusReason(email)
        : rawError;
      if (email.lastError !== nextError) {
        email.lastError = nextError;
        changed = true;
      }
      continue;
    }

    if (email.status === "running") {
      email.status = "free";
      delete email.lastTaskId;
      email.lastError = "";
      changed = true;
    }
  }
  return changed;
}

async function reconcileAndPersistEmailStatuses(): Promise<boolean> {
  const seededBlocks = seedWorkspaceBlocksFromAccessDeniedTasks();
  const changed = reconcileEmailStatusesFromTasks();
  await Promise.all([
    seededBlocks ? persistWorkspaceBlocks() : Promise.resolve(),
    changed ? persistEmails() : Promise.resolve(),
  ]);
  return seededBlocks || changed;
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > 50 * 1024 * 1024) throw new Error("request body too large");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const raw = await readBody(req);
  if (!raw.trim()) return {};
  return JSON.parse(raw) as Record<string, unknown>;
}

function sendJson(res: ServerResponse, status: number, data: unknown): void {
  const body = `${JSON.stringify(data, null, 2)}\n`;
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(body);
}

function sendJsonDownload(res: ServerResponse, data: unknown, filename: string): void {
  const safeFilename = filename.replace(/[^\w.-]+/g, "_");
  const body = `${JSON.stringify(data, null, 2)}\n`;
  res.writeHead(200, {
    "content-type": "application/json; charset=utf-8",
    "content-disposition": `attachment; filename="${safeFilename}"`,
    "cache-control": "no-store",
  });
  res.end(body);
}

function sendText(res: ServerResponse, status: number, body: string, contentType: string): void {
  res.writeHead(status, {"content-type": contentType});
  res.end(body);
}

function sendBuffer(res: ServerResponse, status: number, body: Buffer, contentType: string): void {
  res.writeHead(status, {"content-type": contentType});
  res.end(body);
}

async function serveStatic(url: URL, res: ServerResponse): Promise<boolean> {
  const distDir = path.join(rootDir, "dist");
  const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = path.normalize(path.join(distDir, pathname));
  if (!filePath.startsWith(distDir) || !existsSync(filePath)) return false;
  const info = await stat(filePath);
  if (!info.isFile()) return false;
  const ext = path.extname(filePath).toLowerCase();
  const contentType = ({
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".svg": "image/svg+xml; charset=utf-8",
    ".webp": "image/webp",
    ".ico": "image/x-icon",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
  } as Record<string, string>)[ext] || "application/octet-stream";
  sendBuffer(res, 200, await readFile(filePath), contentType);
  return true;
}

async function handleApi(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const method = req.method || "GET";
  const pathname = url.pathname;

  if (method === "GET" && pathname === "/api/health") {
    await reconcileAndPersistEmailStatuses();
    sendJson(res, 200, {ok: true, rootDir, dataDir, summary: summary()});
    return;
  }

  if (method === "GET" && pathname === "/api/summary") {
    await reconcileAndPersistEmailStatuses();
    sendJson(res, 200, {...summary(), sub2apiRefill: sub2ApiRefillStatus()});
    return;
  }

  if (method === "GET" && pathname === "/api/smsbower/account") {
    sendJson(res, 200, await getSmsBowerAccountSnapshot());
    return;
  }

  if (method === "GET" && pathname === "/api/sub2api/refill/status") {
    sendJson(res, 200, sub2ApiRefillStatus());
    return;
  }

  if (method === "GET" && pathname === "/api/sub2api/refill/history") {
    const limit = asNumber(url.searchParams.get("limit"), 100, 1, 200);
    sendJson(res, 200, {items: sub2apiRefillHistory.slice(0, limit), count: sub2apiRefillHistory.length});
    return;
  }

  if (method === "POST" && pathname === "/api/sub2api/refill/start") {
    try {
      const result = await runSub2ApiRefill("manual");
      sendJson(res, 200, {result, status: sub2ApiRefillStatus(), summary: summary()});
    } catch (error) {
      sendJson(res, 409, {error: error instanceof Error ? error.message : String(error), status: sub2ApiRefillStatus()});
    }
    return;
  }

  if (method === "POST" && pathname === "/api/sub2api/auto-at-repair/start") {
    try {
      const result = await runSub2ApiAutoAtRepair("manual");
      sendJson(res, 200, {result, status: sub2ApiRefillStatus(), summary: summary()});
    } catch (error) {
      sendJson(res, 409, {error: error instanceof Error ? error.message : String(error), status: sub2ApiRefillStatus()});
    }
    return;
  }

  if (method === "POST" && pathname === "/api/emails/reconcile") {
    const changed = await reconcileAndPersistEmailStatuses();
    sendJson(res, 200, {changed, summary: summary()});
    return;
  }

  if (method === "GET" && pathname === "/api/data/export") {
    sendJsonDownload(res, await buildDataExport(), `gpt-k12-data-${new Date().toISOString().slice(0, 10)}.json`);
    return;
  }

  if (method === "POST" && pathname === "/api/data/import") {
    try {
      const body = await readJsonBody(req);
      const result = await importDataBundle(body);
      sendJson(res, 200, {...result, summary: summary()});
    } catch (error) {
      sendJson(res, 409, {error: error instanceof Error ? error.message : String(error)});
    }
    return;
  }

  if (method === "GET" && pathname === "/api/config") {
    sendJson(res, 200, {config: publicConfig()});
    return;
  }

  if ((method === "PATCH" || method === "POST") && pathname === "/api/config") {
    const body = await readJsonBody(req);
    const nextSub2ApiPassword = asString(body.sub2apiPassword);
    const merged = normalizeConfig({
      ...appConfig,
      ...body,
      defaultPassword: asString(body.defaultPassword) || appConfig.defaultPassword,
      sub2apiPassword: nextSub2ApiPassword || appConfig.sub2apiPassword,
      smsBowerApiKey: asString(body.smsBowerApiKey) || appConfig.smsBowerApiKey,
    });
    try {
      await validateSub2ApiPasswordPatch({
        currentPassword: appConfig.sub2apiPassword,
        nextPassword: nextSub2ApiPassword,
        nextUrl: merged.sub2apiUrl,
        nextEmail: merged.sub2apiEmail,
        authenticate: async (url, email, password) => {
          await loginSub2ApiAdminWithCredentials(url, email, password, {force: true});
        },
      });
    } catch (error) {
      sendJson(res, 409, {error: error instanceof Error ? error.message : String(error), config: publicConfig()});
      return;
    }
    await saveConfig(merged);
    const canceledStaleWorkspaceTasks = cancelTasksOutsideConfiguredWorkspaces("workspace 已从配置删除，任务已取消", merged.workspaceIds);
    if (canceledStaleWorkspaceTasks) await persistTasks();
    sendJson(res, 200, {config: publicConfig(), canceledStaleWorkspaceTasks});
    return;
  }

  if (method === "GET" && pathname === "/api/emails") {
    await normalizeAndPersistPoolUserAlreadyExistsCooldownRecords();
    await reconcileAndPersistEmailStatuses();
    sendJson(res, 200, {items: emails.map(publicEmail), count: emails.length});
    return;
  }

  if (method === "POST" && pathname === "/api/emails/import") {
    const body = await readJsonBody(req);
    if (asString(body.mailApiBaseUrl)) {
      await saveConfig(normalizeConfig({...appConfig, mailApiBaseUrl: asString(body.mailApiBaseUrl)}));
    }
    const otpMode: EmailOtpMode = body.otpMode === "manual" ? "manual" : "auto";
    const result = await importEmails(String(body.text || ""), appConfig, {otpMode});
    sendJson(res, 200, result);
    return;
  }

  if (method === "POST" && pathname === "/api/emails/delete") {
    const body = await readJsonBody(req);
    let ids = Array.isArray(body.ids) ? body.ids.map((item) => String(item)).filter(Boolean) : [];
    const status = asString(body.status);
    if (status) {
      const allowed = new Set(["free", "failed", "success", "banned"]);
      if (!allowed.has(status)) {
        sendJson(res, 400, {error: "status 只能是 free、failed、success 或 banned"});
        return;
      }
      ids = emails.filter((item) => item.status === status).map((item) => item.id);
    }
    const result = removeEmails(ids);
    await Promise.all([persistEmails(), result.removedTasks ? persistTasks() : Promise.resolve()]);
    sendJson(res, 200, result);
    return;
  }

  if (method === "POST" && pathname === "/api/emails/split") {
    const body = await readJsonBody(req);
    const ids = Array.isArray(body.ids) ? body.ids.map((item) => String(item)).filter(Boolean) : [];
    const count = asNumber(body.count, 4, 1, 50);
    if (!ids.length) {
      sendJson(res, 400, {error: "请选择至少一个母邮箱"});
      return;
    }
    const result = splitEmails(ids, count);
    await persistEmails();
    sendJson(res, 200, {...result, total: emails.length});
    return;
  }

  if (method === "POST" && pathname === "/api/emails/check-at") {
    const body = await readJsonBody(req);
    try {
      const result = await checkSub2ApiAccessTokens(body);
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, 500, {error: error instanceof Error ? error.message : String(error)});
    }
    return;
  }

  if (method === "DELETE" && pathname.startsWith("/api/emails/")) {
    const id = decodeURIComponent(pathname.split("/").pop() || "");
    const result = removeEmails([id]);
    await Promise.all([persistEmails(), result.removedTasks ? persistTasks() : Promise.resolve()]);
    sendJson(res, 200, result);
    return;
  }

  if (method === "GET" && pathname === "/api/tasks") {
    await reconcileAndPersistEmailStatuses();
    await normalizeAndPersistPoolUserAlreadyExistsCooldownRecords();
    if (await hydrateTaskAccessTokensFromTokenOut()) await persistTasks();
    const pruned = pruneTasksWithoutEmailRecords(emails, tasks);
    if (pruned.removedTasks) {
      tasks = pruned.tasks;
      await persistTasks();
    }
    sendJson(res, 200, {
      items: tasks.map(publicTask).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))),
      count: tasks.length,
      workspaceBlocks,
    });
    return;
  }

  if (method === "POST" && pathname === "/api/tasks") {
    const body = await readJsonBody(req);
    if (body.concurrency !== undefined) {
      await saveConfig(normalizeConfig({...appConfig, taskConcurrency: asNumber(body.concurrency, appConfig.taskConcurrency, 1, 10)}));
    }
    const result = await createTasks(body);
    sendJson(res, 201, {
      tasks: result.created.map(publicTask),
      skippedRunning: result.skippedRunning,
      missing: result.missing,
      skippedReasons: result.skippedReasons,
      smsBowerMailEnabled: appConfig.smsBowerMailEnabled,
      gmailMailProvider: appConfig.gmailMailProvider,
    });
    return;
  }

  if (method === "POST" && pathname === "/api/tasks/repair-at") {
    const body = await readJsonBody(req);
    const result = createAtRepairTasks(body);
    sendJson(res, 201, {
      tasks: result.created.map(publicTask),
      skippedRunning: result.skippedRunning,
      missing: result.missing,
      skippedNoAccount: result.skippedNoAccount,
    });
    return;
  }

  if (method === "POST" && pathname === "/api/tasks/check-at") {
    const body = await readJsonBody(req);
    try {
      const result = await checkTaskAccessTokens(body);
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, 500, {error: error instanceof Error ? error.message : String(error)});
    }
    return;
  }

  if (method === "POST" && pathname === "/api/tasks/clear-failed") {
    const result = clearFailedTasks();
    await Promise.all([persistTasks(), persistEmails()]);
    sendJson(res, 200, result);
    return;
  }

  if (method === "POST" && pathname === "/api/tasks/retry-failed") {
    const result = retryFailedTasks();
    await Promise.all([persistTasks(), persistEmails()]);
    scheduleTasks();
    sendJson(res, 201, {
      created: result.created.map(publicTask),
      count: result.created.length,
      skipped: result.skipped,
      failed: result.failed,
    });
    return;
  }

  if (method === "POST" && pathname === "/api/tasks/cancel-active") {
    const result = cancelActiveTasks();
    await persistTasks();
    sendJson(res, 200, result);
    return;
  }

  if (method === "POST" && pathname === "/api/tasks/fission-top-up") {
    try {
      const body = await readJsonBody(req);
      const result = await createFissionTopUpTask(body);
      await Promise.all([persistTasks(), persistEmails()]);
      scheduleTasks();
      sendJson(res, 201, {
        ...result,
        created: result.created.map(publicTask),
      });
    } catch (error) {
      sendJson(res, 409, {error: error instanceof Error ? error.message : String(error)});
    }
    return;
  }

  const taskMatch = pathname.match(/^\/api\/tasks\/([^/]+)(?:\/(cancel|retry|check-at|otp))?$/);
  if (taskMatch) {
    const task = tasks.find((item) => item.id === decodeURIComponent(taskMatch[1]));
    if (!task) {
      sendJson(res, 404, {error: "task not found"});
      return;
    }
    if (method === "POST" && taskMatch[2] === "cancel") {
      cancelTaskNow(task, "任务已取消");
      await persistTasks();
      sendJson(res, 200, {task: publicTask(task)});
      return;
    }
    if (method === "POST" && taskMatch[2] === "otp") {
      try {
        const body = await readJsonBody(req);
        const result = submitManualEmailOtp(task.id, asString(body.code));
        sendJson(res, 200, {task: publicTask(task), ...result});
      } catch (error) {
        sendJson(res, 409, {error: error instanceof Error ? error.message : String(error)});
      }
      return;
    }
    if (method === "POST" && taskMatch[2] === "retry") {
      try {
        const created = retryTask(task);
        sendJson(res, 201, {task: publicTask(created)});
      } catch (error) {
        sendJson(res, 409, {error: error instanceof Error ? error.message : String(error)});
      }
      return;
    }
    if (method === "POST" && taskMatch[2] === "check-at") {
      try {
        const result = await checkTaskAccessToken(task);
        sendJson(res, 200, result);
      } catch (error) {
        sendJson(res, 409, {error: error instanceof Error ? error.message : String(error)});
      }
      return;
    }
    if (method === "DELETE" && !taskMatch[2]) {
      if (!["failed", "canceled"].includes(task.status)) {
        sendJson(res, 409, {error: "只能删除失败或已取消的任务"});
        return;
      }
      tasks = tasks.filter((item) => item.id !== task.id);
      const email = emails.find((item) => item.id === task.emailId);
      if (email?.lastTaskId === task.id) {
        delete email.lastTaskId;
        email.updatedAt = nowIso();
      }
      await Promise.all([persistTasks(), persistEmails()]);
      sendJson(res, 200, {removed: 1});
      return;
    }
    if (method === "GET" && !taskMatch[2]) {
      sendJson(res, 200, {task: publicTask(task)});
      return;
    }
  }

  sendJson(res, 404, {error: "not found"});
}

async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
      return;
    }
    if (await serveStatic(url, res)) return;
    sendJson(res, 404, {error: "not found"});
  } catch (error) {
    sendJson(res, 500, {error: error instanceof Error ? error.message : String(error)});
  }
}

async function boot(): Promise<void> {
  await mkdir(dataDir, {recursive: true});
  appConfig = await loadConfig();
  await saveConfig(appConfig);
  await ensureSentinelSdk();
  emails = await readJson<EmailRecord[]>(emailsFile, []);
  tasks = await readJson<K12Task[]>(tasksFile, []);
  workspaceBlocks = (await readJson<WorkspaceBlockRecord[]>(workspaceBlocksFile, []))
    .filter((item) => item && typeof item === "object" && asString(item.rootEmail) && asString(item.workspaceId));
  sub2apiRefillHistory = (await readJson<Sub2ApiRefillHistoryEntry[]>(sub2apiRefillHistoryFile, []))
    .filter((item) => item && typeof item === "object" && asString(item.id) && asString(item.checkedAt))
    .slice(0, 200);
  for (const task of tasks) {
    if (shouldFailTaskAfterServerRestart(task.status)) {
      task.status = "failed";
      task.error = "server restarted before task finished";
      task.finishedAt = nowIso();
      task.waitingOtp = false;
      task.waitingOtpLabel = undefined;
      task.waitingOtpEmail = undefined;
      task.waitingOtpSince = undefined;
      appendLog(task, "warn", "服务重启，未完成任务已标记失败");
    }
  }
  cancelTasksOutsideConfiguredWorkspaces("workspace 已从配置删除，任务已取消");
  await hydrateTaskAccessTokensFromTokenOut();
  await normalizeAndPersistPoolUserAlreadyExistsCooldownRecords();
  await persistTasks();
  await reconcileAndPersistEmailStatuses();

  createServer((req, res) => {
    void handler(req, res);
  }).listen(appConfig.port, "0.0.0.0", () => {
    console.log(`K12 console API listening: http://127.0.0.1:${appConfig.port}/`);
    scheduleTasks();
  });
}

void boot();
