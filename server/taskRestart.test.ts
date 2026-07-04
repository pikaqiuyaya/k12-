import assert from "node:assert/strict";
import {test} from "node:test";

import {shouldFailTaskAfterServerRestart} from "./taskRestart";

test("server restart fails only running tasks and keeps queued tasks queued", () => {
  assert.equal(shouldFailTaskAfterServerRestart("running"), true);
  assert.equal(shouldFailTaskAfterServerRestart("queued"), false);
  assert.equal(shouldFailTaskAfterServerRestart("success"), false);
  assert.equal(shouldFailTaskAfterServerRestart("failed"), false);
  assert.equal(shouldFailTaskAfterServerRestart("canceled"), false);
});
