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
