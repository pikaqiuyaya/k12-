export interface LaunchBatchDetailTask {
  id: string;
  email: string;
  status: string;
  launchBatchId?: string;
  smsBowerBatchId?: string;
  workspaceIds: string[];
  workspaceResults: Array<{ok: boolean}>;
  error?: string;
  createdAt?: string;
  updatedAt?: string;
  startedAt?: string;
  finishedAt?: string;
}

export interface LaunchBatchDetailRow {
  id: string;
  email: string;
  status: string;
  workspace: string;
  k12: string;
  error: string;
}

export interface LaunchBatchDetailRows {
  total: number;
  limited: boolean;
  rows: LaunchBatchDetailRow[];
}

function statusRank(status: string): number {
  if (status === "running") return 0;
  if (status === "queued") return 1;
  if (status === "failed") return 2;
  if (status === "canceled") return 3;
  if (status === "success") return 4;
  return 5;
}

function timeValue(task: LaunchBatchDetailTask): number {
  const raw = task.startedAt || task.updatedAt || task.finishedAt || task.createdAt || "";
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

function taskBatchId(task: LaunchBatchDetailTask): string {
  return task.launchBatchId || task.smsBowerBatchId || "";
}

function workspaceText(task: LaunchBatchDetailTask): string {
  const first = (task.workspaceIds || []).find(Boolean);
  return first ? first.slice(0, 8) : "-";
}

function k12Text(task: LaunchBatchDetailTask): string {
  const total = (task.workspaceIds || []).filter(Boolean).length;
  if (!total) return "-";
  const ok = (task.workspaceResults || []).filter((result) => result.ok).length;
  return `${ok}/${total}`;
}

export function launchBatchDetailRows(
  tasks: LaunchBatchDetailTask[],
  batchId: string,
  limit = 500,
): LaunchBatchDetailRows {
  const matched = tasks
    .filter((task) => taskBatchId(task) === batchId)
    .sort((a, b) => {
      const rank = statusRank(a.status) - statusRank(b.status);
      if (rank !== 0) return rank;
      return timeValue(b) - timeValue(a);
    });
  const safeLimit = Math.max(1, Math.floor(limit || 500));
  return {
    total: matched.length,
    limited: matched.length > safeLimit,
    rows: matched.slice(0, safeLimit).map((task) => ({
      id: task.id,
      email: task.email,
      status: task.status,
      workspace: workspaceText(task),
      k12: k12Text(task),
      error: task.error || "",
    })),
  };
}
