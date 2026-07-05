import {isOpenAiWorkspaceAccessDeniedMessage} from "./accessTokenLiveness";

export const K12_PLAN_MISMATCH_ISSUE = "k12-plan-mismatch";
export const SUB2API_K12_STATUS_ERROR_ISSUE = "sub2api-k12-status-error";

export type K12RepairIssue = typeof K12_PLAN_MISMATCH_ISSUE | typeof SUB2API_K12_STATUS_ERROR_ISSUE;
type EmailStatus = "free" | "running" | "success" | "failed" | "banned";

export interface Sub2ApiK12StatusInput {
  planType?: string;
  accountId?: string;
  workspaceIds: string[];
  status?: string;
  state?: string;
  accountStatus?: string;
  disabled?: boolean;
  isDisabled?: boolean;
  paused?: boolean;
  isPaused?: boolean;
  deleted?: boolean;
  isDeleted?: boolean;
  banned?: boolean;
  isBanned?: boolean;
  expired?: boolean;
  isExpired?: boolean;
  enabled?: boolean;
  isEnabled?: boolean;
  active?: boolean;
  isActive?: boolean;
  deletedAt?: string;
  message?: unknown;
  error?: unknown;
  errorMessage?: unknown;
  lastError?: unknown;
  detail?: unknown;
  reason?: unknown;
  metadata?: unknown;
}

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

export function isK12AccountContext(input: Pick<Sub2ApiK12StatusInput, "planType" | "accountId" | "workspaceIds">): boolean {
  const plan = String(input.planType || "").trim().toLowerCase();
  const accountId = String(input.accountId || "").trim().toLowerCase();
  const targetIds = new Set(input.workspaceIds.map((item) => item.trim().toLowerCase()).filter(Boolean));
  return plan === "k12" || Boolean(accountId && targetIds.has(accountId));
}

function statusMessageText(input: Sub2ApiK12StatusInput): string {
  const values = [
    input.status,
    input.state,
    input.accountStatus,
    input.message,
    input.error,
    input.errorMessage,
    input.lastError,
    input.detail,
    input.reason,
    input.metadata,
  ];
  return values
    .map((value) => {
      if (value === undefined || value === null) return "";
      if (typeof value === "string") return value;
      try {
        return JSON.stringify(value);
      } catch {
        return String(value);
      }
    })
    .filter(Boolean)
    .join("\n");
}

export function isTerminalK12AccessDeniedMessage(value: unknown): boolean {
  return isOpenAiWorkspaceAccessDeniedMessage(value);
}

export function sub2ApiK12StatusErrorReason(input: Sub2ApiK12StatusInput): string | undefined {
  if (!isK12AccountContext(input)) return undefined;

  const detailText = statusMessageText(input);
  if (isTerminalK12AccessDeniedMessage(detailText)) {
    return `Sub2API K12账号被工作区拒绝访问(403): ${detailText.slice(0, 240)}`;
  }

  const status = String(input.status || input.state || input.accountStatus || "").trim().toLowerCase();
  if (status && unhealthyStatuses.has(status)) {
    return `Sub2API K12账号状态错误: status=${status}`;
  }

  const disabledFlags = [
    ["disabled", input.disabled],
    ["is_disabled", input.isDisabled],
    ["paused", input.paused],
    ["is_paused", input.isPaused],
    ["deleted", input.deleted],
    ["is_deleted", input.isDeleted],
    ["banned", input.banned],
    ["is_banned", input.isBanned],
    ["expired", input.expired],
    ["is_expired", input.isExpired],
  ] as const;
  for (const [key, value] of disabledFlags) {
    if (value === true) return `Sub2API K12账号状态错误: ${key}=true`;
  }

  const enabledFlags = [
    ["enabled", input.enabled],
    ["is_enabled", input.isEnabled],
    ["active", input.active],
    ["is_active", input.isActive],
  ] as const;
  for (const [key, value] of enabledFlags) {
    if (value === false) return `Sub2API K12账号状态错误: ${key}=false`;
  }

  if (input.deletedAt) return "Sub2API K12账号状态错误: deleted_at 已设置";
  return undefined;
}

export function sub2ApiK12LivenessIssue(input: {
  planMismatch?: string;
  liveness: {ok: boolean; status: number; message: string; latencyMs?: number; banned?: boolean};
}): {issue: typeof SUB2API_K12_STATUS_ERROR_ISSUE; message: string; repairable: boolean} | null {
  if (input.planMismatch) return null;
  if (input.liveness.ok) return null;
  if (!isTerminalK12AccessDeniedMessage(input.liveness.message)) {
    const message = String(input.liveness.message || "");
    if (input.liveness.status !== 401 && !/token\s+revoked|invalidated\s+oauth\s+token|invalid[_ -]?token|token.*expired|unauthorized/i.test(message)) {
      return null;
    }
    return {
      issue: SUB2API_K12_STATUS_ERROR_ISSUE,
      message: `Sub2API K12 account liveness needs AT repair (401): ${message.slice(0, 240)}`,
      repairable: true,
    };
  }
  return {
    issue: SUB2API_K12_STATUS_ERROR_ISSUE,
    message: `Sub2API K12账号实时测活被工作区拒绝访问(403): ${input.liveness.message.slice(0, 240)}`,
    repairable: false,
  };
}

export function sub2ApiAccountEmailCandidatesFromName(name: string): string[] {
  const found = new Set<string>();
  const pattern = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
  for (const match of String(name || "").matchAll(pattern)) {
    const email = match[0].trim().toLowerCase();
    if (email) found.add(email);
  }
  return [...found];
}

export function sub2ApiAccountNameMatchesGroupScope(accountName: string, groupName: string): boolean {
  const name = String(accountName || "").trim().toLowerCase();
  const group = String(groupName || "").trim().toLowerCase();
  if (!name || !group) return false;
  return name.endsWith(`---${group}`)
    || name.includes(`---${group}--ws-`)
    || name.endsWith("--nort")
    || name.includes("--nort--ws-");
}

export function workspaceIdsFromSub2ApiAccountName(name: string): string[] {
  const found = new Set<string>();
  const pattern = /--ws-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi;
  for (const match of String(name || "").matchAll(pattern)) {
    found.add(match[1].toLowerCase());
  }
  return [...found];
}

export function workspaceIdsForAtRepairTask(input: {sub2apiAccount?: string; workspaceIds?: string[]}): string[] {
  const byAccountName = workspaceIdsFromSub2ApiAccountName(input.sub2apiAccount || "");
  if (byAccountName.length) return byAccountName;
  return Array.from(new Set((input.workspaceIds || []).map((item) => String(item || "").trim()).filter(Boolean)));
}

export function shouldCreateAutoAtRepairTask(input: {
  issue?: string;
  repairable?: boolean;
  matchedLocalEmail: boolean;
  emailStatus?: EmailStatus | string;
  hasActiveTask: boolean;
  message?: unknown;
}): boolean {
  if (!isAutoAtRepairIssue(input.issue)) return false;
  if (input.repairable === false) return false;
  if (isTerminalK12AccessDeniedMessage(input.message)) return false;
  if (!input.matchedLocalEmail) return false;
  if (input.hasActiveTask) return false;
  const status = String(input.emailStatus || "").toLowerCase();
  return status !== "banned";
}

export function isAutoAtRepairIssue(issue?: string): boolean {
  return issue === SUB2API_K12_STATUS_ERROR_ISSUE;
}

export function sub2ApiResumeSchedulingBody(): Record<string, unknown> {
  return {
    status: "active",
    enabled: true,
    active: true,
    disabled: false,
    paused: false,
    is_disabled: false,
    is_paused: false,
  };
}

export function sub2ApiResumeSchedulingRequests(accountId: string): Array<{method: "DELETE" | "POST" | "PUT"; path: string; body?: Record<string, unknown>}> {
  const encodedId = encodeURIComponent(accountId);
  return [
    {
      method: "DELETE",
      path: `/api/v1/admin/accounts/${encodedId}/temp-unschedulable`,
    },
    {
      method: "POST",
      path: `/api/v1/admin/accounts/${encodedId}/schedulable`,
      body: {schedulable: true},
    },
    {
      method: "PUT",
      path: `/api/v1/admin/accounts/${encodedId}`,
      body: sub2ApiResumeSchedulingBody(),
    },
  ];
}
