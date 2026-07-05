export interface WorkspaceDisplayState {
  kind: string;
  text: string;
  title: string;
}

function hasOpenAiUserAlreadyExists(value: string): boolean {
  return /user_already_exists|An account already exists for this email address|please login instead/i.test(value);
}

function hasMailboxOtpDeliveryTimeout(value: string): boolean {
  return /mailbox code timeout:\s*(mailbox still returns baseline code|mailbox returned no code|mailbox_url request timeout after \d+ms)|still returns baseline code|mailbox_url request timeout after \d+ms/i.test(value);
}

export function workspaceStateFromStatus(status: string, fallbackTitle = ""): WorkspaceDisplayState {
  if (status === "running" || status === "queued" || status === "success") {
    return {kind: "quiet", text: "-", title: fallbackTitle || "无空间异常"};
  }
  if (status === "partial") return {kind: "partial", text: "部分", title: fallbackTitle || "该空间部分成功"};
  if (status === "failed" || status === "canceled") {
    return {kind: "todo", text: "可处理", title: fallbackTitle || "该空间未被 403 拉黑，可重试或补分裂"};
  }
  return {kind: "unknown", text: "未知", title: fallbackTitle};
}

export function workspaceStateFromTask(status: string, detailText = ""): WorkspaceDisplayState {
  const title = String(detailText || "").trim();
  if (hasOpenAiUserAlreadyExists(title)) {
    return {kind: "account-exists-cooldown", text: "400冷却", title};
  }
  if (hasMailboxOtpDeliveryTimeout(title)) {
    return {kind: "mailbox-cooldown", text: "收码冷却", title};
  }
  return workspaceStateFromStatus(status, title);
}

export function workspaceStateFromRootGroup(_status: string, _detailText = ""): WorkspaceDisplayState {
  return {kind: "quiet", text: "-", title: "无空间异常"};
}
