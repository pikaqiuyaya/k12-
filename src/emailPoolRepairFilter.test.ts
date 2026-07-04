import assert from "node:assert/strict";
import {test} from "node:test";

import {
  isK12RepairNeededResult,
  mergeK12RepairScanResults,
  type EmailPoolRepairCheckResult,
} from "./emailPoolRepairFilter";

test("K12 repair filter only accepts explicit K12 repair failures", () => {
  assert.equal(isK12RepairNeededResult(undefined), false);
  assert.equal(isK12RepairNeededResult({ok: true, issue: "k12-plan-mismatch"}), false);
  assert.equal(isK12RepairNeededResult({ok: false, issue: "liveness-failed"}), false);
  assert.equal(isK12RepairNeededResult({ok: false, message: "Sub2API 未找到账号"}), false);
  assert.equal(isK12RepairNeededResult({ok: false, issue: "k12-plan-mismatch"}), true);
  assert.equal(isK12RepairNeededResult({ok: false, issue: "sub2api-k12-status-error"}), true);
});

test("K12 repair scan replaces stale scanned results and keeps unrelated results", () => {
  const existing: Record<string, EmailPoolRepairCheckResult> = {
    stale: {emailId: "stale", ok: false, issue: "k12-plan-mismatch"},
    other: {emailId: "other", ok: false, issue: "k12-plan-mismatch"},
  };

  const merged = mergeK12RepairScanResults(existing, ["stale", "fresh"], [
    {emailId: "fresh", ok: false, issue: "sub2api-k12-status-error"},
    {emailId: "ignored", ok: false, issue: "liveness-failed"},
    {emailId: "ok", ok: true, issue: "k12-plan-mismatch"},
  ]);

  assert.equal(merged.stale, undefined);
  assert.deepEqual(merged.other, existing.other);
  assert.equal(merged.fresh?.issue, "sub2api-k12-status-error");
  assert.equal(merged.ignored, undefined);
  assert.equal(merged.ok, undefined);
});
