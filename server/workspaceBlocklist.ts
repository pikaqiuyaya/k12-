export interface WorkspaceBlockRecord {
  rootEmail: string;
  workspaceId: string;
  reason: string;
  createdAt: string;
  updatedAt: string;
  scope?: "root" | "email";
  source?: string;
  accountName?: string;
}

function lower(value: unknown): string {
  return String(value || "").trim().toLowerCase();
}

export function normalizeWorkspaceBlockRoot(email: unknown): string {
  return lower(email);
}

export function normalizeWorkspaceBlockId(workspaceId: unknown): string {
  return lower(workspaceId);
}

export function workspaceBlockKey(rootEmail: unknown, workspaceId: unknown, scope: "root" | "email" = "root"): string {
  return `${scope}|${normalizeWorkspaceBlockRoot(rootEmail)}|${normalizeWorkspaceBlockId(workspaceId)}`;
}

export function upsertWorkspaceBlock(
  blocks: WorkspaceBlockRecord[],
  input: {
    rootEmail: string;
    workspaceId: string;
    reason: string;
    at: string;
    scope?: "root" | "email";
    source?: string;
    accountName?: string;
  },
): {blocks: WorkspaceBlockRecord[]; changed: boolean} {
  const rootEmail = normalizeWorkspaceBlockRoot(input.rootEmail);
  const workspaceId = normalizeWorkspaceBlockId(input.workspaceId);
  const scope = input.scope === "email" ? "email" : "root";
  if (!rootEmail || !workspaceId) return {blocks, changed: false};

  const key = workspaceBlockKey(rootEmail, workspaceId, scope);
  const next = [...blocks];
  const index = next.findIndex((item) => workspaceBlockKey(item.rootEmail, item.workspaceId, item.scope) === key);
  const reason = String(input.reason || "").trim();
  if (index >= 0) {
    const existing = next[index];
    const updated: WorkspaceBlockRecord = {
      ...existing,
      reason: reason || existing.reason,
      updatedAt: input.at,
      scope,
      source: input.source || existing.source,
      accountName: input.accountName || existing.accountName,
    };
    const changed = JSON.stringify(existing) !== JSON.stringify(updated);
    next[index] = updated;
    return {blocks: next, changed};
  }

  next.push({
    rootEmail,
    workspaceId,
    reason,
    createdAt: input.at,
    updatedAt: input.at,
    scope,
    source: input.source,
    accountName: input.accountName,
  });
  return {blocks: next, changed: true};
}

export function isWorkspaceBlocked(
  blocks: WorkspaceBlockRecord[],
  rootEmail: unknown,
  workspaceIds: unknown[] | undefined,
  scope: "root" | "email" = "root",
): boolean {
  const root = normalizeWorkspaceBlockRoot(rootEmail);
  if (!root) return false;
  const ids = (workspaceIds || []).map(normalizeWorkspaceBlockId).filter(Boolean);
  if (!ids.length) return false;
  const keys = new Set(blocks.map((item) => workspaceBlockKey(item.rootEmail, item.workspaceId, item.scope)));
  return ids.some((workspaceId) => keys.has(workspaceBlockKey(root, workspaceId, scope)));
}

export function blockedWorkspaceReason(
  blocks: WorkspaceBlockRecord[],
  rootEmail: unknown,
  workspaceIds: unknown[] | undefined,
  scope: "root" | "email" = "root",
): string {
  const root = normalizeWorkspaceBlockRoot(rootEmail);
  const ids = (workspaceIds || []).map(normalizeWorkspaceBlockId).filter(Boolean);
  const normalizedScope = scope === "email" ? "email" : "root";
  const found = blocks.find((item) => (
    root === normalizeWorkspaceBlockRoot(item.rootEmail)
    && ids.includes(normalizeWorkspaceBlockId(item.workspaceId))
    && (item.scope || "root") === normalizedScope
  ));
  return found?.reason || "";
}

export function emailWorkspaceBlockReason(
  blocks: WorkspaceBlockRecord[],
  email: unknown,
  workspaceIds: unknown[] | undefined,
): string {
  return blockedWorkspaceReason(blocks, email, workspaceIds, "email");
}
