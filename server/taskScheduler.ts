type TaskKind = "k12" | "at-repair";
type WorkerPool = "main" | "at-repair";

export function workerPoolForTaskKind(kind: TaskKind | string | undefined): WorkerPool {
  return kind === "at-repair" ? "at-repair" : "main";
}

export function canStartTaskInWorkerPool(input: {
  taskKind?: TaskKind | string;
  activeMainWorkers: number;
  mainLimit: number;
  activeAtRepairWorkers: number;
  atRepairLimit: number;
}): boolean {
  const pool = workerPoolForTaskKind(input.taskKind);
  if (pool === "at-repair") {
    return input.activeAtRepairWorkers < Math.max(1, input.atRepairLimit);
  }
  return input.activeMainWorkers < Math.max(1, input.mainLimit);
}

export function workerPoolLimits(input: {taskConcurrency: number}): {mainLimit: number; atRepairLimit: number} {
  const limit = Math.max(1, Math.floor(input.taskConcurrency || 0));
  return {
    mainLimit: limit,
    atRepairLimit: limit,
  };
}

export function isRootActiveInWorkerPool(input: {
  taskKind?: TaskKind | string;
  root: string;
  activeMainRoots: Set<string>;
  activeAtRepairRoots: Set<string>;
}): boolean {
  const root = String(input.root || "").toLowerCase();
  if (!root) return false;
  return workerPoolForTaskKind(input.taskKind) === "at-repair"
    ? input.activeAtRepairRoots.has(root)
    : input.activeMainRoots.has(root);
}

export function incrementWorkerPool(input: {
  taskKind?: TaskKind | string;
  activeMainWorkers: number;
  activeAtRepairWorkers: number;
}): {activeMainWorkers: number; activeAtRepairWorkers: number} {
  if (workerPoolForTaskKind(input.taskKind) === "at-repair") {
    return {
      activeMainWorkers: input.activeMainWorkers,
      activeAtRepairWorkers: input.activeAtRepairWorkers + 1,
    };
  }
  return {
    activeMainWorkers: input.activeMainWorkers + 1,
    activeAtRepairWorkers: input.activeAtRepairWorkers,
  };
}
