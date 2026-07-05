import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";

const source = readFileSync("server/index.ts", "utf8");

test("SMSBower API requests use an explicit direct dispatcher instead of the OpenAI global proxy", () => {
  assert.match(source, /const directSmsBowerDispatcher = new Agent\(\)/);
  assert.match(source, /undiciFetch\(url,\s*\{signal: controller\.signal,\s*dispatcher: directSmsBowerDispatcher\}\)/);
  assert.doesNotMatch(source, /requestSmsBowerMail[\s\S]*?const response = await fetch\(url/);
  assert.doesNotMatch(source, /requestSmsBowerHandler[\s\S]*?const response = await fetch\(url/);
});
