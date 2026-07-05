export interface LaunchEmailCandidate {
  parentEmail?: string;
  status: string;
}

export interface LaunchSelectionInput {
  selectedCount: number;
  runnableMotherCount: number;
  workspaceCount: number;
  workspaceLaunchMode?: WorkspaceLaunchMode;
}

export interface LaunchSelectionSummary {
  selectedCount: number;
  runnableMotherCount: number;
  workspaceMultiplier: number;
  taskCount: number;
  skippedCount: number;
}

export type WorkspaceLaunchMode = "all" | "random-one";

export function isRunnableMotherEmail(email: LaunchEmailCandidate): boolean {
  return !email.parentEmail && email.status !== "running";
}

export function workspaceLaunchMultiplier(workspaceCount: number, workspaceLaunchMode: WorkspaceLaunchMode = "all"): number {
  if (workspaceLaunchMode === "random-one") return 1;
  const count = Math.floor(Number(workspaceCount) || 0);
  return Math.max(1, count);
}

export function launchTaskTotal(motherCount: number, workspaceCount: number, workspaceLaunchMode: WorkspaceLaunchMode = "all"): number {
  return Math.max(0, Math.floor(Number(motherCount) || 0)) * workspaceLaunchMultiplier(workspaceCount, workspaceLaunchMode);
}

export function summarizeLaunchSelection(input: LaunchSelectionInput): LaunchSelectionSummary {
  const selectedCount = Math.max(0, Math.floor(Number(input.selectedCount) || 0));
  const runnableMotherCount = Math.max(0, Math.floor(Number(input.runnableMotherCount) || 0));
  const workspaceMultiplier = workspaceLaunchMultiplier(input.workspaceCount, input.workspaceLaunchMode);
  return {
    selectedCount,
    runnableMotherCount,
    workspaceMultiplier,
    taskCount: runnableMotherCount * workspaceMultiplier,
    skippedCount: Math.max(0, selectedCount - runnableMotherCount),
  };
}
