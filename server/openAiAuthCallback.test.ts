import assert from "node:assert/strict";
import test from "node:test";

import {describeChatGptCallbackError} from "./openAiAuthCallback";

test("describes ChatGPT callback query errors before fetching callback", () => {
  const message = describeChatGptCallbackError(
    "https://chatgpt.com/api/auth/callback/openai?error=access_denied&error_description=The+resource+owner+or+authorization+server+denied+the+request.+The+consent+verifier+has+already+been+used.&state=abc",
  );

  assert.equal(
    message,
    "ChatGPT callback returned access_denied: The resource owner or authorization server denied the request. The consent verifier has already been used.",
  );
});

test("ignores normal ChatGPT callback URLs that contain an auth code", () => {
  assert.equal(
    describeChatGptCallbackError("https://chatgpt.com/api/auth/callback/openai?code=ac_123&state=abc"),
    null,
  );
});
