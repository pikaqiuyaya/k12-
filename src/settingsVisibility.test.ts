import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {dirname, join} from "node:path";
import {test} from "node:test";

const here = dirname(fileURLToPath(import.meta.url));

test("shows Gmail fission settings outside SMSBower-only provider config", () => {
  const source = readFileSync(join(here, "App.vue"), "utf8");
  const switchIndex = source.indexOf('v-model="form.smsBowerGmailFissionEnabled"');
  const countIndex = source.indexOf('v-model.number="form.smsBowerGmailFissionCount"');
  assert.notEqual(switchIndex, -1);
  assert.notEqual(countIndex, -1);

  const enclosingSettingsStart = source.lastIndexOf('<section class="settings-section">', switchIndex);
  const lastSmsProviderGateBeforeSwitch = source.lastIndexOf('v-if="form.gmailMailProvider === \'smsbower\'"', switchIndex);
  const lastSmsProviderGateBeforeCount = source.lastIndexOf('v-if="form.gmailMailProvider === \'smsbower\'"', countIndex);

  assert.ok(
    lastSmsProviderGateBeforeSwitch < enclosingSettingsStart,
    "Gmail fission switch should not be inside the SMSBower-only provider block",
  );
  assert.ok(
    lastSmsProviderGateBeforeCount < enclosingSettingsStart,
    "Gmail fission count should not be inside the SMSBower-only provider block",
  );
});

test("renders AT repair tasks in a separate task section", () => {
  const source = readFileSync(join(here, "App.vue"), "utf8");

  assert.match(source, /import \{splitTasksByKind\} from "\.\/taskKind";/);
  assert.match(source, /visibleTasksForWorkspaceIds\(mainTasks\.value, currentWorkspaceIds\(\)\)/);
  assert.match(source, /<h3>补 AT 任务<\/h3>/);
  assert.match(source, /v-for="task in sortedAtRepairTasks"/);
});

test("polls live task data without refreshing the full email pool every tick", () => {
  const source = readFileSync(join(here, "App.vue"), "utf8");

  assert.match(source, /async function refreshLive\(\)[\s\S]*loadSummary\(\)[\s\S]*loadTasks\(\)/);
  assert.doesNotMatch(source, /setInterval\(refreshAll,\s*2500\)/);
  assert.match(source, /setInterval\(refreshLive,\s*2500\)/);
});

test("loads batch summaries and details from dedicated task batch endpoints", () => {
  const source = readFileSync(join(here, "App.vue"), "utf8");

  assert.match(source, /api<any>\("\/api\/tasks\/batches"\)/);
  assert.match(source, /api<any>\(`\/api\/tasks\/batches\/\$\{encodeURIComponent\(batchId\)\}\?limit=500`\)/);
  assert.doesNotMatch(source, /summarizeLaunchBatches\(tasks\.value\)/);
});

test("initial page load uses the lightweight live refresh instead of loading the full email pool", () => {
  const source = readFileSync(join(here, "App.vue"), "utf8");

  assert.match(source, /onMounted\(async \(\) => \{[\s\S]*Promise\.all\(\[refreshLive\(\), refreshSmsBowerAccountQuietly\(\)\]\)/);
  assert.doesNotMatch(source, /onMounted\(async \(\) => \{[\s\S]*Promise\.all\(\[refreshAll\(\), refreshSmsBowerAccountQuietly\(\)\]\)/);
});
