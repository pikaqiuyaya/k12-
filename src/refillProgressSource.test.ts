import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";

test("refill card shows running scan progress when the backend reports it", () => {
  const source = readFileSync(new URL("./App.vue", import.meta.url), "utf8");

  assert.match(source, /const refillNormalText = computed\(\(\) => \{/);
  assert.match(source, /result\?\.processedAccounts/);
  assert.match(source, /result\?\.scannedAccounts/);
  assert.match(source, /<strong>\{\{ refillNormalText \}\}<\/strong>/);
});
