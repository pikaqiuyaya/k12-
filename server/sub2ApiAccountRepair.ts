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

export function sub2ApiK12StatusErrorReason(input: Sub2ApiK12StatusInput): string | undefined {
  if (!isK12AccountContext(input)) return undefined;

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

export function sub2ApiAccountEmailCandidatesFromName(name: string): string[] {
  const found = new Set<string>();
  const pattern = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
  for (const match of String(name || "").matchAll(pattern)) {
    const email = match[0].trim().toLowerCase();
    if (email) found.add(email);
  }
  return [...found];
}

export function shouldCreateAutoAtRepairTask(input: {
  issue?: string;
  matchedLocalEmail: boolean;
  emailStatus?: EmailStatus | string;
  hasActiveTask: boolean;
}): boolean {
  if (!isAutoAtRepairIssue(input.issue)) return false;
  if (!input.matchedLocalEmail) return false;
  if (input.hasActiveTask) return false;
  const status = String(input.emailStatus || "").toLowerCase();
  return status !== "running" && status !== "banned";
}

export function isAutoAtRepairIssue(issue?: string): boolean {
  return issue === SUB2API_K12_STATUS_ERROR_ISSUE;
}
