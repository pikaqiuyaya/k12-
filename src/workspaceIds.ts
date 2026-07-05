export function parseWorkspaceIds(value: string): string[] {
  return String(value || "")
    .split(/[\n,;，；]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function dedupeWorkspaceIds(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const trimmed = String(value || "").trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }
  return result;
}
