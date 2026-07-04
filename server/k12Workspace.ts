const SAME_DOMAIN_WORKSPACE_MESSAGE = "only users with emails on the same domain can request access to a workspace";

export function isSameDomainWorkspaceError(status: number, body: string): boolean {
  return status === 401 && body.toLowerCase().includes(SAME_DOMAIN_WORKSPACE_MESSAGE);
}

export function shouldRetryK12Invite(attempt: number, maxAttempts: number, status: number, body: string): boolean {
  if (attempt >= maxAttempts) return false;
  if (isSameDomainWorkspaceError(status, body)) return false;
  return true;
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
