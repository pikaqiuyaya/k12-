import assert from "node:assert/strict";
import {test} from "node:test";

import {
  openAiLoginRetryDelayMs,
  shouldRetryOpenAiLoginNetworkError,
} from "./openAiLoginRetry";

test("retries transient OpenAI login network failures for the first two attempts", () => {
  assert.equal(shouldRetryOpenAiLoginNetworkError(new Error("fetch failed"), 1, 3), true);
  assert.equal(shouldRetryOpenAiLoginNetworkError("OpenAI network failed: connect ETIMEDOUT", 2, 3), true);
  assert.equal(shouldRetryOpenAiLoginNetworkError("fetch failed", 3, 3), false);
});

test("does not retry OpenAI login business failures", () => {
  assert.equal(shouldRetryOpenAiLoginNetworkError("EmailOtpValidate请求失败: 401 code=wrong_email_otp_code", 1, 3), false);
  assert.equal(shouldRetryOpenAiLoginNetworkError("SMSBower getCode 失败: fetch failed", 1, 3), false);
  assert.equal(shouldRetryOpenAiLoginNetworkError("mailbox code timeout: fetch failed", 1, 3), false);
  assert.equal(shouldRetryOpenAiLoginNetworkError("workspace_id=abc HTTP 401 invalid_workspace_selected", 1, 3), false);
  assert.equal(shouldRetryOpenAiLoginNetworkError("OpenAI 403 codex_workspace_access_denied", 1, 3), false);
});

test("uses short increasing delays between OpenAI login network retries", () => {
  assert.equal(openAiLoginRetryDelayMs(1), 3000);
  assert.equal(openAiLoginRetryDelayMs(2), 6000);
  assert.equal(openAiLoginRetryDelayMs(5), 10000);
});
