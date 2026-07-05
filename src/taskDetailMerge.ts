export interface TaskDetailMergeInput {
  id: string;
  logs?: unknown[];
  [key: string]: unknown;
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
    logs: listLogs.length ? listLogs : currentLogs,
  } as T & U & {logs: unknown[]};
}
