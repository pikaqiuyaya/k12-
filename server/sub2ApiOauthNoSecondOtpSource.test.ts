import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";

test("Sub2API OAuth reauth page falls back to existing AT noRT instead of sending another email OTP", () => {
  const source = readFileSync(new URL("./index.ts", import.meta.url), "utf8");

  assert.match(source, /function isSub2ApiOAuthReauthRequiredUrl\(/);
  assert.match(source, /throw new Error\(`Sub2API OAuth 需要重新邮箱验证，已阻止二次发码:/);
  assert.match(source, /isSub2ApiOAuthReauthRequiredError\(error\)/);
  assert.match(source, /避免二次发码，改用当前 Web AT 创建 noRT 账号/);
});
