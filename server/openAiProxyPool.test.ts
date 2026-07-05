import assert from "node:assert/strict";
import {test} from "node:test";

import {
  isOpenAiProxyRetryableAuthMessage,
  maskProxyUrl,
  mihonoBasicAuthHeader,
  normalizeMihonoManagerBaseUrl,
  nextOpenAiProxyPoolSelection,
  normalizeMihonoProxyPoolApiUrl,
  normalizeOpenAiProxyPool,
  parseMihonoSubscriptionLinks,
  mihonoSubscriptionsToText,
  mihonoMappingsToDisplayRows,
  shouldRetryWithOpenAiProxyAfterMailboxTimeout,
  testOpenAiProxyCandidates,
  filterMihonoMappingRowsByPublicProxies,
  filterMihonoPublicProxyTextByMappings,
  isMihonoNodeBlockedFromK12ProxyPool,
  dailyOpenAiProxyUsage,
  effectiveOpenAiProxyRetryLimit,
} from "./openAiProxyPool";

test("normalizes OpenAI proxy pool lines and skips comments", () => {
  assert.deepEqual(normalizeOpenAiProxyPool(`
    # one proxy per line
    direct
    socks5://user:pass@example.com:1080

    http://127.0.0.1:7890
  `), [
    "direct",
    "socks5://user:pass@example.com:1080",
    "http://127.0.0.1:7890",
  ]);
});

test("masks proxy credentials for logs and config responses", () => {
  assert.equal(maskProxyUrl(""), "direct");
  assert.equal(maskProxyUrl("direct"), "direct");
  assert.equal(maskProxyUrl("socks5://user:pass@example.com:1080"), "socks5://***:***@example.com:1080");
});

test("rotates OpenAI proxy pool from current proxy without leaking credentials", () => {
  const selection = nextOpenAiProxyPoolSelection({
    poolText: "direct\nsocks5://user:pass@example.com:1080\nhttp://127.0.0.1:7890",
    currentProxyUrl: "direct",
  });

  assert.deepEqual(selection, {
    proxyUrl: "socks5://user:pass@example.com:1080",
    maskedProxyUrl: "socks5://***:***@example.com:1080",
    index: 1,
    total: 3,
  });
});

test("decides whether mailbox timeout should retry with a rotated proxy", () => {
  assert.equal(shouldRetryWithOpenAiProxyAfterMailboxTimeout({
    enabled: true,
    hasPool: true,
    isSmsBowerMail: false,
    mailboxOtpDeliveryTimeout: true,
    attempt: 0,
    maxRetries: 2,
  }), true);

  assert.equal(shouldRetryWithOpenAiProxyAfterMailboxTimeout({
    enabled: true,
    hasPool: true,
    isSmsBowerMail: false,
    mailboxOtpDeliveryTimeout: true,
    attempt: 2,
    maxRetries: 2,
  }), false);

  assert.equal(shouldRetryWithOpenAiProxyAfterMailboxTimeout({
    enabled: true,
    hasPool: true,
    isSmsBowerMail: true,
    mailboxOtpDeliveryTimeout: true,
    attempt: 0,
    maxRetries: 2,
  }), false);
});

test("uses at least the available proxy pool size as retry limit", () => {
  assert.equal(effectiveOpenAiProxyRetryLimit(2, 28), 28);
  assert.equal(effectiveOpenAiProxyRetryLimit(10, 3), 10);
  assert.equal(effectiveOpenAiProxyRetryLimit(0, 0), 0);
});

test("treats ChatGPT callback HTTP 403 as OpenAI proxy retryable", () => {
  assert.equal(isOpenAiProxyRetryableAuthMessage("完成 ChatGPT callback 失败: HTTP 403"), true);
  assert.equal(isOpenAiProxyRetryableAuthMessage("打开 OpenAI authorize 页失败: 429"), true);
  assert.equal(isOpenAiProxyRetryableAuthMessage("workspace_id=abc HTTP 401"), false);
  assert.equal(isOpenAiProxyRetryableAuthMessage("Sub2API /api/v1/auth/login HTTP 429: Too many requests"), false);
});

test("treats OpenAI fetch network failures as proxy retryable", () => {
  assert.equal(isOpenAiProxyRetryableAuthMessage("fetch failed: read ECONNRESET (ECONNRESET)"), true);
  assert.equal(isOpenAiProxyRetryableAuthMessage("OpenAI network failed: connect ETIMEDOUT"), true);
  assert.equal(isOpenAiProxyRetryableAuthMessage("mailbox_url request timeout after 10000ms"), false);
});

test("treats used ChatGPT callback consent verifier as proxy retryable", () => {
  assert.equal(
    isOpenAiProxyRetryableAuthMessage(
      "ChatGPT callback returned access_denied: The resource owner or authorization server denied the request. The consent verifier has already been used.",
    ),
    true,
  );
});

test("normalizes Mihono manager URL into public proxy text endpoint", () => {
  assert.equal(
    normalizeMihonoProxyPoolApiUrl("http://127.0.0.1:17879"),
    "http://127.0.0.1:17879/api/public/proxies?type=http&format=text",
  );
  assert.equal(
    normalizeMihonoProxyPoolApiUrl("http://127.0.0.1:17879/api/public/proxies?type=socks5"),
    "http://127.0.0.1:17879/api/public/proxies?type=socks5&format=text",
  );
});

test("parses subscription links into Mihono named subscriptions", () => {
  assert.deepEqual(parseMihonoSubscriptionLinks(`
    日本|https://example.com/jp
    https://example.com/hk
    # comment
    新加坡| https://example.com/sg
  `), [
    {name: "日本", url: "https://example.com/jp"},
    {name: "订阅2", url: "https://example.com/hk"},
    {name: "新加坡", url: "https://example.com/sg"},
  ]);
});

test("formats Mihono state subscriptions for the settings textarea", () => {
  assert.equal(mihonoSubscriptionsToText([
    {name: "JP", url: "https://example.com/jp"},
    {name: "", url: "https://example.com/hk"},
    {name: "  ", url: ""},
  ]), "JP|https://example.com/jp\nhttps://example.com/hk");
});

test("formats Mihono mapping rows without exposing proxy passwords", () => {
  const rows = mihonoMappingsToDisplayRows(
    [
      {username: "node001", password: "secret-pass", node: "JP-01"},
      {username: "node002", password: "secret-pass-2", node: "JP-02"},
    ],
    "154.219.123.153",
    17878,
    {
      "JP-01": {ok: true, delay: 113},
      "JP-02": {ok: false, error: "timeout"},
    },
  );

  assert.equal(rows.length, 2);
  assert.equal(rows[0].username, "node001");
  assert.equal(rows[0].endpoint, "154.219.123.153:17878");
  assert.equal(rows[0].httpProxyMasked, "http://***:***@154.219.123.153:17878/");
  assert.equal(rows[0].ok, true);
  assert.equal(rows[0].delay, 113);
  assert.equal(rows[1].ok, false);
  assert.equal(JSON.stringify(rows).includes("secret-pass"), false);
});

test("filters Mihono mapping display rows to public proxy usernames", () => {
  const rows = [
    {username: "node001", node: "JP-01", endpoint: "154.219.123.153:17878", httpProxyMasked: "http://***:***@154.219.123.153:17878/", ok: true},
    {username: "node002", node: "JP-02", endpoint: "154.219.123.153:17878", httpProxyMasked: "http://***:***@154.219.123.153:17878/", ok: false},
    {username: "node003", node: "JP-03", endpoint: "154.219.123.153:17878", httpProxyMasked: "http://***:***@154.219.123.153:17878/"},
  ];

  const result = filterMihonoMappingRowsByPublicProxies(rows, `
    http://node001:secret@154.219.123.153:17878
    http://node003:secret@154.219.123.153:17878
  `);

  assert.deepEqual(result.rows.map((row) => row.username), ["node001", "node003"]);
  assert.equal(result.totalCount, 3);
  assert.equal(result.filteredCount, 1);
});

test("excludes Hong Kong Mihono nodes from the K12 proxy pool", () => {
  const rows = [
    {username: "node001", node: "[订阅1] 🇭🇰 香港W01", endpoint: "154.219.123.153:17878", httpProxyMasked: "http://***:***@154.219.123.153:17878/", ok: true},
    {username: "node002", node: "[订阅1] 🇯🇵 日本W01 | IEPL", endpoint: "154.219.123.153:17878", httpProxyMasked: "http://***:***@154.219.123.153:17878/", ok: true},
    {username: "node003", node: "[订阅1] HK Hong Kong quota", endpoint: "154.219.123.153:17878", httpProxyMasked: "http://***:***@154.219.123.153:17878/", ok: true},
  ];

  assert.equal(isMihonoNodeBlockedFromK12ProxyPool(rows[0].node), true);
  assert.equal(isMihonoNodeBlockedFromK12ProxyPool(rows[1].node), false);
  assert.equal(isMihonoNodeBlockedFromK12ProxyPool(rows[2].node), true);

  const result = filterMihonoPublicProxyTextByMappings(`
    http://node001:secret@154.219.123.153:17878
    http://node002:secret@154.219.123.153:17878
    http://node003:secret@154.219.123.153:17878
  `, rows);

  assert.equal(result.originalCount, 3);
  assert.equal(result.count, 1);
  assert.equal(result.excludedCount, 2);
  assert.match(result.text, /node002/);
  assert.doesNotMatch(result.text, /node001|node003/);
});

test("normalizes Mihono manager base URL and basic auth header", () => {
  assert.equal(normalizeMihonoManagerBaseUrl("127.0.0.1:17879/api/public/proxies?type=http"), "http://127.0.0.1:17879");
  assert.equal(mihonoBasicAuthHeader("admin", "pass"), "Basic YWRtaW46cGFzcw==");
});

test("tests multiple proxy candidates until one succeeds", async () => {
  const attempts: string[] = [];

  const result = await testOpenAiProxyCandidates([
    "direct",
    "http://user:first@example.com:17878",
    "http://user:second@example.com:17878",
    "http://user:third@example.com:17878",
  ], async (proxyUrl) => {
    attempts.push(proxyUrl);
    if (proxyUrl.includes("first")) throw new Error("fetch failed");
    return proxyUrl.includes("second") ? {ok: true, status: 204} : {ok: false, status: 500};
  }, 3);

  assert.deepEqual(attempts, [
    "http://user:first@example.com:17878",
    "http://user:second@example.com:17878",
  ]);
  assert.deepEqual(result, {
    ok: true,
    proxyCount: 3,
    testedProxyMasked: "http://***:***@example.com:17878/",
    status: 204,
    attempts: 2,
  });
});

test("summarizes today's proxy usage without exposing proxy passwords", () => {
  const usage = dailyOpenAiProxyUsage([
    {
      email: "root@gmail.com",
      createdAt: "2026-07-05T01:00:00.000Z",
      openAiProxyHistory: [
        {at: "2026-07-05T01:00:00.000Z", proxyUrl: "http://node002:secret@154.219.123.153:17878"},
        {at: "2026-07-05T02:00:00.000Z", proxyUrl: "http://node002:secret@154.219.123.153:17878"},
      ],
    },
    {
      email: "root@gmail.com",
      createdAt: "2026-07-05T03:00:00.000Z",
      openAiProxyUrl: "socks5://user:pass@10.0.0.2:1080",
    },
    {
      email: "root@gmail.com",
      createdAt: "2026-07-04T23:00:00.000Z",
      openAiProxyUrl: "http://old:secret@10.0.0.3:8080",
    },
    {
      email: "other@gmail.com",
      createdAt: "2026-07-05T04:00:00.000Z",
      openAiProxyUrl: "http://other:secret@10.0.0.4:8080",
    },
  ], "root@gmail.com", new Date("2026-07-05T12:00:00.000Z"), [
    {username: "node002", node: "[JP] Japan W01", endpoint: "154.219.123.153:17878"},
  ]);

  assert.deepEqual(usage.map((item) => ({label: item.label, count: item.count})), [
    {label: "user@10.0.0.2:1080", count: 1},
    {label: "[JP] Japan W01 @ 154.219.123.153:17878", count: 2},
  ]);
  assert.equal(JSON.stringify(usage).includes("secret"), false);
  assert.equal(JSON.stringify(usage).includes("pass"), false);
});
