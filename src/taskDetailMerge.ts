export interface TaskDetailMergeInput {
  id: string;
  logs?: unknown[];
  [key: string]: unknown;
}

function logKey(log: unknown): string {
  if (log && typeof log === "object") {
    const record = log as Record<string, unknown>;
    return `${String(record.at || "")}\n${String(record.level || "")}\n${String(record.message || "")}`;
  }
  try {
    return JSON.stringify(log);
  } catch {
    return String(log);
  }
}

function mergeLogs(currentLogs: unknown[], listLogs: unknown[]): unknown[] {
  if (!currentLogs.length) return listLogs;
  if (!listLogs.length) return currentLogs;
  const seen = new Set(currentLogs.map(logKey));
  const merged = [...currentLogs];
  for (const log of listLogs) {
    const key = logKey(log);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(log);
  }
  return merged;
}

export function mergeTaskDetailWithListTask<T extends TaskDetailMergeInput, U extends TaskDetailMergeInput>(
  current: T,
  listTask: U,
): T & U & {logs: unknown[]} {
  const merged = {
    ...current,
    ...listTask,
  };
  const listLogs = Array.isArray(listTask.logs) ? listTask.logs : [];
  const currentLogs = Array.isArray(current.logs) ? current.logs : [];
  return {
    ...merged,
    logs: mergeLogs(currentLogs, listLogs),
  } as T & U & {logs: unknown[]};
}
