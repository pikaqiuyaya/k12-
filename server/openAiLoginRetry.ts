const OPENAI_LOGIN_NETWORK_RETRY_MAX_DELAY_MS = 10_000;

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value || "");
}

export function shouldRetryOpenAiLoginNetworkError(error: unknown, attempt: number, maxAttempts: number): boolean {
  if (attempt >= maxAttempts) return false;
  const message = errorMessage(error);
  if (/SMSBower|mailbox|邮箱|验证码|EmailOtpValidate|wrong_email_otp_code/i.test(message)) return false;
  return /(^|[\s:])(fetch failed|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|UND_ERR|socket hang up|network failed|connection reset|connect timeout|request timeout after \d+ms)([\s:]|$)/i.test(message);
}

export function openAiLoginRetryDelayMs(attempt: number): number {
  const normalizedAttempt = Math.max(1, Math.trunc(Number(attempt) || 1));
  return Math.min(OPENAI_LOGIN_NETWORK_RETRY_MAX_DELAY_MS, normalizedAttempt * 3000);
}
