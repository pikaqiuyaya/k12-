import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";

test("dynamic SMSBower launch enqueues each rented mailbox without waiting for the full batch", () => {
  const source = readFileSync(new URL("./index.ts", import.meta.url), "utf8");

  assert.match(source, /async function createSmsBowerMailRecord\(\): Promise<EmailRecord>/);
  assert.doesNotMatch(source, /if \(dynamicGmailMode\) \{[\s\S]{0,220}await createSmsBowerMailRecords\(limit\);/);
  assert.match(
    source,
    /if \(dynamicSmsBowerMode\) \{[\s\S]*?createSmsBowerMailRecord\(\)[\s\S]*?enqueueLaunchEmail\([\s\S]*?await Promise\.all\(\[persistTasks\(\), persistEmails\(\)\]\);[\s\S]*?scheduleTasks\(\);/,
  );
});
