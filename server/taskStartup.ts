export interface StartupTaskRef {
  id?: string;
  emailId?: string;
  accessToken?: string;
  accessTokenHash?: string;
  accessTokenPreview?: string;
  createdAt?: string;
  updatedAt?: string;
  finishedAt?: string;
}

export function shouldHydrateAccessTokensFromTokenOut(tasks: StartupTaskRef[]): boolean {
  return tasks.some((task) => (
    !String(task.accessToken || "").trim()
    && (Boolean(String(task.accessTokenHash || "").trim()) || Boolean(String(task.accessTokenPreview || "").trim()))
  ));
}

function taskSortTime(task: StartupTaskRef): string {
  return String(task.finishedAt || task.updatedAt || task.createdAt || "");
}

export function buildTasksByEmailId<T extends StartupTaskRef>(tasks: T[]): Map<string, T[]> {
  const result = new Map<string, T[]>();
  for (const task of tasks) {
    const emailId = String(task.emailId || "");
    if (!emailId) continue;
    const bucket = result.get(emailId);
    if (bucket) bucket.push(task);
    else result.set(emailId, [task]);
  }
  for (const bucket of result.values()) {
    bucket.sort((a, b) => taskSortTime(b).localeCompare(taskSortTime(a)));
  }
  return result;
}
