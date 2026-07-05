import assert from "node:assert/strict";
import {test} from "node:test";

import {dedupeWorkspaceIds, parseWorkspaceIds} from "./workspaceIds";

test("parses workspace ids from mixed separators", () => {
  assert.deepEqual(parseWorkspaceIds(" a\nb, c；d，e "), ["a", "b", "c", "d", "e"]);
});

test("deduplicates workspace ids case-insensitively while preserving order", () => {
  assert.deepEqual(dedupeWorkspaceIds(["A", "b", "a", "B", "c"]), ["A", "b", "c"]);
});
