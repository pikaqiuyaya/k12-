export function describeChatGptCallbackError(callbackUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(callbackUrl);
  } catch {
    return null;
  }

  if (!url.pathname.endsWith("/api/auth/callback/openai")) return null;

  const error = url.searchParams.get("error")?.trim();
  if (!error) return null;

  const description = (url.searchParams.get("error_description") || "").replace(/\s+/g, " ").trim();
  return `ChatGPT callback returned ${error}${description ? `: ${description}` : ""}`;
}
