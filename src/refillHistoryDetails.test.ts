import assert from "node:assert/strict";
import {test} from "node:test";

import {
  refillHistoryDetailLines,
  refillHistoryPreviewText,
} from "./refillHistoryDetails";

test("history detail lines include full message, error, and samples without duplicates", () => {
  const lines = refillHistoryDetailLines({
    message: "scan finished",
    error: "scan finished",
    samples: ["a failed", "b failed", "a failed"],
  });

  assert.deepEqual(lines, ["scan finished", "a failed", "b failed"]);
});

test("history preview uses short message before samples", () => {
  assert.equal(refillHistoryPreviewText({
    message: "m".repeat(100),
    samples: ["sample text"],
  }, 24), `${"m".repeat(24)}...`);

  assert.equal(refillHistoryPreviewText({
    samples: ["sample only"],
  }), "sample only");
});
