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
  error?: string;
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
  logs?: Array<{message?: string}>;
}

export interface TaskGroupRow<T extends TaskGroupInput = TaskGroupInput> {
  key: string;
  rootEmail: string;
  workspaceKey: string;
  workspaceIds: string[];
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

export interface TaskRootGroupRow<T extends TaskGroupInput = TaskGroupInput> {
  key: string;
  rootEmail: string;
  primaryTask: T;
  workspaceGroups: Array<TaskGroupRow<T>>;
  tasks: T[];
  status: string;
  source: TaskGroupSource;
  sourceLabel: string;
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

function workspaceKeyOf(task: TaskGroupInput): string {
  const [first] = (task.workspaceIds || []).map((item) => lower(item)).filter(Boolean);
  return first || "__no_workspace__";
}

function workspaceIdsOf<T extends TaskGroupInput>(items: T[]): string[] {
  const key = workspaceKeyOf(items[0]);
  return key === "__no_workspace__" ? [] : [key];
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

function workspaceResultOkCount(task: TaskGroupInput): number {
  return (task.workspaceResults || []).filter((result) => result.ok).length;
}

function workspaceIdCount(task: TaskGroupInput): number {
  return (task.workspaceIds || []).map((item) => lower(item)).filter(Boolean).length || 999;
}

function detailStatusRank(task: TaskGroupInput): number {
  const status = displayStatusForGrouping(task);
  if (status === "running") return 0;
  if (status === "queued") return 1;
  if (status === "success") return 2;
  if (status === "partial") return 3;
  if (status === "failed") return 4;
  if (status === "canceled") return 5;
  return 6;
}

function pickPrimaryTask<T extends TaskGroupInput>(items: T[]): T {
  const sorted = [...items].sort((a, b) => {
    const activeRank = statusRank(displayStatusForGrouping(a)) - statusRank(displayStatusForGrouping(b));
    if (activeRank !== 0) return activeRank;
    const aIsRoot = isChildTask(a) ? 1 : 0;
    const bIsRoot = isChildTask(b) ? 1 : 0;
    if (aIsRoot !== bIsRoot) return aIsRoot - bIsRoot;
    return timeValue(b) - timeValue(a);
  });
  return sorted[0];
}

function detailTaskKey(task: TaskGroupInput): string {
  if (!isChildTask(task)) return `root:${rootEmailOf(task) || task.id}`;
  return `child:${lower(task.email) || task.id}`;
}

function compareDetailRecord(a: TaskGroupInput, b: TaskGroupInput): number {
  const status = detailStatusRank(a) - detailStatusRank(b);
  if (status !== 0) return status;
  const okCount = workspaceResultOkCount(b) - workspaceResultOkCount(a);
  if (okCount !== 0) return okCount;
  const workspaceCount = workspaceIdCount(a) - workspaceIdCount(b);
  if (workspaceCount !== 0) return workspaceCount;
  return timeValue(b) - timeValue(a);
}

function compareRootDetailRecord(a: TaskGroupInput, b: TaskGroupInput): number {
  const status = detailStatusRank(a) - detailStatusRank(b);
  if (status !== 0) return status;
  const time = timeValue(b) - timeValue(a);
  if (time !== 0) return time;
  const okCount = workspaceResultOkCount(b) - workspaceResultOkCount(a);
  if (okCount !== 0) return okCount;
  return workspaceIdCount(a) - workspaceIdCount(b);
}

function sortDetailTasks<T extends TaskGroupInput>(items: T[], primaryTask: T): T[] {
  return [...items].sort((a, b) => {
    const aIsPrimary = a.id === primaryTask.id ? 0 : 1;
    const bIsPrimary = b.id === primaryTask.id ? 0 : 1;
    if (aIsPrimary !== bIsPrimary) return aIsPrimary - bIsPrimary;
    return timeValue(b) - timeValue(a);
  });
}

function dedupeDetailTasks<T extends TaskGroupInput>(items: T[], primaryTask: T): T[] {
  const picked = new Map<string, T>();
  for (const item of items) {
    const key = detailTaskKey(item);
    const existing = picked.get(key);
    const isRootDetail = !isChildTask(item);
    const compareRecord = isRootDetail ? compareRootDetailRecord : compareDetailRecord;
    if (!isRootDetail && existing?.id === primaryTask.id) continue;
    if (!existing || (!isRootDetail && item.id === primaryTask.id) || compareRecord(item, existing) < 0) {
      picked.set(key, item);
    }
  }
  return sortDetailTasks(Array.from(picked.values()), primaryTask);
}

function displayStatusForGrouping(item: TaskGroupInput): string {
  return item.status;
}

function hasBlockingFailedTask<T extends TaskGroupInput>(items: T[]): boolean {
  return items.some((item) => item.status === "failed" && !hasOpenAiUserAlreadyExists(item));
}

function groupStatus<T extends TaskGroupInput>(items: T[], target: number, successfulChildren: number, source: TaskGroupSource): string {
  if (items.some((item) => item.status === "running")) return "running";
  if (items.some((item) => item.status === "queued")) return "queued";
  if (source === "sms") {
    if (target > 0 && successfulChildren >= target) return "success";
    if (target > 0 && successfulChildren > 0) return "partial";
    if (items.some((item) => item.status === "success")) return "success";
    if (hasBlockingFailedTask(items)) return "failed";
    if (items.some((item) => item.status === "canceled")) return "canceled";
    return pickPrimaryTask(items).status;
  }
  if (target > 0 && successfulChildren >= target) return "success";
  if (target > 0 && successfulChildren > 0) return "partial";
  if (target > 0 && repeatedAccountExistsChildren(items) >= 1 && !hasBlockingFailedTask(items)) return "partial";
  if (hasBlockingFailedTask(items)) return "failed";
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
    if (status === "success" && hasOpenAiUserAlreadyExists(item)) continue;
    out.add(lower(item.email) || item.id);
  }
  return out;
}

function hasSmsBowerCodeLimitStop<T extends TaskGroupInput>(items: T[]): boolean {
  return items.some((item) => (item.logs || []).some((log) => (
    /maximum number of codes reached|code limit|验证码.*上限|次数.*上限/i.test(String(log.message || ""))
  )));
}

function hasOpenAiUserAlreadyExists(item: TaskGroupInput): boolean {
  const text = [
    item.error || "",
    ...(item.logs || []).map((log) => log.message || ""),
  ].join("\n");
  return /user_already_exists|An account already exists for this email address|please login instead/i.test(text);
}

function repeatedAccountExistsChildren<T extends TaskGroupInput>(items: T[]): number {
  const out = new Set<string>();
  for (const item of items) {
    if (!isChildTask(item)) continue;
    if (!hasOpenAiUserAlreadyExists(item)) continue;
    out.add(lower(item.email) || item.id);
  }
  return out.size;
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
    if (hasSmsBowerCodeLimitStop(items)) return Math.max(successfulChildren, attemptChildren);
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
    const workspaceKey = workspaceKeyOf(task);
    const key = `root:${root}|workspace:${workspaceKey}`;
    if (!groups.has(key)) {
      groups.set(key, []);
      firstIndex.set(key, index);
    }
    groups.get(key)?.push(task);
  });

  return Array.from(groups.entries())
    .map(([key, items]) => {
      const primaryTask = pickPrimaryTask(items);
      const sortedDetailTasks = sortDetailTasks(items, primaryTask);
      const visibleDetailTasks = sortedDetailTasks.filter((item) => !(item.status === "failed" && hasOpenAiUserAlreadyExists(item)));
      const detailTasks = dedupeDetailTasks(visibleDetailTasks, primaryTask);
      const successfulChildren = uniqueChildEmails(items, "success").size;
      const source = sourceOf(items);
      const failedChildren = uniqueChildEmails(items.filter((item) => !hasOpenAiUserAlreadyExists(item)), "failed").size;
      const attemptChildren = uniqueChildEmails(items).size;
      const target = fissionTarget(items, successfulChildren, attemptChildren, source, options.minimumTargetChildren);
      return {
        key,
        rootEmail: rootEmailOf(primaryTask),
        workspaceKey: workspaceKeyOf(primaryTask),
        workspaceIds: workspaceIdsOf(items),
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

export function buildTaskRootGroups<T extends TaskGroupInput>(tasks: T[], options: TaskGroupOptions = {}): Array<TaskRootGroupRow<T>> {
  const workspaceGroups = buildTaskGroups(tasks, options);
  const groups = new Map<string, Array<TaskGroupRow<T>>>();
  const firstIndex = new Map<string, number>();

  workspaceGroups.forEach((group, index) => {
    const key = `root:${group.rootEmail}`;
    if (!groups.has(key)) {
      groups.set(key, []);
      firstIndex.set(key, index);
    }
    groups.get(key)?.push(group);
  });

  return Array.from(groups.entries())
    .map(([key, items]) => {
      const allTasks = items.flatMap((item) => item.tasks);
      const primaryTask = pickPrimaryTask(allTasks);
      const source = sourceOf(allTasks);
      const successfulChildren = items.reduce((sum, item) => sum + item.fissionSuccessChildren, 0);
      const attemptChildren = items.reduce((sum, item) => sum + item.fissionAttemptChildren, 0);
      const targetChildren = items.reduce((sum, item) => sum + item.fissionTargetChildren, 0);
      const failedChildren = items.reduce((sum, item) => sum + item.fissionFailedChildren, 0);
      return {
        key,
        rootEmail: rootEmailOf(primaryTask),
        primaryTask,
        workspaceGroups: items,
        tasks: allTasks,
        status: groupStatus(allTasks, targetChildren, successfulChildren, source),
        source,
        sourceLabel: sourceLabel(source),
        fissionTargetChildren: targetChildren,
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

export function visibleTaskTreeKeys<T extends TaskGroupInput>(
  workspaceGroups: Array<TaskGroupRow<T>>,
  rootGroups: Array<TaskRootGroupRow<T>>,
): string[] {
  return Array.from(new Set([
    ...rootGroups.map((group) => group.key),
    ...workspaceGroups.map((group) => group.key),
  ]));
}

export function activeTaskIdsOfGroup(group: {tasks: Array<{id: string; status: string}>}): string[] {
  return group.tasks
    .filter((task) => task.status === "queued" || task.status === "running")
    .map((task) => task.id);
}

export function visibleTasksForWorkspaceIds<T extends TaskGroupInput>(tasks: T[], workspaceIds: string[]): T[] {
  const allowed = new Set(workspaceIds.map((item) => lower(item)).filter(Boolean));
  if (!allowed.size) return tasks;
  return tasks.filter((task) => {
    const key = workspaceKeyOf(task);
    return key === "__no_workspace__" || allowed.has(key);
  });
}

export function canTopUpTaskGroupFission<T extends TaskGroupInput>(group: TaskGroupRow<T>): boolean {
  if (group.source === "emailnator") return false;
  if (group.fissionTargetChildren <= 0) return false;
  if (group.fissionSuccessChildren >= group.fissionTargetChildren) return false;
  return !group.tasks.some((task) => task.status === "queued" || task.status === "running");
}
