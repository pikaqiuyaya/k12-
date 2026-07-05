export interface OpenAiProxyPoolSelection {
  proxyUrl: string;
  maskedProxyUrl: string;
  index: number;
  total: number;
}

export interface OpenAiProxyPoolSelectionInput {
  poolText?: string;
  currentProxyUrl?: string;
  lastIndex?: number;
}

export interface OpenAiProxyRetryInput {
  enabled: boolean;
  hasPool: boolean;
  isSmsBowerMail: boolean;
  mailboxOtpDeliveryTimeout: boolean;
  attempt: number;
  maxRetries: number;
}

export interface MihonoSubscription {
  name: string;
  url: string;
}

export interface MihonoMappingDisplayRow {
  username: string;
  node: string;
  endpoint: string;
  httpProxyMasked: string;
  ok?: boolean;
  delay?: number;
  error?: string;
}

export interface OpenAiProxyCandidateProbeResult {
  ok: boolean;
  status?: number;
}

export interface OpenAiProxyCandidateTestResult {
  ok: boolean;
  proxyCount: number;
  attempts: number;
  testedProxyMasked?: string;
  status?: number;
  error?: string;
}

export interface MihonoMappingFilterResult {
  rows: MihonoMappingDisplayRow[];
  totalCount: number;
  filteredCount: number;
}

export interface MihonoPublicProxyFilterResult {
  text: string;
  count: number;
  originalCount: number;
  excludedCount: number;
}

export interface OpenAiProxyUsageInput {
  email?: string;
  rootEmail?: string;
  createdAt?: string;
  startedAt?: string;
  updatedAt?: string;
  openAiProxyUrl?: string;
  openAiProxyHistory?: Array<{at?: string; proxyUrl?: string}>;
}

export interface OpenAiProxyUsageMappingRow {
  username: string;
  node: string;
  endpoint?: string;
}

export interface OpenAiProxyUsageSummary {
  label: string;
  maskedProxyUrl: string;
  count: number;
  lastUsedAt: string;
  username?: string;
  node?: string;
  endpoint?: string;
  proxyHost?: string;
}

export function normalizeOpenAiProxyPool(value: unknown): string[] {
  const lines = Array.isArray(value) ? value : String(value || "").split(/\r?\n/);
  const seen = new Set<string>();
  const proxies: string[] = [];
  for (const line of lines) {
    const trimmed = String(line || "").trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const normalized = trimmed.toLowerCase() === "direct" ? "direct" : trimmed;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    proxies.push(normalized);
  }
  return proxies;
}

export function combineOpenAiProxyPoolText(input: {
  mihonoText?: string;
  cachedMihonoText?: string;
  manualText?: string;
}): string {
  return [
    input.mihonoText || input.cachedMihonoText || "",
    input.manualText || "",
  ]
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .join("\n");
}

export function maskProxyUrl(value: unknown): string {
  const raw = String(value || "").trim();
  if (!raw || raw.toLowerCase() === "direct") return "direct";
  try {
    const url = new URL(raw);
    if (url.username) url.username = "***";
    if (url.password) url.password = "***";
    return url.toString();
  } catch {
    return raw.length > 28 ? `${raw.slice(0, 12)}...${raw.slice(-8)}` : raw;
  }
}

function proxyUsageDescriptor(
  value: unknown,
  mappingByUsername?: Map<string, OpenAiProxyUsageMappingRow>,
): Pick<OpenAiProxyUsageSummary, "label" | "username" | "node" | "endpoint" | "proxyHost"> {
  const raw = String(value || "").trim();
  if (!raw || raw.toLowerCase() === "direct") return {label: "direct"};
  try {
    const url = new URL(raw);
    const host = `${url.hostname}${url.port ? `:${url.port}` : ""}`;
    const username = decodeURIComponent(url.username || "");
    const mapped = username ? mappingByUsername?.get(username.toLowerCase()) : undefined;
    const endpoint = mapped?.endpoint || host;
    const label = mapped?.node ? `${mapped.node} @ ${endpoint}` : (username ? `${username}@${host}` : host);
    return {
      label,
      username: username || undefined,
      node: mapped?.node,
      endpoint,
      proxyHost: host,
    };
  } catch {
    return {label: raw.length > 40 ? `${raw.slice(0, 18)}...${raw.slice(-12)}` : raw};
  }
}

function proxyUsageMappingByUsername(rows: OpenAiProxyUsageMappingRow[] = []): Map<string, OpenAiProxyUsageMappingRow> {
  const result = new Map<string, OpenAiProxyUsageMappingRow>();
  for (const row of rows) {
    const username = String(row.username || "").trim();
    const node = String(row.node || "").trim();
    if (!username || !node) continue;
    result.set(username.toLowerCase(), {
      username,
      node,
      endpoint: String(row.endpoint || "").trim() || undefined,
    });
  }
  return result;
}

function dayKey(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export function dailyOpenAiProxyUsage(
  tasks: OpenAiProxyUsageInput[],
  targetEmail: string,
  now = new Date(),
  proxyMappings: OpenAiProxyUsageMappingRow[] = [],
): OpenAiProxyUsageSummary[] {
  const target = String(targetEmail || "").trim().toLowerCase();
  const today = dayKey(now);
  const byLabel = new Map<string, OpenAiProxyUsageSummary>();
  const mappingByUsername = proxyUsageMappingByUsername(proxyMappings);

  for (const task of tasks) {
    const email = String(task.email || "").trim().toLowerCase();
    const rootEmail = String(task.rootEmail || "").trim().toLowerCase();
    if (target && email !== target && rootEmail !== target) continue;

    const history = Array.isArray(task.openAiProxyHistory) ? task.openAiProxyHistory : [];
    const records = history.length
      ? history.map((item) => ({at: item.at || task.startedAt || task.createdAt || task.updatedAt || "", proxyUrl: item.proxyUrl || ""}))
      : [{at: task.startedAt || task.createdAt || task.updatedAt || "", proxyUrl: task.openAiProxyUrl || ""}];

    for (const record of records) {
      const proxyUrl = String(record.proxyUrl || "").trim();
      if (!proxyUrl || proxyUrl.toLowerCase() === "direct") continue;
      const at = String(record.at || "").trim();
      if (!at || dayKey(new Date(at)) !== today) continue;
      const descriptor = proxyUsageDescriptor(proxyUrl, mappingByUsername);
      const existing = byLabel.get(descriptor.label);
      if (existing) {
        existing.count += 1;
        if (at > existing.lastUsedAt) existing.lastUsedAt = at;
      } else {
        byLabel.set(descriptor.label, {
          label: descriptor.label,
          maskedProxyUrl: maskProxyUrl(proxyUrl),
          count: 1,
          lastUsedAt: at,
          username: descriptor.username,
          node: descriptor.node,
          endpoint: descriptor.endpoint,
          proxyHost: descriptor.proxyHost,
        });
      }
    }
  }

  return [...byLabel.values()].sort((a, b) => b.lastUsedAt.localeCompare(a.lastUsedAt));
}

export function describeOpenAiProxyForLog(
  proxyUrl: unknown,
  proxyMappings: OpenAiProxyUsageMappingRow[] = [],
): string {
  const masked = maskProxyUrl(proxyUrl);
  const descriptor = proxyUsageDescriptor(proxyUrl, proxyUsageMappingByUsername(proxyMappings));
  return descriptor.node ? `${masked} (${descriptor.node})` : masked;
}

function indexOfProxy(proxies: string[], currentProxyUrl?: string): number {
  const current = String(currentProxyUrl || "").trim();
  if (!current) return -1;
  const normalized = current.toLowerCase() === "direct" ? "direct" : current;
  return proxies.findIndex((item) => item.toLowerCase() === normalized.toLowerCase());
}

export function nextOpenAiProxyPoolSelection(input: OpenAiProxyPoolSelectionInput): OpenAiProxyPoolSelection | undefined {
  return openAiProxyPoolSelectionSequence(input, 1)[0];
}

export function openAiProxyPoolSelectionSequence(
  input: OpenAiProxyPoolSelectionInput,
  maxCandidates?: number,
): OpenAiProxyPoolSelection[] {
  const proxies = normalizeOpenAiProxyPool(input.poolText);
  if (!proxies.length) return [];
  const currentIndex = Number.isInteger(input.lastIndex)
    ? Number(input.lastIndex)
    : indexOfProxy(proxies, input.currentProxyUrl);
  const total = proxies.length;
  const limit = Math.max(1, Math.min(
    Number.isFinite(maxCandidates ?? total) ? Math.trunc(maxCandidates ?? total) : total,
    total,
  ));
  return Array.from({length: limit}, (_, offset) => {
    const index = ((currentIndex + 1 + offset) % total + total) % total;
    const proxyUrl = proxies[index];
    return {
      proxyUrl,
      maskedProxyUrl: maskProxyUrl(proxyUrl),
      index,
      total,
    };
  });
}

export function shouldRetryWithOpenAiProxyAfterMailboxTimeout(input: OpenAiProxyRetryInput): boolean {
  if (!input.enabled) return false;
  if (!input.hasPool) return false;
  if (input.isSmsBowerMail) return false;
  if (!input.mailboxOtpDeliveryTimeout) return false;
  return Math.max(0, input.attempt) < Math.max(0, input.maxRetries);
}

export function shouldSelectOpenAiProxyPoolForInitialAttempt(input: {
  enabled: boolean;
  hasPool: boolean;
  taskProxyUrl?: string;
}): boolean {
  if (!input.enabled) return false;
  if (!input.hasPool) return false;
  return !String(input.taskProxyUrl || "").trim();
}

export function effectiveOpenAiProxyRetryLimit(configuredMaxRetries: number, proxyCount: number): number {
  return Math.max(0, Math.max(
    Number.isFinite(configuredMaxRetries) ? configuredMaxRetries : 0,
    Number.isFinite(proxyCount) ? proxyCount : 0,
  ));
}

export async function testOpenAiProxyCandidates(
  value: unknown,
  probe: (proxyUrl: string) => Promise<OpenAiProxyCandidateProbeResult>,
  maxCandidates = 8,
): Promise<OpenAiProxyCandidateTestResult> {
  const proxies = normalizeOpenAiProxyPool(value).filter((item) => item && item.toLowerCase() !== "direct");
  if (!proxies.length) return {ok: false, proxyCount: 0, attempts: 0, error: "Mihono public proxy list is empty"};

  const candidates = proxies.slice(0, Math.max(1, maxCandidates));
  let lastMasked = "";
  let lastStatus: number | undefined;
  let lastError = "";
  let attempts = 0;

  for (const proxyUrl of candidates) {
    attempts += 1;
    lastMasked = maskProxyUrl(proxyUrl);
    try {
      const result = await probe(proxyUrl);
      lastStatus = result.status;
      if (result.ok || result.status === 204) {
        return {
          ok: true,
          proxyCount: proxies.length,
          attempts,
          testedProxyMasked: lastMasked,
          status: result.status,
        };
      }
      lastError = result.status ? `HTTP ${result.status}` : "probe returned not ok";
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }

  return {
    ok: false,
    proxyCount: proxies.length,
    attempts,
    testedProxyMasked: lastMasked,
    status: lastStatus,
    error: lastError || "all proxy candidates failed",
  };
}

export function isOpenAiProxyRetryableAuthMessage(value: unknown): boolean {
  const message = value instanceof Error ? value.message : String(value || "");
  const networkRetryable = /(^|[\s:])(fetch failed|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|UND_ERR|socket hang up|network failed|connection reset|connect timeout)([\s:]|$)/i.test(message);
  if (networkRetryable) return true;
  if (/ChatGPT callback returned\s+access_denied|consent[ _-]?verifier[\s\S]*already[\s\S]*used/i.test(message)) return true;
  if (/workspace_id=.*HTTP\s*401|invalid_workspace_selected|no_valid_workspaces/i.test(message)) return false;
  return /完成 ChatGPT callback 失败:\s*HTTP\s*(403|429)|打开 OpenAI authorize 页失败:\s*429|AuthorizeContinue[\s\S]*(?:\b429\b|rate_limit_exceeded)|auth\.openai\.com[\s\S]*HTTP\s*429|OpenAI auth[\s\S]*HTTP\s*429/i.test(message);
}

export function normalizeMihonoProxyPoolApiUrl(value: unknown): string {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const url = new URL(/^https?:\/\//i.test(raw) ? raw : `http://${raw}`);
  if (!url.pathname || url.pathname === "/") {
    url.pathname = "/api/public/proxies";
  }
  if (url.pathname.replace(/\/+$/g, "") === "/api/public/proxies") {
    if (!url.searchParams.get("type")) url.searchParams.set("type", "http");
    url.searchParams.set("format", "text");
  }
  return url.toString();
}

export function normalizeMihonoManagerBaseUrl(value: unknown): string {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const url = new URL(/^https?:\/\//i.test(raw) ? raw : `http://${raw}`);
  return `${url.protocol}//${url.host}`;
}

export function parseMihonoSubscriptionLinks(value: unknown): MihonoSubscription[] {
  const lines = Array.isArray(value) ? value : String(value || "").split(/\r?\n|[;；]+/);
  const subscriptions: MihonoSubscription[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    const trimmed = String(line || "").trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.includes("|") ? "|" : (trimmed.includes("｜") ? "｜" : "");
    const rawName = separator ? trimmed.split(separator, 1)[0]?.trim() || "" : "";
    const rawUrl = separator ? trimmed.slice(trimmed.indexOf(separator) + separator.length).trim() : trimmed;
    if (!rawUrl || seen.has(rawUrl)) continue;
    seen.add(rawUrl);
    subscriptions.push({
      name: rawName || `订阅${subscriptions.length + 1}`,
      url: rawUrl,
    });
  }
  return subscriptions;
}

export function mihonoSubscriptionsToText(value: unknown): string {
  const subscriptions = Array.isArray(value) ? value : [];
  const lines: string[] = [];
  const seen = new Set<string>();
  for (const item of subscriptions) {
    const record = item && typeof item === "object" ? item as Record<string, unknown> : {};
    const name = String(record.name || "").trim();
    const url = String(record.url || "").trim();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    lines.push(name ? `${name}|${url}` : url);
  }
  return lines.join("\n");
}

export function mihonoMappingsToDisplayRows(
  value: unknown,
  host: string,
  publicPort: number,
  speedTests?: Record<string, unknown>,
): MihonoMappingDisplayRow[] {
  const mappings = Array.isArray(value) ? value : [];
  const endpoint = `${host}:${publicPort}`;
  const rows: MihonoMappingDisplayRow[] = [];
  for (const item of mappings) {
    const record = item && typeof item === "object" ? item as Record<string, unknown> : {};
    const username = String(record.username || "").trim();
    const password = String(record.password || "").trim();
    const node = String(record.node || "").trim();
    if (!username || !password || !node) continue;
    const speed = speedTests?.[node];
    const speedRecord = speed && typeof speed === "object" ? speed as Record<string, unknown> : {};
    const delay = Number(speedRecord.delay);
    const row: MihonoMappingDisplayRow = {
      username,
      node,
      endpoint,
      httpProxyMasked: maskProxyUrl(`http://${encodeURIComponent(username)}:${encodeURIComponent(password)}@${endpoint}`),
    };
    if (typeof speedRecord.ok === "boolean") row.ok = speedRecord.ok;
    if (Number.isFinite(delay)) row.delay = delay;
    if (speedRecord.error) row.error = String(speedRecord.error);
    rows.push(row);
  }
  return rows;
}

export function filterMihonoMappingRowsByPublicProxies(
  rows: MihonoMappingDisplayRow[],
  publicProxyText: unknown,
): MihonoMappingFilterResult {
  const usernames = new Set<string>();
  for (const proxyUrl of normalizeOpenAiProxyPool(publicProxyText)) {
    if (proxyUrl.toLowerCase() === "direct") continue;
    try {
      const url = new URL(proxyUrl);
      if (url.username) usernames.add(decodeURIComponent(url.username));
    } catch {
      // Ignore malformed proxy entries; they are not usable public mappings.
    }
  }
  if (!usernames.size) {
    return {rows, totalCount: rows.length, filteredCount: 0};
  }

  const filteredRows = rows.filter((row) => usernames.has(row.username));
  return {
    rows: filteredRows,
    totalCount: rows.length,
    filteredCount: Math.max(0, rows.length - filteredRows.length),
  };
}

export function isMihonoNodeBlockedFromK12ProxyPool(value: unknown): boolean {
  const text = String(value || "");
  return /香港|🇭🇰|\bHK\b|Hong\s*Kong/i.test(text);
}

export function filterMihonoPublicProxyTextByMappings(
  publicProxyText: unknown,
  rows: MihonoMappingDisplayRow[],
): MihonoPublicProxyFilterResult {
  const proxies = normalizeOpenAiProxyPool(publicProxyText);
  const rowByUsername = new Map(rows.map((row) => [row.username, row]));
  const kept: string[] = [];
  let excludedCount = 0;

  for (const proxyUrl of proxies) {
    if (proxyUrl.toLowerCase() === "direct") {
      kept.push(proxyUrl);
      continue;
    }
    try {
      const url = new URL(proxyUrl);
      const username = decodeURIComponent(url.username || "");
      const row = rowByUsername.get(username);
      if (row && isMihonoNodeBlockedFromK12ProxyPool(row.node)) {
        excludedCount += 1;
        continue;
      }
    } catch {
      // Keep malformed custom lines so normalization remains non-destructive.
    }
    kept.push(proxyUrl);
  }

  return {
    text: kept.join("\n"),
    count: kept.length,
    originalCount: proxies.length,
    excludedCount,
  };
}

export function mihonoProxyTextFromMappings(
  value: unknown,
  host: string,
  publicPort: number,
  speedTests?: Record<string, unknown>,
): string {
  const mappings = Array.isArray(value) ? value : [];
  const kept: string[] = [];
  for (const item of mappings) {
    const record = item && typeof item === "object" ? item as Record<string, unknown> : {};
    const username = String(record.username || "").trim();
    const password = String(record.password || "").trim();
    const node = String(record.node || "").trim();
    if (!username || !password || !node) continue;
    if (isMihonoNodeBlockedFromK12ProxyPool(node)) continue;
    const speed = speedTests?.[node];
    const speedRecord = speed && typeof speed === "object" ? speed as Record<string, unknown> : {};
    if (speedRecord.ok === false) continue;
    kept.push(`http://${encodeURIComponent(username)}:${encodeURIComponent(password)}@${host}:${publicPort}`);
  }
  return normalizeOpenAiProxyPool(kept).join("\n");
}

export function mihonoBasicAuthHeader(username: unknown, password: unknown): string {
  const value = `${String(username || "")}:${String(password || "")}`;
  return `Basic ${Buffer.from(value, "utf8").toString("base64")}`;
}
