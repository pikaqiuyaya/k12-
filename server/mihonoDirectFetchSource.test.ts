import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";

const source = readFileSync("server/index.ts", "utf8");

test("Mihono manager fetches use an explicit direct dispatcher instead of the global OpenAI proxy dispatcher", () => {
  assert.match(source, /const directMihonoDispatcher = new Agent\(\)/);
  assert.match(source, /undiciFetch\(`\$\{baseUrl\}\/api\/state`,\s*\{[\s\S]*dispatcher: directMihonoDispatcher/);
  assert.match(source, /undiciFetch\(apiUrl,\s*\{[\s\S]*dispatcher: directMihonoDispatcher/);
  assert.match(source, /undiciFetch\(`\$\{baseUrl\}\$\{pathname\}`,\s*\{[\s\S]*dispatcher: directMihonoDispatcher/);
});
