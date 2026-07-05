import assert from "node:assert/strict";
import {test} from "node:test";

import {
  normalizeSub2ApiGroupName,
  normalizeSub2ApiGroupText,
} from "./sub2ApiGroupNames";

test("repairs the legacy low-price group name that was saved as question marks", () => {
  assert.equal(normalizeSub2ApiGroupName("???"), "低价区");
  assert.equal(normalizeSub2ApiGroupText("GPTFREE,???"), "GPTFREE,低价区");
});

test("keeps ordinary Sub2API group names unchanged", () => {
  assert.equal(normalizeSub2ApiGroupName("GPTFREE"), "GPTFREE");
  assert.equal(normalizeSub2ApiGroupText("GPTFREE,低价区"), "GPTFREE,低价区");
});
