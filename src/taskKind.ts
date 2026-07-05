export type TaskKindLike = {
  kind?: string;
};

export function isAtRepairTask(task: TaskKindLike): boolean {
  return task.kind === "at-repair";
}

export function isMainK12Task(task: TaskKindLike): boolean {
  return !isAtRepairTask(task);
}

export function splitTasksByKind<T extends TaskKindLike>(tasks: T[]): {mainTasks: T[]; atRepairTasks: T[]} {
  const mainTasks: T[] = [];
  const atRepairTasks: T[] = [];
  for (const task of tasks) {
    if (isAtRepairTask(task)) atRepairTasks.push(task);
    else mainTasks.push(task);
  }
  return {mainTasks, atRepairTasks};
}
