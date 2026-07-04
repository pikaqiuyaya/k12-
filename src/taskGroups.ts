export type TaskGroupSource = "sms" | "emailnator" | "pool";

export interface TaskGroupInput {
  id: string;
  kind?: string;
  emailId?: string;
  email: string;
  parentEmail?: string;
  otpMode?: string;
  status: string;
  route: string;
  createdAt?: string;
  updatedAt?: string;
  startedAt?: string;
  finishedAt?: string;
  smsBowerMailRoot?: string;
  smsBowerFissionRemainingAfterThis?: number;
  smsBowerFissionChildrenRemaining?: number;
  smsBowerBatchId?: string;
  smsBowerBatchTargetSuccesses?: number;
  workspaceIds: string[];
  workspaceResults: Array<{ok: boolean}>;
}

export interface TaskGroupRow<T extends TaskGroupInput = TaskGroupInput> {
  key: string;
  rootEmail: string;
  primaryTask: T;
  tasks: T[];
  detailTasks: T[];
  source: TaskGroupSource;
  sourceLabel: string;
  status: string;
  fissionTargetChildren: number;
  fissionSuccessChildren: number;
  fissionAttemptChildren: number;
  fissionFailedChildren: number;
}

export interface TaskGroupOptions {
  minimumTargetChildren?: number;
}

function lower(value: string | undefined): string {
  return String(value || "").trim().toLowerCase();
}

function rootEmailOf(task: TaskGroupInput): string {
  return lower(task.parentEmail) || lower(task.smsBowerMailRoot) || lower(task.email) || task.id;
}

function isChildTask(task: TaskGroupInput): boolean {
  const root = rootEmailOf(task);
  return Boolean(lower(task.parentEmail)) || (Boolean(lower(task.smsBowerMailRoot)) && lower(task.email) !== root);
}

function hasFissionCounter(task: TaskGroupInput): boolean {
  return task.smsBowerFissionRemainingAfterThis !== undefined || task.smsBowerFissionChildrenRemaining !== undefined;
}

function statusRank(status: string): number {
  if (status === "running") return 0;
  if (status === "queued") return 1;
  if (status === "partial") return 2;
  if (status === "failed") return 3;
  if (status === "canceled") return 4;
  if (status === "success") return 5;
  return 5;
}

function timeValue(task: TaskGroupInput): number {
  const raw = task.startedAt || task.finishedAt || task.updatedAt || task.createdAt || "";
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

function pickPrimaryTask<T extends TaskGroupInput>(items: T[]): T {
  const sorted = [...items].sort((a, b) => {
    const activeRank = statusRank(a.status) - statusRank(b.status);
    if (activeRank !== 0) return activeRank;
    const aIsRoot = isChildTask(a) ? 1 : 0;
    const bIsRoot = isChildTask(b) ? 1 : 0;
    if (aIsRoot !== bIsRoot) return aIsRoot - bIsRoot;
    return timeValue(b) - timeValue(a);
  });
  return sorted[0];
}

function groupStatus<T extends TaskGroupInput>(items: T[], target: number, successfulChildren: number, source: TaskGroupSource): string {
  if (items.some((item) => item.status === "running")) return "running";
  if (items.some((item) => item.status === "queued")) return "queued";
  if (source === "sms") {
    if (target > 0 && successfulChildren >= target) return "success";
    if (target > 0 && successfulChildren > 0) return "partial";
    if (items.some((item) => item.status === "success")) return "success";
    if (items.some((item) => item.status === "failed")) return "failed";
    if (items.some((item) => item.status === "canceled")) return "canceled";
    return pickPrimaryTask(items).status;
  }
  if (target > 0 && successfulChildren >= target) return "success";
  if (target > 0 && successfulChildren > 0) return "partial";
  if (items.some((item) => item.status === "failed")) return "failed";
  if (items.some((item) => item.status === "canceled")) return "canceled";
  return pickPrimaryTask(items).status;
}

function sourceOf<T extends TaskGroupInput>(items: T[]): TaskGroupSource {
  if (items.some((item) => item.otpMode === "smsbower-mail" || item.smsBowerBatchId)) return "sms";
  if (items.some((item) => item.otpMode === "emailnator")) return "emailnator";
  return "pool";
}

function sourceLabel(source: TaskGroupSource): string {
  if (source === "sms") return "SMS";
  if (source === "emailnator") return "Emailnator";
  return "邮箱池";
}

function uniqueChildEmails<T extends TaskGroupInput>(items: T[], status?: string): Set<string> {
  const out = new Set<string>();
  for (const item of items) {
    if (!isChildTask(item)) continue;
    if (status && item.status !== status) continue;
    out.add(lower(item.email) || item.id);
  }
  return out;
}

function fissionTarget<T extends TaskGroupInput>(items: T[], successfulChildren: number, attemptChildren: number, source: TaskGroupSource, minimumTargetChildren = 0): number {
  const counters = items
    .map((item) => item.smsBowerFissionRemainingAfterThis)
    .filter((value): value is number => Number.isFinite(value));
  const maxTaskCounter = counters.length ? Math.max(...counters) : 0;
  const currentRemaining = items
    .filter((item) => !isChildTask(item))
    .map((item) => item.smsBowerFissionChildrenRemaining)
    .filter((value): value is number => Number.isFinite(value));
  const maxCurrentTarget = currentRemaining.length ? Math.max(...currentRemaining.map((value) => value + successfulChildren)) : 0;
  const hasFissionHistory = items.some((item) => isChildTask(item) || hasFissionCounter(item));
  const configuredTarget = hasFissionHistory ? Math.max(0, Math.floor(minimumTargetChildren || 0)) : 0;
  if (source === "sms") {
    if (currentRemaining.length) {
      const attemptedChildren = Math.max(attemptChildren, successfulChildren);
      const stoppedAtCurrentLimit = currentRemaining.some((value) => Math.max(0, Math.floor(value)) <= 0);
      const currentTarget = Math.max(...currentRemaining.map((value) => {
        const remaining = Math.max(0, Math.floor(value));
        return remaining > 0 ? remaining + attemptedChildren : attemptedChildren;
      }));
      return Math.max(currentTarget, successfulChildren, stoppedAtCurrentLimit ? 0 : configuredTarget);
    }
    return Math.max(maxTaskCounter, successfulChildren, attemptChildren, configuredTarget);
  }
  return Math.max(maxTaskCounter, maxCurrentTarget, successfulChildren, configuredTarget);
}

export function buildTaskGroups<T extends TaskGroupInput>(tasks: T[], options: TaskGroupOptions = {}): Array<TaskGroupRow<T>> {
  const groups = new Map<string, T[]>();
  const firstIndex = new Map<string, number>();

  tasks.forEach((task, index) => {
    const root = rootEmailOf(task);
    const key = `root:${root}`;
    if (!groups.has(key)) {
      groups.set(key, []);
      firstIndex.set(key, index);
    }
    groups.get(key)?.push(task);
  });

  return Array.from(groups.entries())
    .map(([key, items]) => {
      const primaryTask = pickPrimaryTask(items);
      const detailTasks = items.filter((item) => item.id !== primaryTask.id);
      const successfulChildren = uniqueChildEmails(items, "success").size;
      const source = sourceOf(items);
      const failedChildren = uniqueChildEmails(items, "failed").size;
      const attemptChildren = uniqueChildEmails(items).size;
      const target = fissionTarget(items, successfulChildren, attemptChildren, source, options.minimumTargetChildren);
      return {
        key,
        rootEmail: rootEmailOf(primaryTask),
        primaryTask,
        tasks: items,
        detailTasks,
        source,
        sourceLabel: sourceLabel(source),
        status: groupStatus(items, target, successfulChildren, source),
        fissionTargetChildren: target,
        fissionSuccessChildren: successfulChildren,
        fissionAttemptChildren: attemptChildren,
        fissionFailedChildren: failedChildren,
        firstIndex: firstIndex.get(key) || 0,
      };
    })
    .sort((a, b) => {
      const rank = statusRank(a.status) - statusRank(b.status);
      if (rank !== 0) return rank;
      return a.firstIndex - b.firstIndex;
    })
    .map(({firstIndex: _firstIndex, ...row}) => row);
}

export function canTopUpTaskGroupFission<T extends TaskGroupInput>(group: TaskGroupRow<T>): boolean {
  if (group.source === "emailnator") return false;
  if (group.fissionTargetChildren <= 0) return false;
  if (group.fissionSuccessChildren >= group.fissionTargetChildren) return false;
  return !group.tasks.some((task) => task.status === "queued" || task.status === "running");
}
