import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";

test("SMSBower fission continues until activation code limit instead of a configured fixed count", () => {
  const source = readFileSync(new URL("./index.ts", import.meta.url), "utf8");

  assert.doesNotMatch(source, /const childrenPerRoot = appConfig\.smsBowerGmailFissionEnabled/);
  assert.doesNotMatch(source, /smsBowerFissionChildrenRemaining: childrenPerRoot/);
  assert.doesNotMatch(source, /task\.smsBowerFissionRemainingAfterThis \|\| 0\) <= 0/);
  assert.match(source, /SMSBower activation=\$\{root\.smsBowerMailId \|\| "-"\} 验证码次数已达上限/);
});

test("SMSBower batch replacement skip log is only evaluated after a failed mailbox is replaceable", () => {
  const source = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
  const start = source.indexOf("async function enqueueReplacementSmsBowerMailTask");
  assert.ok(start >= 0);
  const end = source.indexOf("\ntype TaskCreateSkipReason", start);
  assert.ok(end > start);
  const body = source.slice(start, end);

  assert.ok(body.indexOf("shouldAutoReplaceSmsBowerMailFailure") < body.indexOf("shouldEnqueueSmsBowerBatchReplacement"));
});
