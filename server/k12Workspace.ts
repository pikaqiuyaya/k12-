const SAME_DOMAIN_WORKSPACE_MESSAGE = "only users with emails on the same domain can request access to a workspace";

export type K12WorkspaceProbeKind =
  | "usable"
  | "exists"
  | "invalid"
  | "account-denied"
  | "auth-error"
  | "rate-limited"
  | "unknown"
  | "error";

export function isSameDomainWorkspaceError(status: number, body: string): boolean {
  return status === 401 && body.toLowerCase().includes(SAME_DOMAIN_WORKSPACE_MESSAGE);
}

export function shouldRetryK12Invite(attempt: number, maxAttempts: number, status: number, body: string): boolean {
  if (attempt >= maxAttempts) return false;
  if (isSameDomainWorkspaceError(status, body)) return false;
  if (shouldRemoveWorkspaceAfterProbe(classifyK12WorkspaceProbeResult({ok: false, status, body}))) return false;
  return true;
}

export function classifyK12WorkspaceProbeResult(input: {ok: boolean; status: number; body: string}): K12WorkspaceProbeKind {
  if (input.ok) return "usable";
  const body = String(input.body || "");
  const lowered = body.toLowerCase();
  if (isSameDomainWorkspaceError(input.status, body)) return "exists";
  if (isUnavailableWorkspaceSelectError(input.status, body)) return "invalid";
  if (input.status === 429) return "rate-limited";
  if (
    input.status === 403
    || /codex_workspace_access_denied|workspace administrator|contact your chatgpt workspace administrator/i.test(body)
  ) {
    return "account-denied";
  }
  if (
    input.status === 401
    && /unauthorized|unauthenticated|invalid token|access token|bearer|auth/i.test(lowered)
  ) {
    return "auth-error";
  }
  return "error";
}

export function shouldRemoveWorkspaceAfterProbe(kind: K12WorkspaceProbeKind): boolean {
  return kind === "invalid";
}

export function mergeWorkspaceFallbackIds(primaryIds: string[], fallbackIds: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of [...primaryIds, ...fallbackIds]) {
    const workspaceId = raw.trim();
    const key = workspaceId.toLowerCase();
    if (!workspaceId || seen.has(key)) continue;
    seen.add(key);
    result.push(workspaceId);
  }
  return result;
}

export function isRecoverableWorkspaceSwitchAuthStep(url: string): boolean {
  return url === "https://auth.openai.com/email-verification"
    || url === "https://auth.openai.com/u/signup/identifier"
    || url === "https://auth.openai.com/about-you";
}

export function isRecoverableWorkspaceSelectError(message: string): boolean {
  return /invalid_state|invalid_auth_step|sign-in session is no longer valid|no_valid_workspaces/i.test(message);
}

export function isUnavailableWorkspaceSelectError(status: number, body: string): boolean {
  if (!status) return false;
  return /invalid_workspace_selected|no_valid_workspaces/i.test(body);
}

export function removeWorkspaceId(workspaceIds: string[], unavailableWorkspaceId: string): string[] {
  const target = unavailableWorkspaceId.trim().toLowerCase();
  if (!target) return [...workspaceIds];
  return workspaceIds.filter((item) => item.trim().toLowerCase() !== target);
}

interface AuthSessionWorkspace {
  id?: unknown;
  kind?: unknown;
}

interface AuthSessionLike {
  workspaces?: unknown;
}

export function authWorkspaceSelectionCandidates(authSessions: AuthSessionLike[], preferredWorkspaceIds: string[]): string[] {
  const workspaces: AuthSessionWorkspace[] = [];
  for (const session of authSessions) {
    if (!Array.isArray(session.workspaces)) continue;
    for (const workspace of session.workspaces) {
      if (workspace && typeof workspace === "object") workspaces.push(workspace as AuthSessionWorkspace);
    }
  }

  const availableIds = new Set(workspaces.map((item) => String(item.id || "").trim()).filter(Boolean));
  const preferredAvailable = preferredWorkspaceIds
    .map((item) => item.trim())
    .filter((item) => item && availableIds.has(item));
  const personal = workspaces
    .filter((item) => String(item.kind || "").toLowerCase() === "personal")
    .map((item) => String(item.id || "").trim())
    .filter(Boolean);
  const others = workspaces
    .map((item) => String(item.id || "").trim())
    .filter(Boolean);

  return mergeWorkspaceFallbackIds(preferredAvailable, [...personal, ...others]);
}
