export interface AccessTokenLivenessResult {
  ok: boolean;
  status: number;
  message: string;
  latencyMs: number;
  banned?: boolean;
}

export function isOpenAiWorkspaceAccessDeniedMessage(value: unknown): boolean {
  const message = value instanceof Error ? value.message : String(value || "");
  return /codex_workspace_access_denied|workspace\s+access\s+denied|workspace administrator for access|contact your chatgpt workspace administrator/i.test(message);
}

export function shouldTrySub2LivenessAfterDirectFailure(result: AccessTokenLivenessResult): boolean {
  return !result.ok && !result.banned && result.status === 401;
}

export function combineDirectAndSub2Liveness(
  direct: AccessTokenLivenessResult,
  sub2api: AccessTokenLivenessResult,
): AccessTokenLivenessResult {
  const latencyMs = direct.latencyMs + sub2api.latencyMs;
  if (sub2api.ok) {
    return {
      ok: true,
      status: sub2api.status,
      message: `${sub2api.message}；直接 AT 返回 ${direct.status}: ${direct.message}`,
      latencyMs,
    };
  }
  return {
    ok: false,
    status: direct.status || sub2api.status,
    message: `${direct.message}；${sub2api.message}`,
    latencyMs,
    banned: direct.banned || sub2api.banned,
  };
}

export interface K12PlanCheckInput {
  planType?: string;
  accountId?: string;
  workspaceIds: string[];
}

export function k12PlanMismatchReason(input: K12PlanCheckInput): string | undefined {
  const plan = String(input.planType || "").trim().toLowerCase();
  const accountId = String(input.accountId || "").trim();
  const targetIds = new Set(input.workspaceIds.map((item) => item.trim().toLowerCase()).filter(Boolean));
  if (plan === "k12") return undefined;
  if (accountId && targetIds.has(accountId.toLowerCase())) return undefined;
  if (!plan && !accountId) return undefined;
  return `Sub2API 账号套餐不是 K12: plan=${plan || "?"} account=${accountId || "?"}`;
}
