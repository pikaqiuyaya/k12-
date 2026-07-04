export function isMissingChatGptAccessTokenError(value: unknown): boolean {
  const message = value instanceof Error ? value.message : String(value || "");
  return /ChatGPT session 中缺少 accessToken|missing accessToken|缺少 accessToken/i.test(message);
}
