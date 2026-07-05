export interface RefillHistoryViewEntry {
  kind?: "refill" | "at-repair" | "delete-403" | "workspace-delete" | "batch" | "runtime" | string;
  ok?: boolean;
  error?: string;
  deepCheckEnabled?: boolean;
  deepFailed?: number;
  issueAccounts?: number;
}

export interface RefillHistoryOutcome {
  text: string;
  className: "success" | "failed" | "warn";
}

function positive(value: unknown): number {
  const numeric = Number(value || 0);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
}

export function refillHistoryOutcome(entry: RefillHistoryViewEntry): RefillHistoryOutcome {
  if (entry.error || entry.ok === false) return {text: "失败", className: "failed"};
  if ((entry.kind || "refill") === "at-repair" && positive(entry.issueAccounts)) {
    return {text: "发现错误", className: "warn"};
  }
  if ((entry.kind || "refill") === "workspace-delete") {
    return {text: "已删除", className: "warn"};
  }
  if ((entry.kind || "refill") === "refill" && entry.deepCheckEnabled && positive(entry.deepFailed)) {
    return {text: "有失败", className: "warn"};
  }
  return {text: "完成", className: "success"};
}

export function refillRecentStatusText(error: string, result: RefillHistoryViewEntry | null | undefined): string {
  if (error) return "失败";
  if (!result) return "无记录";
  const failed = positive(result.deepFailed);
  return failed ? `检测完成，有失败 ${failed}` : "检测完成";
}

export function atRepairRecentStatusText(error: string, result: RefillHistoryViewEntry | null | undefined): string {
  if (error) return "失败";
  if (!result) return "无记录";
  const issues = positive(result.issueAccounts);
  return issues ? `扫描完成，错误 ${issues}` : "扫描完成";
}
