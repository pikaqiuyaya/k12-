import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";

test("task logs the effective OpenAI proxy even when using the default local proxy", () => {
  const source = readFileSync(new URL("./index.ts", import.meta.url), "utf8");

  assert.match(source, /async function openAiProxyRoundLogLabel/);
  assert.match(source, /本轮 OpenAI 代理: \$\{await openAiProxyRoundLogLabel\(task\)\}/);
  assert.doesNotMatch(source, /if \(task\.openAiProxyUrl\) appendLog\(task, "info", `本轮 OpenAI 代理:/);
});
