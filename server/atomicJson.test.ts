import assert from "node:assert/strict";
import {mkdtemp, readdir, readFile, rm} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {test} from "node:test";

import {writeJsonAtomic} from "./atomicJson";

test("atomic JSON writes leave a parseable file after concurrent writers", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "k12-atomic-json-"));
  const file = path.join(dir, "config.json");
  try {
    await Promise.all(Array.from({length: 25}, (_, index) => (
      writeJsonAtomic(file, {
        index,
        payload: "x".repeat(2048),
      })
    )));

    const raw = await readFile(file, "utf8");
    assert.match(raw, /\n$/);
    assert.doesNotThrow(() => JSON.parse(raw));

    const leftovers = (await readdir(dir)).filter((item) => item.includes(".tmp"));
    assert.deepEqual(leftovers, []);
  } finally {
    await rm(dir, {recursive: true, force: true});
  }
});
