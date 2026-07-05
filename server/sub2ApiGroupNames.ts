const LEGACY_GROUP_NAME_REPAIRS: Record<string, string> = {
  "???": "低价区",
  "？？？": "低价区",
};

export function normalizeSub2ApiGroupName(value: unknown): string {
  const name = String(value || "").trim();
  return LEGACY_GROUP_NAME_REPAIRS[name] || name;
}

export function normalizeSub2ApiGroupText(value: unknown): string {
  return String(value || "")
    .split(/[\n,，;；]+/)
    .map(normalizeSub2ApiGroupName)
    .filter(Boolean)
    .join(",");
}
