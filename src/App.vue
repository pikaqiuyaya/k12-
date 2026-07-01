<template>
  <main class="page">
    <div class="orb orb-one"></div>
    <div class="orb orb-two"></div>

    <header class="hero shell">
      <div>
        <p class="eyebrow">K12 Space Automation</p>
        <h1>邮箱取 AT，K12 入空间，Sub2API 入库</h1>
        <p class="subtitle">
          单页控制台：导入邮箱、设置 K12 空间 ID、保存 Sub2API 配置，然后排队执行登录取 AT、workspace request/accept 和 k12 分组入库。
        </p>
      </div>
      <div class="hero-actions">
        <button class="ghost" @click="refreshAll">刷新</button>
        <button class="primary" :disabled="!emails.length || busy" @click="startTasks">
          {{ busy ? "运行中" : "启动流程" }}
        </button>
      </div>
    </header>

    <section class="stats">
      <article class="stat-card">
        <span>邮箱池</span>
        <strong>{{ summary.emails.total }}</strong>
        <small>可用 {{ summary.emails.free }} / 失败 {{ summary.emails.failed }}</small>
      </article>
      <article class="stat-card glow">
        <span>任务</span>
        <strong>{{ summary.tasks.total }}</strong>
        <small>运行 {{ summary.tasks.running }} / 队列 {{ summary.tasks.queued }}</small>
      </article>
      <article class="stat-card">
        <span>成功</span>
        <strong>{{ summary.tasks.success }}</strong>
        <small>Sub2API 分组：{{ form.sub2apiGroupName || "k12" }}</small>
      </article>
      <article class="stat-card">
        <span>K12 Space</span>
        <strong>{{ workspaceCount }}</strong>
        <small>{{ form.route === "accept" ? "Accept" : "Request" }} 模式</small>
      </article>
    </section>

    <section class="layout">
      <div class="left-col">
        <section class="panel import-panel">
          <div class="section-head">
            <div>
              <p class="eyebrow">Step 1</p>
              <h2>邮箱导入</h2>
            </div>
            <button class="ghost small" @click="sampleEmails">示例</button>
          </div>
          <textarea
            v-model="emailText"
            placeholder="支持：
email----password----clientId----refreshToken
email-----http://mail-api/api/GetLastEmails?email=..."
          ></textarea>
          <div class="row spread">
            <label class="field inline">
              <span>接码 API 域名</span>
              <input v-model="form.mailApiBaseUrl" placeholder="http://wremail.cc/" />
            </label>
            <button class="primary" :disabled="!emailText.trim()" @click="importEmails">导入邮箱</button>
          </div>
          <pre v-if="importResult">{{ importResult }}</pre>
        </section>

        <section class="panel">
          <div class="section-head">
            <div>
              <p class="eyebrow">Step 2</p>
              <h2>K12 空间脚本</h2>
            </div>
            <span class="pill">{{ workspaceCount }} 个 workspace</span>
          </div>
          <label class="field">
            <span>K12 Workspace ID（一行一个或逗号分隔）</span>
            <textarea v-model="workspaceText" class="workspace-box"></textarea>
          </label>
          <div class="switch-grid">
            <label class="switch-card">
              <input v-model="form.runWorkspaceJoin" type="checkbox" />
              <span>
                <strong>执行 K12 空间脚本</strong>
                <small>使用获取到的 AT 调用 /backend-api/accounts/:id/invites/request 或 accept</small>
              </span>
            </label>
            <label class="switch-card">
              <input v-model="form.runSub2Api" type="checkbox" />
              <span>
                <strong>执行 Sub2API 入库</strong>
                <small>只拿邮箱 OA 到 Sub2API 的流程，分组默认 k12</small>
              </span>
            </label>
          </div>
          <div class="compact-grid">
            <label class="field">
              <span>动作</span>
              <select v-model="form.route">
                <option value="request">Request 申请加入</option>
                <option value="accept">Accept 接受邀请</option>
              </select>
            </label>
            <label class="field">
              <span>并发</span>
              <input v-model.number="form.taskConcurrency" type="number" min="1" max="10" />
            </label>
            <label class="field">
              <span>间隔 ms</span>
              <input v-model.number="form.joinIntervalMs" type="number" min="0" />
            </label>
          </div>
        </section>
      </div>

      <aside class="right-col">
        <section class="panel config-panel">
          <div class="section-head">
            <div>
              <p class="eyebrow">Step 3</p>
              <h2>Sub2API 配置</h2>
            </div>
            <button class="ghost small" @click="saveConfig">保存配置</button>
          </div>
          <div class="config-grid">
            <label class="field">
              <span>Sub2API 地址</span>
              <input v-model="form.sub2apiUrl" placeholder="https://your-sub2api" />
            </label>
            <label class="field">
              <span>账号</span>
              <input v-model="form.sub2apiEmail" placeholder="admin@example.com" />
            </label>
            <label class="field">
              <span>密码</span>
              <input v-model="form.sub2apiPassword" type="password" :placeholder="passwordPlaceholder" />
            </label>
            <label class="field">
              <span>分组</span>
              <input v-model="form.sub2apiGroupName" placeholder="k12" />
            </label>
            <label class="field">
              <span>默认 OpenAI 代理</span>
              <input v-model="form.defaultProxyUrl" placeholder="direct 或 http://127.0.0.1:7897" />
            </label>
            <label class="field">
              <span>Token 输出文件</span>
              <input v-model="form.tokenOut" />
            </label>
          </div>
        </section>

        <section class="panel action-panel">
          <div class="section-head">
            <div>
              <p class="eyebrow">Launch</p>
              <h2>执行范围</h2>
            </div>
          </div>
          <label class="field">
            <span>本次处理数量</span>
            <input v-model.number="runCount" type="number" min="1" />
          </label>
          <div class="launch-card">
            <div>
              <strong>{{ selectedReadyCount }} 个邮箱可执行</strong>
              <small>会按邮箱池顺序创建任务，运行日志会在右下方实时刷新。</small>
            </div>
            <button class="primary big" :disabled="!selectedReadyCount || busy" @click="startTasks">
              启动 K12 流程
            </button>
          </div>
          <p class="hint">配置默认从 <code>F:\ai-work\codex-phone-at-bundle\codex_register\config.json</code> 读取，保存后写入本项目 data/config.json。</p>
        </section>
      </aside>
    </section>

    <section class="tables">
      <article class="panel">
        <div class="section-head">
          <div>
            <p class="eyebrow">Pool</p>
            <h2>邮箱池</h2>
          </div>
          <button class="ghost small" @click="loadEmails">刷新邮箱</button>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>邮箱</th>
                <th>状态</th>
                <th>接码</th>
                <th>Sub2API</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in emails" :key="item.id">
                <td class="mono">{{ item.email }}</td>
                <td><span :class="['status', item.status]">{{ statusText(item.status) }}</span></td>
                <td class="muted clipped">{{ item.mailboxUrlMasked }}</td>
                <td class="mono clipped">{{ item.sub2apiAccount || "-" }}</td>
                <td><button class="danger small" @click="deleteEmail(item.id)">删除</button></td>
              </tr>
              <tr v-if="!emails.length">
                <td colspan="5" class="empty">还没有邮箱，先在上方导入。</td>
              </tr>
            </tbody>
          </table>
        </div>
      </article>

      <article class="panel">
        <div class="section-head">
          <div>
            <p class="eyebrow">Tasks</p>
            <h2>任务流水</h2>
          </div>
          <button class="ghost small" @click="loadTasks">刷新任务</button>
        </div>
        <div class="task-list">
          <button
            v-for="task in tasks"
            :key="task.id"
            :class="['task-card', { active: selectedTask?.id === task.id }]"
            @click="selectTask(task)"
          >
            <span :class="['status', task.status]">{{ statusText(task.status) }}</span>
            <strong>{{ task.email }}</strong>
            <small>{{ task.route }} / AT {{ task.accessTokenPreview || "pending" }}</small>
          </button>
          <div v-if="!tasks.length" class="empty">暂无任务。</div>
        </div>
      </article>
    </section>

    <section v-if="selectedTask" class="panel log-panel">
      <div class="section-head">
        <div>
          <p class="eyebrow">Logs</p>
          <h2>{{ selectedTask.email }}</h2>
        </div>
        <button v-if="selectedTask.status === 'queued' || selectedTask.status === 'running'" class="danger small" @click="cancelTask(selectedTask.id)">
          取消任务
        </button>
      </div>
      <div class="result-grid">
        <div class="mini-result">
          <span>AT</span>
          <strong>{{ selectedTask.accessTokenPreview || "-" }}</strong>
        </div>
        <div class="mini-result">
          <span>Sub2API</span>
          <strong>{{ selectedTask.sub2apiAccount || "-" }}</strong>
        </div>
        <div class="mini-result">
          <span>K12 成功</span>
          <strong>{{ selectedTask.workspaceResults.filter((r) => r.ok).length }}/{{ selectedTask.workspaceIds.length }}</strong>
        </div>
      </div>
      <ol class="logs">
        <li v-for="(log, index) in selectedTask.logs" :key="index" :class="log.level">
          <time>{{ fmtTime(log.at) }}</time>
          <span>{{ log.message }}</span>
        </li>
      </ol>
    </section>

    <div v-if="toast" class="toast">{{ toast }}</div>
  </main>
</template>

<script setup lang="ts">
import {computed, onMounted, onUnmounted, reactive, ref} from "vue";

interface EmailItem {
  id: string;
  email: string;
  status: string;
  mailboxUrlMasked: string;
  sub2apiAccount?: string;
}

interface TaskItem {
  id: string;
  email: string;
  status: string;
  route: string;
  accessTokenPreview?: string;
  sub2apiAccount?: string;
  workspaceIds: string[];
  workspaceResults: Array<{ok: boolean}>;
  logs: Array<{at: string; level: string; message: string}>;
}

const defaultSummary = {
  emails: {total: 0, free: 0, running: 0, success: 0, failed: 0},
  tasks: {total: 0, queued: 0, running: 0, success: 0, failed: 0, canceled: 0},
};

const summary = reactive(JSON.parse(JSON.stringify(defaultSummary)));
const emails = ref<EmailItem[]>([]);
const tasks = ref<TaskItem[]>([]);
const selectedTask = ref<TaskItem | null>(null);
const emailText = ref("");
const importResult = ref("");
const workspaceText = ref("");
const runCount = ref(1);
const toast = ref("");
let timer: number | undefined;

const form = reactive({
  defaultPassword: "",
  defaultProxyUrl: "",
  mailApiBaseUrl: "",
  workspaceIds: [] as string[],
  route: "request",
  joinIntervalMs: 1500,
  taskConcurrency: 1,
  runWorkspaceJoin: true,
  runSub2Api: true,
  sub2apiUrl: "",
  sub2apiEmail: "",
  sub2apiPassword: "",
  sub2apiGroupName: "k12",
  sub2apiProxyName: "",
  sub2apiAccountPriority: 1,
  sub2apiConcurrency: 10,
  tokenOut: "",
});

const busy = computed(() => summary.tasks.running > 0 || summary.tasks.queued > 0);
const workspaceCount = computed(() => parseWorkspaceIds(workspaceText.value).length);
const selectedReadyCount = computed(() => Math.min(Math.max(1, Number(runCount.value) || 1), emails.value.filter((item) => item.status !== "running").length));
const passwordPlaceholder = computed(() => form.sub2apiPassword ? "已填写" : "留空则不修改已保存密码");

async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(options.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

function showToast(message: string) {
  toast.value = message;
  window.setTimeout(() => {
    if (toast.value === message) toast.value = "";
  }, 2600);
}

function parseWorkspaceIds(value: string): string[] {
  return String(value || "")
    .split(/[\n,;，；]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

async function loadSummary() {
  const data = await api<any>("/api/summary");
  Object.assign(summary.emails, data.emails || defaultSummary.emails);
  Object.assign(summary.tasks, data.tasks || defaultSummary.tasks);
}

async function loadConfig() {
  const data = await api<any>("/api/config");
  const config = data.config || {};
  Object.assign(form, {
    defaultProxyUrl: config.defaultProxyUrl || "",
    mailApiBaseUrl: config.mailApiBaseUrl || "",
    workspaceIds: config.workspaceIds || [],
    route: config.route || "request",
    joinIntervalMs: config.joinIntervalMs || 1500,
    taskConcurrency: config.taskConcurrency || 1,
    runWorkspaceJoin: config.runWorkspaceJoin !== false,
    runSub2Api: config.runSub2Api !== false,
    sub2apiUrl: config.sub2apiUrl || "",
    sub2apiEmail: config.sub2apiEmail || "",
    sub2apiPassword: "",
    sub2apiGroupName: config.sub2apiGroupName || "k12",
    sub2apiProxyName: config.sub2apiProxyName || "",
    sub2apiAccountPriority: config.sub2apiAccountPriority || 1,
    sub2apiConcurrency: config.sub2apiConcurrency || 10,
    tokenOut: config.tokenOut || "",
  });
  workspaceText.value = (config.workspaceIds || []).join("\n");
}

async function saveConfig() {
  const payload = {
    ...form,
    workspaceIds: parseWorkspaceIds(workspaceText.value),
  };
  await api("/api/config", {method: "PATCH", body: JSON.stringify(payload)});
  await loadConfig();
  showToast("配置已保存");
}

async function loadEmails() {
  const data = await api<any>("/api/emails");
  emails.value = data.items || [];
}

async function loadTasks() {
  const data = await api<any>("/api/tasks");
  tasks.value = data.items || [];
  if (selectedTask.value) {
    selectedTask.value = tasks.value.find((item) => item.id === selectedTask.value?.id) || selectedTask.value;
  } else if (tasks.value.length) {
    selectedTask.value = tasks.value[0];
  }
}

async function refreshAll() {
  await Promise.all([loadSummary(), loadEmails(), loadTasks()]);
}

async function importEmails() {
  const data = await api<any>("/api/emails/import", {
    method: "POST",
    body: JSON.stringify({text: emailText.value, mailApiBaseUrl: form.mailApiBaseUrl}),
  });
  importResult.value = JSON.stringify(data, null, 2);
  showToast(`导入完成：新增 ${data.added}，更新 ${data.updated}`);
  await refreshAll();
}

async function deleteEmail(id: string) {
  await api(`/api/emails/${encodeURIComponent(id)}`, {method: "DELETE"});
  await refreshAll();
}

async function startTasks() {
  await saveConfig();
  const data = await api<any>("/api/tasks", {
    method: "POST",
    body: JSON.stringify({
      count: selectedReadyCount.value,
      concurrency: form.taskConcurrency,
      workspaceIds: parseWorkspaceIds(workspaceText.value),
      route: form.route,
      runWorkspaceJoin: form.runWorkspaceJoin,
      runSub2Api: form.runSub2Api,
      sub2apiGroupName: form.sub2apiGroupName || "k12",
    }),
  });
  showToast(`已创建 ${data.tasks?.length || 0} 个任务`);
  await refreshAll();
}

async function cancelTask(id: string) {
  await api(`/api/tasks/${encodeURIComponent(id)}/cancel`, {method: "POST", body: "{}"});
  await refreshAll();
}

function selectTask(task: TaskItem) {
  selectedTask.value = task;
}

function sampleEmails() {
  emailText.value = [
    "user1@example.com----password----client-id----refresh-token",
    "user2@example.com-----http://wremail.cc/api/GetLastEmails?email=user2@example.com&clientId=xxx&refreshToken=yyy&num=2&boxType=1",
  ].join("\n");
}

function statusText(status: string) {
  return ({
    free: "空闲",
    running: "运行中",
    success: "成功",
    failed: "失败",
    queued: "队列",
    canceled: "已取消",
  } as Record<string, string>)[status] || status;
}

function fmtTime(value: string) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleTimeString();
}

onMounted(async () => {
  await loadConfig();
  await refreshAll();
  timer = window.setInterval(refreshAll, 2500);
});

onUnmounted(() => {
  if (timer) window.clearInterval(timer);
});
</script>
