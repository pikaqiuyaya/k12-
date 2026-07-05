export interface TaskListViewRecord {
  status?: string;
  createdAt?: string;
  updatedAt?: string;
  finishedAt?: string;
}

function taskListTime(task: TaskListViewRecord): string {
  return String(task.finishedAt || task.updatedAt || task.createdAt || "");
}

export function selectDefaultVisibleTasks<T extends TaskListViewRecord>(tasks: T[], maxHistory = 1200): T[] {
  const active = tasks.filter((task) => task.status === "queued" || task.status === "running");
  const activeSet = new Set(active);
  const history = tasks
    .filter((task) => !activeSet.has(task) && task.status !== "canceled")
    .sort((a, b) => taskListTime(b).localeCompare(taskListTime(a)))
    .slice(0, Math.max(0, maxHistory));
  return [...active, ...history];
}
