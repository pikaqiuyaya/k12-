export interface DeletableEmailLike {
  id: string;
  email: string;
  parentEmail?: string;
  smsBowerMailRoot?: string;
  sub2apiAccount?: string;
}

export interface DeletableTaskLike {
  emailId: string;
  status?: string;
  sub2apiAccount?: string;
}

function lower(value: unknown): string {
  return String(value || "").trim().toLowerCase();
}

function emailRoot(email: DeletableEmailLike): string {
  return lower(email.parentEmail) || lower(email.smsBowerMailRoot) || lower(email.email) || lower(email.id);
}

function isParentEmail(email: DeletableEmailLike): boolean {
  return !lower(email.parentEmail) && (!lower(email.smsBowerMailRoot) || lower(email.smsBowerMailRoot) === lower(email.email));
}

function isActiveTask(task: DeletableTaskLike): boolean {
  return task.status === "queued" || task.status === "running";
}

export function pruneTasksForDeletedEmails<TTask extends DeletableTaskLike>(
  allEmails: DeletableEmailLike[],
  allTasks: TTask[],
  deletedEmailIds: string[],
): {tasks: TTask[]; removedTasks: number} {
  const deletedIds = new Set(deletedEmailIds.filter(Boolean));
  if (!deletedIds.size) return {tasks: allTasks, removedTasks: 0};

  const emailById = new Map(allEmails.map((email) => [email.id, email]));
  const deletedParentRoots = new Set<string>();
  const taskEmailIdsToRemove = new Set<string>(deletedIds);

  for (const id of deletedIds) {
    const email = emailById.get(id);
    if (!email || !isParentEmail(email)) continue;
    deletedParentRoots.add(emailRoot(email));
  }

  if (deletedParentRoots.size) {
    for (const email of allEmails) {
      if (deletedParentRoots.has(emailRoot(email))) taskEmailIdsToRemove.add(email.id);
    }
  }

  let removedTasks = 0;
  const tasks = allTasks.filter((task) => {
    if (!taskEmailIdsToRemove.has(task.emailId)) return true;
    if (isActiveTask(task)) return true;
    removedTasks += 1;
    return false;
  });

  return {tasks, removedTasks};
}

export function pruneTasksWithoutEmailRecords<TTask extends DeletableTaskLike>(
  allEmails: DeletableEmailLike[],
  allTasks: TTask[],
): {tasks: TTask[]; removedTasks: number} {
  const emailById = new Map(allEmails.map((email) => [email.id, email]));
  const parentEmails = new Set(
    allEmails
      .filter(isParentEmail)
      .map((email) => lower(email.email)),
  );

  let removedTasks = 0;
  const tasks = allTasks.filter((task) => {
    if (isActiveTask(task)) return true;
    const email = emailById.get(task.emailId);
    if (!email) {
      removedTasks += 1;
      return false;
    }
    const parentEmail = lower(email.parentEmail);
    if (parentEmail && !parentEmails.has(parentEmail)) {
      removedTasks += 1;
      return false;
    }
    return true;
  });

  return {tasks, removedTasks};
}

export function pruneTasksForMissingSub2ApiAccounts<
  TEmail extends DeletableEmailLike,
  TTask extends DeletableTaskLike,
>(
  allEmails: TEmail[],
  allTasks: TTask[],
  existingSub2ApiAccountNames: string[],
  options: {shouldInspectAccountName?: (accountName: string) => boolean} = {},
): {emails: TEmail[]; tasks: TTask[]; removedTasks: number; clearedEmails: number} {
  const existingNames = new Set(existingSub2ApiAccountNames.map(lower).filter(Boolean));
  const shouldInspectAccountName = options.shouldInspectAccountName || (() => true);
  let clearedEmails = 0;
  const staleEmailIds = new Set<string>();

  for (const email of allEmails) {
    const accountName = lower(email.sub2apiAccount);
    if (!accountName || !shouldInspectAccountName(accountName) || existingNames.has(accountName)) continue;
    delete email.sub2apiAccount;
    staleEmailIds.add(email.id);
    clearedEmails += 1;
  }

  let removedTasks = 0;
  const tasks = allTasks.filter((task) => {
    if (isActiveTask(task)) return true;
    const taskAccountName = lower(task.sub2apiAccount);
    const staleByTaskAccount = Boolean(taskAccountName)
      && shouldInspectAccountName(taskAccountName)
      && !existingNames.has(taskAccountName);
    const staleByEmailAccount = staleEmailIds.has(task.emailId);
    if (!staleByTaskAccount && !staleByEmailAccount) return true;
    removedTasks += 1;
    return false;
  });

  return {emails: allEmails, tasks, removedTasks, clearedEmails};
}
