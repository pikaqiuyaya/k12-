import assert from "node:assert/strict";
import {test} from "node:test";

import {
  blockedWorkspaceReason,
  emailWorkspaceBlockReason,
  isWorkspaceBlocked,
  upsertWorkspaceBlock,
  workspaceBlockKey,
  type WorkspaceBlockRecord,
} from "./workspaceBlocklist";

test("workspace block keys are case-insensitive by mother email and workspace", () => {
  assert.equal(
    workspaceBlockKey("Root@Gmail.com ", " FF598C4D-CCAF-40C1-BFAA-CB94565764B1 "),
    "root|root@gmail.com|ff598c4d-ccaf-40c1-bfaa-cb94565764b1",
  );
  assert.equal(
    workspaceBlockKey("Root+Child@Gmail.com ", " FF598C4D-CCAF-40C1-BFAA-CB94565764B1 ", "email"),
    "email|root+child@gmail.com|ff598c4d-ccaf-40c1-bfaa-cb94565764b1",
  );
});

test("blocks only the same mother email and workspace", () => {
  let blocks: WorkspaceBlockRecord[] = [];
  const inserted = upsertWorkspaceBlock(blocks, {
    rootEmail: "root@gmail.com",
    workspaceId: "workspace-a",
    reason: "OpenAI 403 workspace access denied",
    at: "2026-07-05T00:00:00.000Z",
    source: "sub2api-liveness",
  });
  blocks = inserted.blocks;

  assert.equal(inserted.changed, true);
  assert.equal(isWorkspaceBlocked(blocks, "ROOT@gmail.com", ["workspace-a"]), true);
  assert.equal(isWorkspaceBlocked(blocks, "root@gmail.com", ["workspace-b"]), false);
  assert.equal(isWorkspaceBlocked(blocks, "other@gmail.com", ["workspace-a"]), false);
  assert.match(blockedWorkspaceReason(blocks, "root@gmail.com", ["workspace-a"]), /403/);
});

test("updates an existing mother workspace block without duplicating it", () => {
  let blocks: WorkspaceBlockRecord[] = [];
  blocks = upsertWorkspaceBlock(blocks, {
    rootEmail: "root@gmail.com",
    workspaceId: "workspace-a",
    reason: "old",
    at: "2026-07-05T00:00:00.000Z",
  }).blocks;
  blocks = upsertWorkspaceBlock(blocks, {
    rootEmail: "ROOT@gmail.com",
    workspaceId: "WORKSPACE-A",
    reason: "new",
    at: "2026-07-05T00:01:00.000Z",
    accountName: "root@gmail.com--noRT--ws-workspace-a",
  }).blocks;

  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].reason, "new");
  assert.equal(blocks[0].createdAt, "2026-07-05T00:00:00.000Z");
  assert.equal(blocks[0].updatedAt, "2026-07-05T00:01:00.000Z");
  assert.equal(blocks[0].accountName, "root@gmail.com--noRT--ws-workspace-a");
});

test("email scoped workspace blocks do not block the mother or sibling aliases", () => {
  let blocks: WorkspaceBlockRecord[] = [];
  blocks = upsertWorkspaceBlock(blocks, {
    rootEmail: "mother+bad@gmail.com",
    workspaceId: "workspace-a",
    reason: "OpenAI 403 workspace access denied",
    at: "2026-07-05T00:00:00.000Z",
    scope: "email",
  }).blocks;

  assert.equal(isWorkspaceBlocked(blocks, "mother+bad@gmail.com", ["workspace-a"], "email"), true);
  assert.equal(isWorkspaceBlocked(blocks, "mother@gmail.com", ["workspace-a"], "email"), false);
  assert.equal(isWorkspaceBlocked(blocks, "mother+ok@gmail.com", ["workspace-a"], "email"), false);
  assert.equal(isWorkspaceBlocked(blocks, "mother@gmail.com", ["workspace-a"]), false);
  assert.match(blockedWorkspaceReason(blocks, "mother+bad@gmail.com", ["workspace-a"], "email"), /403/);
});

test("business lookups only treat the exact email workspace as dead", () => {
  let blocks: WorkspaceBlockRecord[] = [];
  blocks = upsertWorkspaceBlock(blocks, {
    rootEmail: "mother@gmail.com",
    workspaceId: "workspace-a",
    reason: "legacy root block",
    at: "2026-07-05T00:00:00.000Z",
  }).blocks;
  blocks = upsertWorkspaceBlock(blocks, {
    rootEmail: "mother+bad@gmail.com",
    workspaceId: "workspace-a",
    reason: "child 403",
    at: "2026-07-05T00:01:00.000Z",
    scope: "email",
  }).blocks;

  assert.equal(emailWorkspaceBlockReason(blocks, "mother+bad@gmail.com", ["workspace-a"]), "child 403");
  assert.equal(emailWorkspaceBlockReason(blocks, "mother+ok@gmail.com", ["workspace-a"]), "");
  assert.equal(emailWorkspaceBlockReason(blocks, "mother@gmail.com", ["workspace-a"]), "");
});
