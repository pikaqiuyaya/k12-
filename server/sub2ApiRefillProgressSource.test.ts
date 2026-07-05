import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";

test("Sub2API refill publishes progress while deep liveness scan is running", () => {
  const source = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
  const start = source.indexOf("async function runSub2ApiRefill");
  const end = source.indexOf("function sub2ApiAccountK12RepairIssue", start);
  assert.ok(start >= 0 && end > start, "runSub2ApiRefill source block should exist");
  const block = source.slice(start, end);

  assert.match(block, /const publishProgress = \(\) => \{/);
  assert.match(block, /sub2apiRefillLastResult = \{[\s\S]*processedAccounts: deepChecked,[\s\S]*scannedAccounts: basicNormalAccounts\.length/);
  assert.match(block, /if \(shouldPublishAutoAtRepairProgress\(\{[\s\S]*processedAccounts: deepChecked,[\s\S]*totalAccounts: basicNormalAccounts\.length/);
  assert.match(block, /publishProgress\(\);[\s\S]*const deepResults = await mapWithConcurrency/);
});
