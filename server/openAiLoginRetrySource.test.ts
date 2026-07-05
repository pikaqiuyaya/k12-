import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";

test("ChatGPT web login retries transient network failures before failing the task", () => {
  const source = readFileSync(new URL("./index.ts", import.meta.url), "utf8");

  assert.match(source, /shouldRetryOpenAiLoginNetworkError/);
  assert.match(source, /async function loginChatGptWebAndGetAccessToken\(/);
  assert.match(source, /async function loginChatGptWebAndGetAccessTokenOnce\(/);
  assert.match(
    source,
    /shouldRetryOpenAiLoginNetworkError\(error,\s*attempt,\s*maxAttempts\)[\s\S]*?OpenAI 登录网络失败，等待/,
  );
});
