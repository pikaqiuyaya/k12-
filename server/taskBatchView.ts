import {launchBatchDetailRows, type LaunchBatchDetailRows, type LaunchBatchDetailTask} from "../src/launchBatchDetails";
import {summarizeLaunchBatches, type LaunchBatchSummary, type LaunchBatchTask} from "../src/launchBatchSummary";

export function batchSummaryView(tasks: LaunchBatchTask[]): LaunchBatchSummary[] {
  return summarizeLaunchBatches(tasks);
}

export function batchDetailView(
  tasks: LaunchBatchDetailTask[],
  batchId: string,
  limit = 500,
): LaunchBatchDetailRows {
  return launchBatchDetailRows(tasks, batchId, limit);
}
