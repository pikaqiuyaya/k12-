export function autoAtRepairProgressMessage(input: {
  processedAccounts: number;
  totalAccounts: number;
  issueAccounts: number;
  createdTasks: number;
  skippedRunning: number;
  skippedUnmatched: number;
  skippedTerminal: number;
}): string {
  const processed = Math.max(0, Math.trunc(input.processedAccounts));
  const total = Math.max(0, Math.trunc(input.totalAccounts));
  const progress = total ? ` ${Math.min(processed, total)}/${total}` : "";
  const suffix = [
    input.skippedRunning ? `跳过已有任务/邮箱不可用 ${input.skippedRunning} 个` : "",
    input.skippedUnmatched ? `跳过未匹配邮箱 ${input.skippedUnmatched} 个` : "",
    input.skippedTerminal ? `跳过 403 死号 ${input.skippedTerminal} 个` : "",
  ].filter(Boolean).join("，");
  return `自动补 AT 扫描中${progress}，已发现可补 K12 错误 ${input.issueAccounts} 个，已创建修复任务 ${input.createdTasks} 个${suffix ? `，${suffix}` : ""}`;
}

export function shouldPublishAutoAtRepairProgress(input: {
  processedAccounts: number;
  totalAccounts: number;
  issueChanged: boolean;
}): boolean {
  if (input.issueChanged) return true;
  if (input.totalAccounts > 0 && input.processedAccounts >= input.totalAccounts) return true;
  return input.processedAccounts > 0 && input.processedAccounts % 10 === 0;
}
