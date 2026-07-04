import assert from "node:assert/strict";
import {test} from "node:test";

import {isMissingChatGptAccessTokenError} from "./chatGptSession";

test("detects ChatGPT session payloads that are missing accessToken", () => {
  assert.equal(isMissingChatGptAccessTokenError(
    'ChatGPT session 中缺少 accessToken: {"WARNING_BANNER":"DO NOT SHARE"}',
  ), true);
  assert.equal(isMissingChatGptAccessTokenError(new Error("missing accessToken in session")), true);
  assert.equal(isMissingChatGptAccessTokenError("获取 ChatGPT accessToken 失败: HTTP 401"), false);
});
