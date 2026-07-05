export type LaunchBatchTaskStatus = "queued" | "running" | "success" | "failed" | "canceled" | string;

export interface LaunchBatchTask {
  id: string;
  status: LaunchBatchTaskStatus;
  launchBatchId?: string;
  launchBatchTargetTasks?: number;
  smsBowerBatchId?: string;
  smsBowerBatchTargetSuccesses?: number;
}

export interface LaunchBatchSummary {
  id: string;
  target: number;
  total: number;
  success: number;
  failed: number;
  running: number;
  queued: number;
  canceled: number;
}

export function summarizeLaunchBatches(tasks: LaunchBatchTask[]): LaunchBatchSummary[] {
  const map = new Map<string, LaunchBatchSummary>();
  for (const task of tasks) {
    const id = task.launchBatchId || task.smsBowerBatchId || "";
    if (!id) continue;
    const item = map.get(id) || {
      id,
      target: Number(task.launchBatchId ? task.launchBatchTargetTasks || 0 : task.smsBowerBatchTargetSuccesses || 0),
      total: 0,
      success: 0,
      failed: 0,
      running: 0,
      queued: 0,
      canceled: 0,
    };
    item.total += 1;
    if (task.status === "success") item.success += 1;
    else if (task.status === "failed") item.failed += 1;
    else if (task.status === "running") item.running += 1;
    else if (task.status === "queued") item.queued += 1;
    else if (task.status === "canceled") item.canceled += 1;
    map.set(id, item);
  }
  return [...map.values()].sort((a, b) => b.id.localeCompare(a.id));
}
