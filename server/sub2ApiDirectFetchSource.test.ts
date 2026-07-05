import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";

test("Sub2API admin requests use an explicit direct dispatcher instead of the OpenAI global proxy", () => {
  const source = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
  const start = source.indexOf("async function requestSub2ApiJson");
  const end = source.indexOf("async function loginSub2ApiAdmin", start);
  assert.ok(start >= 0 && end > start, "requestSub2ApiJson source block should exist");
  const block = source.slice(start, end);

  assert.match(source, /const directSub2ApiDispatcher = new Agent\(\)/);
  assert.match(block, /undiciFetch\(`\$\{origin\}\$\{pathname\}`,\s*\{[\s\S]*dispatcher: directSub2ApiDispatcher/);
  assert.doesNotMatch(block, /await fetch\(/);
});
