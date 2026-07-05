import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";

test("task proxy selection probes ChatGPT before using a pool node", () => {
  const source = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
  const retryStart = source.indexOf("async function requeueTaskWithNextOpenAiProxyIfPossible");
  const initialStart = source.indexOf("async function selectOpenAiProxyPoolForInitialAttempt");
  const cooldownStart = source.indexOf("function poolMailboxOtpCooldownDelayMs", initialStart);
  assert.ok(retryStart >= 0 && initialStart > retryStart && cooldownStart > initialStart, "proxy selection blocks should exist");

  const retryBlock = source.slice(retryStart, initialStart);
  const initialBlock = source.slice(initialStart, cooldownStart);

  assert.match(source, /async function probeOpenAiProxyForChatGpt/);
  assert.match(source, /async function selectReachableOpenAiProxyPoolSelection/);
  assert.match(retryBlock, /selectReachableOpenAiProxyPoolSelection\(/);
  assert.match(initialBlock, /selectReachableOpenAiProxyPoolSelection\(/);
  assert.doesNotMatch(retryBlock, /const selection = nextOpenAiProxyPoolSelection\(/);
  assert.doesNotMatch(initialBlock, /const selection = nextOpenAiProxyPoolSelection\(/);
});

test("settings proxy pool test uses the same ChatGPT probe as tasks", () => {
  const source = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
  const start = source.indexOf("async function testMihonoProxyPoolForSettings");
  const end = source.indexOf("async function probeOpenAiProxyForChatGpt", start);
  assert.ok(start >= 0 && end > start, "settings proxy test block should exist");
  const block = source.slice(start, end);

  assert.match(block, /return testOpenAiProxyCandidates\(text,\s*probeOpenAiProxyForChatGpt,\s*8\)/);
  assert.doesNotMatch(block, /generate_204|gstatic/);
});
