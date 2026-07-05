export const K12_REPAIR_ISSUE = "k12-plan-mismatch";
export const SUB2API_K12_STATUS_ERROR_ISSUE = "sub2api-k12-status-error";
const k12RepairIssues = new Set([K12_REPAIR_ISSUE, SUB2API_K12_STATUS_ERROR_ISSUE]);

export interface EmailPoolRepairCheckResult {
  emailId?: string;
  ok: boolean;
  issue?: string;
  message?: string;
  repairable?: boolean;
}

export function isK12RepairNeededResult(result?: EmailPoolRepairCheckResult): boolean {
  if (result?.repairable === false) return false;
  return Boolean(result && !result.ok && result.issue && k12RepairIssues.has(result.issue));
}

export function mergeK12RepairScanResults<T extends EmailPoolRepairCheckResult>(
  existing: Record<string, T>,
  scannedEmailIds: string[],
  scanItems: T[],
): Record<string, T> {
  const scanned = new Set(scannedEmailIds);
  const next = Object.fromEntries(
    Object.entries(existing).filter(([emailId]) => !scanned.has(emailId)),
  ) as Record<string, T>;

  for (const item of scanItems) {
    if (!item.emailId || !isK12RepairNeededResult(item)) continue;
    next[item.emailId] = item;
  }

  return next;
}
