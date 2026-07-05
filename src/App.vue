<template>
  <main class="page">
    <div class="orb orb-one"></div>
    <div class="orb orb-two"></div>

    <header class="topbar shell">
      <div>
        <p class="eyebrow">K12 Space Automation</p>
        <h1>任务控制台</h1>
        <p class="subtitle">任务列表为主视图；配置、邮箱导入、邮箱池和任务日志都通过弹窗处理。</p>
      </div>
      <div class="top-actions">
        <button class="ghost" @click="exportData">导出数据</button>
        <button class="ghost" :disabled="importingData" @click="triggerDataImport">
          {{ importingData ? "导入中..." : "导入数据" }}
        </button>
        <input ref="dataImportInput" class="hidden-file-input" type="file" accept="application/json,.json" @change="importDataFile" />
        <button class="ghost" @click="refreshAll">刷新</button>
        <button class="ghost" @click="openSettings">设置</button>
      </div>
    </header>

    <section class="overview-grid">
      <article class="stat-card glow">
        <span>任务尝试</span>
        <strong>{{ summary.tasks.total }}</strong>
        <small>唯一邮箱 {{ summary.emails.total }} / 运行 {{ summary.tasks.running }} / 队列 {{ summary.tasks.queued }}</small>
      </article>
      <article class="stat-card">
        <span>邮箱池</span>
        <strong>{{ summary.emails.total }}</strong>
        <small>可用 {{ summary.emails.free }} / 失败 {{ summary.emails.failed }} / GPT封号 {{ summary.emails.banned }}</small>
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
      <article class="stat-card refill-card">
        <span>自动补号</span>
        <strong>{{ sub2apiRefillStatus.lastResult?.normalAccounts ?? "-" }}</strong>
        <small>{{ refillSummaryText }}</small>
      </article>
      <article class="stat-card at-repair-card">
        <span>自动补 AT</span>
        <strong>{{ sub2apiRefillStatus.autoAtRepair.lastResult?.createdTasks ?? "-" }}</strong>
        <small>{{ autoAtRepairSummaryText }}</small>
      </article>
      <article class="stat-card smsbower-card">
        <span>SMSBower</span>
        <strong>{{ smsBowerBalanceText }}</strong>
        <small>{{ smsBowerSpendText }}</small>
      </article>
    </section>

    <section class="panel task-panel">
      <div class="list-toolbar">
        <div>
          <p class="eyebrow">Tasks</p>
          <h2>任务列表</h2>
          <p class="toolbar-subtitle">点击任务行打开日志弹窗。</p>
        </div>
        <div class="toolbar-actions task-toolbar-layout">
          <div class="toolbar-action-groups">
            <div class="toolbar-group">
              <span class="toolbar-group-label">检测修复</span>
              <button class="ghost" :disabled="!selectedCheckableTaskIds.length || checkingTasks" @click="checkSelectedTasks">
                {{ checkingTasks ? "测活中..." : `测活选中 ${selectedCheckableTaskIds.length}` }}
              </button>
              <button class="ghost" :disabled="!selectedTaskIds.length" @click="repairSelectedTasks">
                修复AT {{ selectedTaskIds.length }}
              </button>
              <button class="ghost" :disabled="checkingTasks" @click="loadInactiveTaskData">
                一键失活数据
              </button>
              <button class="ghost" :disabled="!inactiveMarkedTasks.length" @click="selectInactiveMarkedTasks">
                勾选失活 {{ inactiveMarkedTasks.length }}
              </button>
            </div>

            <div class="toolbar-group">
              <span class="toolbar-group-label">自动任务</span>
              <button class="ghost" :disabled="startingSub2apiRefill || sub2apiRefillStatus.running" @click="startSub2apiRefill">
                {{ startingSub2apiRefill || sub2apiRefillStatus.running ? "补号检测中..." : "启动补号" }}
              </button>
              <button class="ghost" :disabled="startingSub2apiAutoAtRepair || sub2apiRefillStatus.autoAtRepair.running" @click="startSub2apiAutoAtRepair">
                {{ startingSub2apiAutoAtRepair || sub2apiRefillStatus.autoAtRepair.running ? "补AT自检中..." : "自检补AT" }}
              </button>
              <button class="ghost" @click="openSub2apiRefillHistory">
                补号日志
              </button>
              <button class="ghost" :disabled="!topUpFissionGroups.length || toppingUpAllFission" @click="continueAllFission">
                {{ toppingUpAllFission ? "补分裂中..." : `一键补分裂 ${topUpFissionGroups.length}` }}
              </button>
            </div>

            <div class="toolbar-group danger-group">
              <span class="toolbar-group-label">危险操作</span>
              <button class="danger" :disabled="!activeTaskCount || stoppingActiveTasks" @click="cancelActiveTasks">
                {{ stoppingActiveTasks ? "停止中..." : `停止全部 ${activeTaskCount}` }}
              </button>
              <button class="ghost" :disabled="!summary.tasks.failed || retryingFailedTasks" @click="retryFailedTasks">
                {{ retryingFailedTasks ? "重跑中..." : `重跑失败 ${summary.tasks.failed}` }}
              </button>
              <button class="danger" :disabled="!summary.tasks.failed" @click="clearFailedTasks">
                清理失败 {{ summary.tasks.failed }}
              </button>
            </div>
          </div>

          <div class="task-launch-strip">
            <div class="launch-state-row">
              <span :class="['task-state-pill', busy ? 'busy' : 'idle']">
                {{ busy ? `运行 ${summary.tasks.running} / 队列 ${summary.tasks.queued}` : "空闲" }}
              </span>
              <span v-if="form.smsBowerMailEnabled" class="launch-mode-badge">
                {{ form.gmailMailProvider === "emailnator" ? "Emailnator Gmail" : "SMSBower Gmail" }} 动态模式，不占用邮箱池
              </span>
            </div>
            <div class="launch-control-row">
              <label class="field run-count-field compact-run-count">
                <span>本次处理数量</span>
                <input v-model.number="runCount" type="number" min="1" />
              </label>
              <label class="field run-count-field compact-run-count workspace-mode-field">
                <span>空间模式</span>
                <select v-model="workspaceLaunchMode">
                  <option value="all">每空间</option>
                  <option value="random-one">随机1个</option>
                </select>
              </label>
              <button class="ghost" @click="openEmailImport">邮箱导入</button>
              <button class="ghost" @click="openEmailPool">邮箱池</button>
              <button class="primary" :disabled="startTasksDisabled" @click="startTasks">
                {{ busy ? "运行中" : `启动 ${launchTaskCount} 个任务` }}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div class="table-wrap task-table-wrap">
        <table class="task-table">
          <thead>
            <tr>
              <th class="select-col">
                <input type="checkbox" :checked="allCheckableTasksSelected" @change="toggleAllCheckableTasks" />
              </th>
              <th>状态</th>
              <th>空间状态</th>
              <th>邮箱</th>
              <th>动作</th>
              <th>AT</th>
              <th>Sub2API</th>
              <th>K12</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <template v-for="(rootGroup, rootIndex) in pagedTaskRootGroups" :key="rootGroup.key">
              <tr
                :class="['task-row', 'task-group-row', 'task-root-row', taskTreeToneClass(rootIndex), { active: taskGroupHasSelectedTask(rootGroup), selected: isTaskGroupPartlySelected(rootGroup), expanded: isTaskGroupExpanded(rootGroup.key), 'task-root-gap': rootIndex > 0 }]"
                @click="toggleTaskGroup(rootGroup)"
              >
                <td class="select-col" @click.stop>
                  <input type="checkbox" :checked="isTaskGroupFullySelected(rootGroup)" @change="toggleTaskGroupSelection(rootGroup)" />
                </td>
                <td>
                  <div class="status-stack">
                    <span :class="['status', rootGroup.status]">{{ statusText(rootGroup.status) }}</span>
                    <small>{{ rootGroup.workspaceGroups.length }} 空间</small>
                  </div>
                </td>
                <td>
                  <span :class="['workspace-state-badge', rootWorkspaceState(rootGroup).kind]" :title="rootWorkspaceState(rootGroup).title">
                    {{ rootWorkspaceState(rootGroup).text }}
                  </span>
                </td>
                <td>
                  <div class="task-email-cell">
                    <div class="cell-with-action">
                      <button
                        class="ghost tiny expand-toggle"
                        :title="isTaskGroupExpanded(rootGroup.key) ? '收起空间' : '展开空间'"
                        @click.stop="toggleTaskGroup(rootGroup)"
                      >
                        {{ isTaskGroupExpanded(rootGroup.key) ? "-" : "+" }}
                      </button>
                      <span class="tree-level-chip root">母号 {{ taskRootNumber(taskPageStart, rootIndex) }}</span>
                      <span class="mono clipped">{{ rootGroup.rootEmail }}</span>
                      <button class="ghost tiny" @click.stop="copyText(rootGroup.rootEmail, '邮箱已复制')">复制</button>
                    </div>
                    <div class="task-meta-row">
                      <span :class="['fission-source-badge', rootGroup.source]">{{ rootGroup.sourceLabel }}</span>
                      <span v-if="rootGroup.fissionTargetChildren > 0" class="fission-progress">
                        子号 {{ rootGroup.fissionSuccessChildren }}/{{ rootGroup.fissionTargetChildren }}
                      </span>
                      <span v-if="rootGroup.fissionFailedChildren > 0" class="fission-progress warn">
                        失败 {{ rootGroup.fissionFailedChildren }}
                      </span>
                      <small class="muted">点击展开 {{ rootGroup.workspaceGroups.length }} 个 workspace</small>
                    </div>
                  </div>
                </td>
                <td>{{ rootGroup.primaryTask.route }}</td>
                <td>
                  <div class="cell-with-action">
                    <span class="mono clipped">{{ rootGroup.primaryTask.accessTokenPreview || "pending" }}</span>
                    <span v-if="rootGroup.primaryTask.accessTokenLiveness" :class="['liveness-badge', rootGroup.primaryTask.accessTokenLiveness]" :title="rootGroup.primaryTask.accessTokenLivenessMessage || ''">
                      {{ livenessText(rootGroup.primaryTask.accessTokenLiveness) }}
                    </span>
                    <button
                      class="ghost tiny"
                      :disabled="!rootGroup.primaryTask.accessToken && !rootGroup.primaryTask.accessTokenPreview"
                      @click.stop="copyAccessToken(rootGroup.primaryTask)"
                    >
                      复制
                    </button>
                  </div>
                </td>
                <td class="mono clipped">{{ rootGroup.primaryTask.sub2apiAccount || "-" }}</td>
                <td>{{ rootGroup.workspaceGroups.filter((item) => item.status === "success").length }}/{{ rootGroup.workspaceGroups.length }}</td>
                <td>
                  <div class="row-actions">
                    <button class="ghost small" @click.stop="openTaskLog(rootGroup.primaryTask)">日志</button>
                    <button
                      v-if="activeTaskIdsOfGroup(rootGroup).length"
                      class="danger small"
                      @click.stop="cancelTaskGroup(rootGroup)"
                    >
                      取消
                    </button>
                  </div>
                </td>
              </tr>
              <template v-for="(group, workspaceIndex) in isTaskGroupExpanded(rootGroup.key) ? rootGroup.workspaceGroups : []" :key="group.key">
                <tr
                  :class="['task-row', 'task-group-row', 'task-workspace-row', taskTreeToneClass(rootIndex), taskWorkspaceToneClass(workspaceIndex), { active: taskGroupHasSelectedTask(group), selected: isTaskGroupPartlySelected(group), expanded: isTaskGroupExpanded(group.key) }]"
                  @click="openOrToggleTaskGroup(group)"
                >
                  <td class="select-col" @click.stop>
                    <input type="checkbox" :checked="isTaskGroupFullySelected(group)" @change="toggleTaskGroupSelection(group)" />
                  </td>
                  <td>
                    <div class="status-stack">
                      <span :class="['status', group.status]">{{ statusText(group.status) }}</span>
                      <small v-if="group.tasks.length > 1">{{ group.tasks.length }} 条</small>
                    </div>
                  </td>
                  <td>
                    <span :class="['workspace-state-badge', workspaceState(group).kind]" :title="workspaceState(group).title">
                      {{ workspaceState(group).text }}
                    </span>
                  </td>
                  <td>
                    <div class="task-email-cell">
                      <div class="cell-with-action">
                        <button
                          class="ghost tiny expand-toggle"
                          :title="isTaskGroupExpanded(group.key) ? '收起任务明细' : '展开任务明细'"
                          @click.stop="toggleTaskGroup(group)"
                        >
                          {{ isTaskGroupExpanded(group.key) ? "-" : "+" }}
                        </button>
                        <span class="detail-node">空间</span>
                        <span class="tree-level-chip workspace">{{ taskWorkspaceNumber(taskPageStart, rootIndex, workspaceIndex) }}</span>
                        <span class="mono clipped">{{ workspaceLabel(group) }}</span>
                      </div>
                      <div class="task-meta-row">
                        <span :class="['fission-source-badge', group.source]">{{ group.sourceLabel }}</span>
                        <span v-if="group.fissionTargetChildren > 0" class="fission-progress">
                          子号 {{ group.fissionSuccessChildren }}/{{ group.fissionTargetChildren }}
                        </span>
                        <span v-if="group.fissionFailedChildren > 0" class="fission-progress warn">
                          失败 {{ group.fissionFailedChildren }}
                        </span>
                        <small class="muted">点击展开 {{ group.detailTasks.length }} 条</small>
                      </div>
                    </div>
                  </td>
                  <td>{{ group.primaryTask.route }}</td>
                  <td>
                    <div class="cell-with-action">
                      <span class="mono clipped">{{ group.primaryTask.accessTokenPreview || "pending" }}</span>
                      <span v-if="group.primaryTask.accessTokenLiveness" :class="['liveness-badge', group.primaryTask.accessTokenLiveness]" :title="group.primaryTask.accessTokenLivenessMessage || ''">
                        {{ livenessText(group.primaryTask.accessTokenLiveness) }}
                      </span>
                      <button
                        class="ghost tiny"
                        :disabled="!group.primaryTask.accessToken && !group.primaryTask.accessTokenPreview"
                        @click.stop="copyAccessToken(group.primaryTask)"
                      >
                        复制
                      </button>
                    </div>
                  </td>
                  <td class="mono clipped">{{ group.primaryTask.sub2apiAccount || "-" }}</td>
                  <td>{{ group.primaryTask.workspaceResults.filter((r) => r.ok).length }}/{{ group.primaryTask.workspaceIds.length }}</td>
                  <td>
                    <div class="row-actions">
                      <button class="ghost small" @click.stop="openTaskLog(group.primaryTask)">日志</button>
                    <button
                      class="ghost small"
                      :disabled="!canCheckTaskAt(group.primaryTask) || checkingTaskAtId === group.primaryTask.id"
                      @click.stop="checkTaskAccessToken(group.primaryTask)"
                    >
                      {{ checkingTaskAtId === group.primaryTask.id ? "测活中" : "测活" }}
                    </button>
                    <button
                      v-if="group.primaryTask.status === 'queued' || group.primaryTask.status === 'running'"
                      class="danger small"
                      @click.stop="cancelTask(group.primaryTask.id)"
                    >
                      取消
                    </button>
                    <button
                      v-if="canDeleteTask(group.primaryTask)"
                      class="ghost small"
                      @click.stop="retryTask(group.primaryTask.id)"
                    >
                      重试
                    </button>
                    <button
                      v-if="canTopUpFission(group)"
                      class="ghost small"
                      :disabled="toppingUpFissionKey === group.key"
                      @click.stop="continueFission(group)"
                    >
                      {{ toppingUpFissionKey === group.key ? "补位中" : "继续补分裂" }}
                    </button>
                    <button
                      v-if="canDeleteTask(group.primaryTask)"
                      class="danger small"
                      @click.stop="deleteTask(group.primaryTask.id)"
                    >
                      删除
                    </button>
                  </div>
                </td>
              </tr>
              <tr
                v-for="(task, taskIndex) in isTaskGroupExpanded(group.key) ? group.detailTasks : []"
                :key="task.id"
                :class="['task-row', 'task-detail-row', taskTreeToneClass(rootIndex), taskWorkspaceToneClass(workspaceIndex), { active: selectedTask?.id === task.id, selected: selectedTaskIds.includes(task.id) }]"
                @click="openTaskLog(task)"
              >
                <td class="select-col" @click.stop>
                  <input type="checkbox" :checked="selectedTaskIds.includes(task.id)" @change="toggleTaskSelection(task.id)" />
                </td>
                <td><span :class="['status', task.status]">{{ statusText(task.status) }}</span></td>
                <td>
                  <span :class="['workspace-state-badge', taskWorkspaceState(task).kind]" :title="taskWorkspaceState(task).title">
                    {{ taskWorkspaceState(task).text }}
                  </span>
                </td>
                <td>
                  <div class="task-detail-email">
                    <div class="cell-with-action">
                      <span class="detail-node">{{ task.id === group.primaryTask.id ? "主" : "子" }}</span>
                      <span class="tree-level-chip detail">{{ taskDetailNumber(taskPageStart, rootIndex, workspaceIndex, taskIndex) }}</span>
                      <span class="mono clipped">{{ task.email }}</span>
                      <button class="ghost tiny" @click.stop="copyText(task.email, '邮箱已复制')">复制</button>
                    </div>
                    <div class="task-meta-row detail-meta">
                      <small class="muted">{{ task.parentEmail ? "子号" : "母号/重试" }}</small>
                      <small v-if="task.parentEmail" class="muted">母号：{{ task.parentEmail }}</small>
                    </div>
                  </div>
                </td>
                <td>{{ task.route }}</td>
                <td>
                  <div class="cell-with-action">
                    <span class="mono clipped">{{ task.accessTokenPreview || "pending" }}</span>
                    <span v-if="task.accessTokenLiveness" :class="['liveness-badge', task.accessTokenLiveness]" :title="task.accessTokenLivenessMessage || ''">
                      {{ livenessText(task.accessTokenLiveness) }}
                    </span>
                    <button
                      class="ghost tiny"
                      :disabled="!task.accessToken && !task.accessTokenPreview"
                      @click.stop="copyAccessToken(task)"
                    >
                      复制
                    </button>
                  </div>
                </td>
                <td class="mono clipped">{{ task.sub2apiAccount || "-" }}</td>
                <td>{{ task.workspaceResults.filter((r) => r.ok).length }}/{{ task.workspaceIds.length }}</td>
                <td>
                  <div class="row-actions">
                    <button class="ghost small" @click.stop="openTaskLog(task)">日志</button>
                    <button
                      class="ghost small"
                      :disabled="!canCheckTaskAt(task) || checkingTaskAtId === task.id"
                      @click.stop="checkTaskAccessToken(task)"
                    >
                      {{ checkingTaskAtId === task.id ? "测活中" : "测活" }}
                    </button>
                    <button
                      v-if="task.status === 'queued' || task.status === 'running'"
                      class="danger small"
                      @click.stop="cancelTask(task.id)"
                    >
                      取消
                    </button>
                    <button
                      v-if="canDeleteTask(task)"
                      class="ghost small"
                      @click.stop="retryTask(task.id)"
                    >
                      重试
                    </button>
                    <button
                      v-if="canDeleteTask(task)"
                      class="danger small"
                      @click.stop="deleteTask(task.id)"
                    >
                      删除
                    </button>
                  </div>
                </td>
              </tr>
              </template>
            </template>
            <tr v-if="!taskRootGroups.length">
              <td colspan="9" class="empty">暂无任务。导入邮箱后可从上方启动流程。</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-if="taskRootGroups.length" class="pagination-bar">
        <span>
          共 {{ taskRootGroups.length }} 个母号 / {{ taskGroups.length }} 个空间 / {{ sortedTasks.length }} 个任务尝试，当前 {{ taskPageStart + 1 }}-{{ taskPageEnd }}
        </span>
        <div class="pagination-actions">
          <button class="ghost small" :disabled="taskPage <= 1" @click="taskPage = 1">首页</button>
          <button class="ghost small" :disabled="taskPage <= 1" @click="taskPage -= 1">上一页</button>
          <strong>{{ taskPage }} / {{ taskTotalPages }}</strong>
          <button class="ghost small" :disabled="taskPage >= taskTotalPages" @click="taskPage += 1">下一页</button>
          <button class="ghost small" :disabled="taskPage >= taskTotalPages" @click="taskPage = taskTotalPages">末页</button>
        </div>
      </div>
      <pre v-if="taskCheckResult" class="check-result task-check-result">{{ taskCheckResult }}</pre>
    </section>

    <div v-if="toast" class="toast">{{ toast }}</div>

    <Teleport to="body">
      <div v-if="showSettingsModal" class="modal-backdrop">
        <section class="panel modal-card settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title">
          <div class="section-head">
            <div>
              <p class="eyebrow">Settings</p>
              <h2 id="settings-title">Sub2API 和 K12 配置</h2>
            </div>
            <button class="ghost small" @click="closeSettings">关闭</button>
          </div>

          <div class="modal-body settings-body">
            <section class="settings-section">
              <div class="section-head compact-head">
                <div>
                  <p class="eyebrow">K12</p>
                  <h3>K12 空间脚本</h3>
                </div>
                <span class="pill">{{ workspaceCount }} 个 workspace</span>
              </div>
              <label class="field">
                <span>K12 Workspace ID（一行一个或逗号分隔；启动时可选择每空间或随机1个）</span>
                <textarea v-model="workspaceText" class="workspace-box"></textarea>
              </label>
              <div class="workspace-dedupe-actions">
                <button class="ghost small" type="button" :disabled="dedupingWorkspaceIds" @click="dedupeWorkspaceConfig">
                  {{ dedupingWorkspaceIds ? "整理中" : "去重空间 ID" }}
                </button>
                <small>只整理重复 workspace ID，不检测可用性，不触发邮箱、AT 或 OpenAI 请求。</small>
              </div>
              <div v-if="workspaceDedupeMessage" class="workspace-dedupe-note">{{ workspaceDedupeMessage }}</div>
              <div class="switch-grid">
                <label class="switch-card">
                  <input v-model="form.runWorkspaceJoin" type="checkbox" />
                  <span>
                    <strong>执行 K12 空间脚本</strong>
                    <small>多个 workspace 时，启动区可选择“每空间”逐个申请，或“随机1个”只抽一个空间执行 request/accept。</small>
                  </span>
                </label>
                <label class="switch-card">
                  <input v-model="form.runSub2Api" type="checkbox" />
                  <span>
                    <strong>执行 Sub2API 入库</strong>
                    <small>只拿邮箱 OA 到 Sub2API 的流程，分组默认 k12。</small>
                  </span>
                </label>
                <label class="switch-card">
                  <input v-model="form.sub2apiNoRtMode" type="checkbox" />
                  <span>
                    <strong>noRT 直入模式</strong>
                    <small>开启后跳过 Sub2API OAuth：注册/登录 → 加入并切到 K12 → 用 K12 AT 创建或更新 --noRT 账号。</small>
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
                <label class="field">
                  <span>邮箱收码冷却 ms</span>
                  <input v-model.number="form.poolFissionMailboxOtpCooldownMs" type="number" min="0" max="3600000" />
                </label>
              </div>
              <label class="field">
                <span>默认 OpenAI 代理</span>
                <input v-model="form.defaultProxyUrl" placeholder="direct 或 http://127.0.0.1:7897" />
              </label>
              <label class="switch-card">
                <input v-model="form.openAiProxyPoolEnabled" type="checkbox" />
                <span>
                  <strong>OpenAI 代理池自动换 IP</strong>
                  <small>收不到新验证码、callback 403/429 时，切换下一个代理并重试当前任务。</small>
                </span>
              </label>
              <div class="config-grid">
                <label class="field">
                  <span>Mihono 管理地址</span>
                  <input v-model="form.openAiProxyPoolApiUrl" placeholder="http://SERVER_IP:17879 或 /api/public/proxies?type=http&format=text" />
                  <small>填管理页地址即可；K12 会保存订阅、生成映射，再拉 public proxies。</small>
                </label>
                <label class="field">
                  <span>换 IP 最大重试</span>
                  <input v-model.number="form.openAiProxyPoolMaxRetries" type="number" min="0" max="10" />
                </label>
                <label class="field">
                  <span>Mihono 管理账号</span>
                  <input v-model="form.openAiProxyMihonoUsername" placeholder="admin" />
                </label>
                <label class="field">
                  <span>Mihono 管理密码</span>
                  <input v-model="form.openAiProxyMihonoPassword" type="password" autocomplete="new-password" :placeholder="openAiProxyMihonoPasswordSaved ? openAiProxyMihonoPasswordMasked : ''" />
                </label>
              </div>
              <label class="field">
                <span>Mihono 订阅链接</span>
                <textarea v-model="form.openAiProxySubscriptionText" rows="4" placeholder="一行一个订阅；也支持 名称|订阅链接；留空保存时保留已保存订阅"></textarea>
                <small>已保存 {{ openAiProxySubscriptionCountSaved }} 个订阅；换 IP 前会自动刷新并生成代理池。</small>
              </label>
              <div class="mihono-mapping-panel">
                <div class="mihono-mapping-head">
                  <small>
                    Mihono 可用映射 IP：{{ openAiProxyMihonoMappingCount }} 条
                    <span v-if="openAiProxyMihonoMappingFilteredCount > 0">
                      / 原始 {{ openAiProxyMihonoMappingTotalCount }} 条，已过滤失败 {{ openAiProxyMihonoMappingFilteredCount }} 条
                    </span>
                  </small>
                  <button class="ghost small" :disabled="testingMihonoProxy" @click="testMihonoProxyPool">
                    {{ testingMihonoProxy ? "测试中" : "测试代理池" }}
                  </button>
                </div>
                <div v-if="openAiProxyMihonoMappingRows.length" class="mihono-mapping-list">
                  <div v-for="row in openAiProxyMihonoMappingRows.slice(0, 12)" :key="`${row.username}-${row.node}`" class="mihono-mapping-row">
                    <code>{{ row.username }}</code>
                    <span>{{ row.endpoint }}</span>
                    <span class="mapping-node">{{ row.node }}</span>
                    <span :class="['mapping-state', row.ok === false ? 'failed' : 'ok']">
                      {{ row.ok === false ? "失败" : (row.delay ? `${row.delay} ms` : "可用") }}
                    </span>
                  </div>
                </div>
                <small v-else>还没有映射；先在 Mihono 生成全量映射。</small>
                <small v-if="openAiProxyMihonoMappingCount > openAiProxyMihonoMappingRows.slice(0, 12).length">
                  只展示前 12 条，实际使用 {{ openAiProxyMihonoMappingCount }} 条。
                </small>
                <small v-if="mihonoProxyTestMessage" :class="['proxy-test-message', mihonoProxyTestMessage.startsWith('可用') ? 'ok' : 'failed']">
                  {{ mihonoProxyTestMessage }}
                </small>
              </div>
              <label class="field">
                <span>手动 OpenAI 代理池</span>
                <textarea v-model="form.openAiProxyPoolText" rows="4" placeholder="一行一个代理；留空保存时保留已保存代理池"></textarea>
                <small>已保存 {{ openAiProxyPoolCountSaved }} 条<span v-if="openAiProxyPoolMasked.length">：{{ openAiProxyPoolMasked.join("，") }}</span></small>
              </label>
            </section>

            <section class="settings-section">
              <div class="section-head compact-head">
                <div>
                  <p class="eyebrow">Sub2API</p>
                  <h3>入库配置</h3>
                </div>
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
                  <input
                    v-model="form.sub2apiPassword"
                    type="password"
                    name="sub2api-password-new"
                    autocomplete="new-password"
                    autocapitalize="off"
                    spellcheck="false"
                    data-lpignore="true"
                    data-1p-ignore
                    :placeholder="passwordPlaceholder"
                  />
                </label>
                <label class="field">
                  <span>分组（可多个）</span>
                  <input v-model="form.sub2apiGroupName" placeholder="k12, shared-group" />
                  <small>多个分组用逗号、分号或换行分隔；账号会同时绑定这些分组。</small>
                </label>
                <label class="field">
                  <span>IP管理 / 代理</span>
                  <input v-model="form.sub2apiProxyName" placeholder="留空不绑定；可填 Sub2API 代理名称或 ID" />
                </label>
                <label class="field">
                  <span>Token 输出文件</span>
                  <input v-model="form.tokenOut" />
                </label>
                <label class="field">
                  <span>账号 JSON 类型</span>
                  <select v-model="form.jsonOutFormat">
                    <option value="sub2api">SUB2API</option>
                    <option value="cpa">CPA</option>
                  </select>
                </label>
                <label class="field">
                  <span>账号 JSON 写出目录</span>
                  <input v-model="form.jsonOutDir" placeholder="默认项目 json 文件夹" />
                </label>
              </div>
            </section>

            <section class="settings-section">
              <div class="section-head compact-head">
                <div>
                  <p class="eyebrow">Auto Refill</p>
                  <h3>Sub2API 自动补号</h3>
                </div>
                <span class="pill">{{ form.sub2apiAutoRefillEnabled || form.sub2apiAutoAtRepairEnabled ? "已启用" : "未启用" }}</span>
              </div>
              <label class="switch-card refill-switch">
                <input v-model="form.sub2apiAutoRefillEnabled" type="checkbox" />
                <span>
                  <strong>启动定时检测补号</strong>
                  <small>定时统计目标分组正常账号数；低于预警线时，从空闲邮箱池自动创建补号任务。</small>
                </span>
              </label>
              <label class="switch-card refill-switch">
                <input v-model="form.sub2apiAutoAtRepairEnabled" type="checkbox" />
                <span>
                  <strong>启动自动补 AT</strong>
                  <small>定时扫描 Sub2API 分组内 K12 状态错误或套餐错误账号，自动创建 AT 修复任务。</small>
                </span>
              </label>
              <label class="switch-card refill-switch">
                <input v-model="form.sub2apiRefillDeepCheckEnabled" type="checkbox" />
                <span>
                  <strong>开启深度测活</strong>
                  <small>检测时对账号执行一次真实模型请求；只有真实可用的账号才计入正常账号数。</small>
                </span>
              </label>
              <div class="config-grid refill-config-grid">
                <label class="field">
                  <span>检测 Sub2API 补号分组名称</span>
                  <input v-model="form.sub2apiRefillGroupName" placeholder="k12" />
                </label>
                <label class="field">
                  <span>预警线（正常账号低于多少开始补号）</span>
                  <input v-model.number="form.sub2apiRefillThreshold" type="number" min="0" />
                </label>
                <label class="field">
                  <span>补号执行的邮箱数量</span>
                  <input v-model.number="form.sub2apiRefillEmailCount" type="number" min="1" max="500" />
                </label>
                <label class="field">
                  <span>定时检测间隔 ms</span>
                  <input v-model.number="form.sub2apiRefillIntervalMs" type="number" min="10000" />
                </label>
              </div>
              <p class="hint">
                补号任务会复用当前 K12 / Sub2API 入库配置；实际执行并发按照上方“并发”设置。
                {{ sub2apiRefillStatus.nextCheckAt ? `下次检测：${fmtDateTime(sub2apiRefillStatus.nextCheckAt)}` : "" }}
                {{ autoAtRepairSummaryText ? `；补 AT：${autoAtRepairSummaryText}` : "" }}
              </p>
            </section>

            <section class="settings-section">
              <div class="section-head compact-head">
                <div>
                  <p class="eyebrow">SMSBower Gmail</p>
                  <h3>动态谷歌邮箱接码</h3>
                </div>
                <span class="pill">{{ form.smsBowerMailEnabled ? "已启用" : "未启用" }}</span>
              </div>
              <label class="switch-card refill-switch">
                <input v-model="form.smsBowerMailEnabled" type="checkbox" />
                <span>
                  <strong>使用动态谷歌邮箱</strong>
                  <small>开启后，未指定邮箱启动任务时按下方类型动态生成/租 Gmail 接码；关闭时仍按原来的邮箱池流程执行。</small>
                </span>
              </label>
              <div class="config-grid refill-config-grid">
                <label class="field">
                  <span>谷歌邮箱渠道类型</span>
                  <select v-model="form.gmailMailProvider">
                    <option value="smsbower">SMSBower</option>
                    <option value="emailnator">Emailnator</option>
                  </select>
                  <small>只新增 Emailnator 分支；选择 SMSBower 时原租邮箱流程不变。</small>
                </label>
                <label class="field" v-if="form.gmailMailProvider === 'emailnator'">
                  <span>Emailnator 生成类型</span>
                  <select v-model="form.emailnatorEmailType">
                    <option value="plusGmail">plusGmail（推荐，稳定 Gmail）</option>
                    <option value="googleMail">googleMail</option>
                    <option value="dotGmail">dotGmail</option>
                    <option value="domain">domain</option>
                  </select>
                  <small>按你抓包的稳定请求，默认使用 plusGmail。</small>
                </label>
                <label class="field" v-if="form.gmailMailProvider === 'emailnator'">
                  <span>Emailnator 地址</span>
                  <input v-model="form.emailnatorBaseUrl" placeholder="https://www.emailnator.com" />
                </label>
              </div>
              <p v-if="smsBowerBackendUnsupported" class="inline-alert warn">
                当前后端未返回 SMSBower 配置字段，说明服务仍在跑旧进程。请重启后端后再保存，否则开关会被旧接口丢弃。
              </p>
              <label v-if="form.gmailMailProvider === 'smsbower'" class="switch-card refill-switch">
                <input v-model="form.smsBowerGmailFissionEnabled" type="checkbox" />
                <span>
                  <strong>开启谷歌裂变</strong>
                  <small>母邮箱任务成功后，再逐个创建 +alias 子邮箱任务，避免验证码串号。</small>
                </span>
              </label>
              <div v-if="form.gmailMailProvider === 'smsbower'" class="config-grid refill-config-grid">
                <label class="field">
                  <span class="field-title-row">
                    SMSBower API Key
                    <em :class="['key-state', smsBowerApiKeySaved ? 'set' : 'unset']">
                      {{ smsBowerApiKeySaved ? "已设置 Key" : "未设置 Key" }}
                    </em>
                  </span>
                  <input v-model="form.smsBowerApiKey" type="password" :placeholder="smsBowerApiKeyPlaceholder" />
                  <small v-if="smsBowerApiKeySaved">已保存的 Key：{{ smsBowerApiKeyMasked || "已隐藏" }}，留空保存不会覆盖。</small>
                  <small v-else>还没有保存 Key，填写后点击“保存配置”才会生效。</small>
                </label>
                <label class="field">
                  <span>Mail API 地址</span>
                  <input v-model="form.smsBowerMailBaseUrl" placeholder="https://smsbower.page/api/mail" />
                </label>
                <label class="field">
                  <span>服务代码</span>
                  <input v-model="form.smsBowerMailService" placeholder="openai" />
                  <small>可填 openai；后端会自动按 SMSBower 邮件服务码 dr 请求。</small>
                </label>
                <label class="field">
                  <span>邮箱域名</span>
                  <input v-model="form.smsBowerMailDomain" placeholder="gmail.com" />
                </label>
                <label class="field">
                  <span>最高价格（可空）</span>
                  <input v-model="form.smsBowerMailMaxPrice" placeholder="留空不限制" />
                </label>
                <label class="field">
                  <span>每个母邮箱裂变子任务数</span>
                  <input v-model.number="form.smsBowerGmailFissionCount" type="number" min="1" max="100" />
                </label>
              </div>
            </section>
          </div>

          <div class="modal-footer">
            <p class="hint">配置默认从本项目 <code>codex_register/config.json</code> 读取，保存后写入本项目 <code>data/config.json</code>。</p>
            <button class="primary" :disabled="savingConfig" @click="saveConfig">
              {{ savingConfig ? "保存中..." : "保存配置" }}
            </button>
          </div>
        </section>
      </div>

      <div v-if="showSub2apiRefillHistoryModal" class="modal-backdrop" @click.self="closeSub2apiRefillHistory">
        <section class="panel modal-card refill-history-modal" role="dialog" aria-modal="true" aria-labelledby="refill-history-title">
          <div class="section-head">
            <div>
              <p class="eyebrow">Refill History</p>
              <h2 id="refill-history-title">补号日志 / 历史记录</h2>
            </div>
            <div class="modal-actions">
              <button class="ghost small" @click="loadSub2apiRefillHistory">刷新</button>
              <button class="ghost small" @click="closeSub2apiRefillHistory">关闭</button>
            </div>
          </div>
          <div class="modal-body">
            <div class="modal-status-grid refill-history-summary">
              <div>
                <span>最近状态</span>
                <strong>{{ refillRecentStatusText(sub2apiRefillStatus.lastError, sub2apiRefillStatus.lastResult) }}</strong>
              </div>
              <div>
                <span>最近正常数</span>
                <strong>{{ sub2apiRefillStatus.lastResult?.normalAccounts ?? "-" }}</strong>
              </div>
              <div>
                <span>下次检测</span>
                <strong>{{ sub2apiRefillStatus.nextCheckAt ? fmtDateTime(sub2apiRefillStatus.nextCheckAt) : "-" }}</strong>
              </div>
              <div>
                <span>补AT状态</span>
                <strong>{{ atRepairRecentStatusText(sub2apiRefillStatus.autoAtRepair.lastError, sub2apiRefillStatus.autoAtRepair.lastResult) }}</strong>
              </div>
              <div>
                <span>K12错误/扫描</span>
                <strong>{{ sub2apiRefillStatus.autoAtRepair.lastResult ? `${sub2apiRefillStatus.autoAtRepair.lastResult.issueAccounts}/${sub2apiRefillStatus.autoAtRepair.lastResult.scannedAccounts}` : "-" }}</strong>
              </div>
              <div>
                <span>已建修复任务</span>
                <strong>{{ sub2apiRefillStatus.autoAtRepair.lastResult?.createdTasks ?? "-" }}</strong>
              </div>
              <div>
                <span>当前任务失败</span>
                <strong>{{ summary.tasks.failed }}</strong>
              </div>
              <div>
                <span>邮箱失败</span>
                <strong>{{ summary.emails.failed }}</strong>
              </div>
            </div>
            <p v-if="sub2apiRefillStatus.autoAtRepair.lastResult || sub2apiRefillStatus.autoAtRepair.lastError" class="hint at-repair-history-hint">
              {{ sub2apiRefillStatus.autoAtRepair.lastError || sub2apiRefillStatus.autoAtRepair.lastResult?.message }}
              <span v-if="sub2apiRefillStatus.autoAtRepair.lastResult?.samples?.length">
                样例：{{ sub2apiRefillStatus.autoAtRepair.lastResult.samples.slice(0, 3).join("；") }}
              </span>
            </p>
            <div class="history-filter-row">
              <button
                v-for="filter in refillHistoryFilters"
                :key="filter.value"
                :class="['filter-chip', {active: refillHistoryFilter === filter.value}]"
                @click="setRefillHistoryFilter(filter.value)"
              >
                {{ filter.label }} {{ filter.count }}
              </button>
            </div>
            <div v-if="refillHistoryFilter === 'batch'" class="table-wrap refill-history-table-wrap">
              <p class="hint batch-history-hint">
                批次表按每次启动/加入空间统计；当前全局任务失败 {{ summary.tasks.failed }}，邮箱失败 {{ summary.emails.failed }}，最近测活失败 {{ sub2apiRefillStatus.lastResult?.deepFailed ?? 0 }}。
              </p>
              <table class="task-table refill-history-table">
                <thead>
                  <tr>
                    <th>批次</th>
                    <th>目标</th>
                    <th>总数</th>
                    <th>成功</th>
                    <th>失败</th>
                    <th>运行/队列</th>
                    <th>取消</th>
                  </tr>
                </thead>
                <tbody>
                  <template v-for="item in activeBatchSummaries" :key="item.id">
                    <tr
                      :class="['history-row', 'batch-history-row', {expanded: isBatchExpanded(item.id)}]"
                      @click="toggleBatchRow(item.id)"
                    >
                      <td>
                        <div class="history-message">
                          <span class="mono">{{ item.id.slice(-8) }}</span>
                          <small>{{ isBatchExpanded(item.id) ? "点击收起详情" : "点击展开详情" }}</small>
                        </div>
                      </td>
                      <td>{{ item.target || "-" }}</td>
                      <td>{{ item.total }}</td>
                      <td><span class="status success">{{ item.success }}</span></td>
                      <td><span :class="['status', item.failed ? 'failed' : 'success']">{{ item.failed }}</span></td>
                      <td>{{ item.running }}/{{ item.queued }}</td>
                      <td>{{ item.canceled }}</td>
                    </tr>
                    <tr v-if="isBatchExpanded(item.id)" class="history-detail-row batch-detail-row">
                      <td colspan="7">
                        <div class="history-detail-panel batch-detail-panel">
                          <div class="batch-detail-head">
                            <strong>批次 {{ item.id }}</strong>
                            <span>
                              明细 {{ batchDetails(item.id).rows.length }}/{{ batchDetails(item.id).total }}
                              <template v-if="batchDetails(item.id).limited">，仅展示前 500 条</template>
                            </span>
                          </div>
                          <table class="batch-detail-table">
                            <thead>
                              <tr>
                                <th>状态</th>
                                <th>邮箱</th>
                                <th>workspace</th>
                                <th>K12</th>
                                <th>错误</th>
                              </tr>
                            </thead>
                            <tbody>
                              <tr v-for="row in batchDetails(item.id).rows" :key="row.id">
                                <td><span :class="['status', row.status]">{{ statusText(row.status) }}</span></td>
                                <td class="mono">{{ row.email }}</td>
                                <td class="mono">{{ row.workspace }}</td>
                                <td>{{ row.k12 }}</td>
                                <td class="batch-error">{{ row.error || "-" }}</td>
                              </tr>
                            </tbody>
                          </table>
                        </div>
                      </td>
                    </tr>
                  </template>
                  <tr v-if="!activeBatchSummaries.length">
                    <td colspan="7" class="empty">暂无批次记录。</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div v-else class="table-wrap refill-history-table-wrap">
              <table class="task-table refill-history-table">
                <thead>
                  <tr>
                    <th>时间</th>
                    <th>类型</th>
                    <th>来源</th>
                    <th>结果</th>
                    <th>分组</th>
                    <th>正常/预警</th>
                    <th>深度测活</th>
                    <th>创建任务</th>
                    <th>原因</th>
                  </tr>
                </thead>
                <tbody>
                  <template v-for="item in filteredSub2apiRefillHistory" :key="refillHistoryRowId(item)">
                  <tr
                    :class="['history-row', {expanded: isRefillHistoryExpanded(item)}]"
                    @click="toggleRefillHistoryRow(item)"
                  >
                    <td>{{ fmtDateTime(item.checkedAt) }}</td>
                    <td>{{ refillHistoryKindLabel(item.kind) }}</td>
                    <td>{{ item.source === "timer" ? "定时" : item.source === "manual" ? "手动" : item.source === "system" ? "系统" : "-" }}</td>
                    <td><span :class="['status', refillHistoryOutcome(item).className]">{{ refillHistoryOutcome(item).text }}</span></td>
                    <td>{{ item.groupName || "-" }}</td>
                    <td>{{ item.kind === "at-repair" ? `${item.issueAccounts ?? 0}/${item.scannedAccounts ?? 0}` : `${item.normalAccounts ?? "-"}/${item.threshold ?? "-"}` }}</td>
                    <td>
                      <span v-if="item.deepCheckEnabled">开启 {{ item.deepOk ?? 0 }}/{{ item.deepChecked ?? 0 }}</span>
                      <span v-else>关闭</span>
                    </td>
                    <td>{{ item.createdTasks ?? 0 }}</td>
                    <td>
                      <div class="history-message">
                        <span>{{ refillHistoryPreview(item) }}</span>
                        <small>{{ isRefillHistoryExpanded(item) ? "点击收起" : "点击展开详情" }}</small>
                      </div>
                    </td>
                  </tr>
                  <tr v-if="isRefillHistoryExpanded(item)" class="history-detail-row">
                    <td colspan="9">
                      <div class="history-detail-panel">
                        <div
                          v-for="(line, index) in refillHistoryDetails(item)"
                          :key="`${refillHistoryRowId(item)}-${index}`"
                          class="history-detail-line"
                        >
                          {{ line }}
                        </div>
                        <div v-if="!refillHistoryDetails(item).length" class="history-detail-line muted">暂无详情</div>
                      </div>
                    </td>
                  </tr>
                  </template>
                  <tr v-if="!filteredSub2apiRefillHistory.length">
                    <td colspan="9" class="empty">暂无该分类记录。</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </div>

      <div v-if="showEmailImportModal" class="modal-backdrop" @click.self="closeEmailImport">
        <section class="panel modal-card import-modal" role="dialog" aria-modal="true" aria-labelledby="email-import-title">
          <div class="section-head">
            <div>
              <p class="eyebrow">Import</p>
              <h2 id="email-import-title">邮箱导入</h2>
            </div>
            <div class="modal-actions">
              <button class="ghost small" @click="sampleEmails">示例</button>
              <button class="ghost small" @click="closeEmailImport">关闭</button>
            </div>
          </div>
          <div class="modal-body import-body">
            <div class="mode-toggle">
              <label :class="['mode-card', {active: emailImportMode === 'auto'}]">
                <input v-model="emailImportMode" type="radio" value="auto" />
                <span class="mode-content">
                  <span class="mode-title-row">
                    <strong>自动接码</strong>
                    <em>推荐</em>
                  </span>
                  <small>需要邮箱行包含接码 URL 或 clientId/refreshToken，适合批量自动跑。</small>
                </span>
              </label>
              <label :class="['mode-card', {active: emailImportMode === 'manual'}]">
                <input v-model="emailImportMode" type="radio" value="manual" />
                <span class="mode-content">
                  <span class="mode-title-row">
                    <strong>手动接码</strong>
                    <em>备用</em>
                  </span>
                  <small>只导入邮箱；任务需要验证码时，在任务日志里手动填写。</small>
                </span>
              </label>
            </div>
            <label class="import-file-card">
              <input class="visually-hidden-file" type="file" accept=".txt,text/plain" @change="loadEmailImportFile" />
              <span class="file-icon">TXT</span>
              <span class="file-copy">
                <strong>{{ emailImportFileName || "选择邮箱文件" }}</strong>
                <small>支持 .txt 文件，也可以直接在下方粘贴邮箱内容</small>
              </span>
              <span class="file-action">浏览</span>
            </label>
            <label class="field import-text-field">
              <span>邮箱内容</span>
              <textarea
                v-model="emailText"
                :placeholder="emailImportPlaceholder"
              ></textarea>
            </label>
            <div class="import-footer-row">
              <label v-if="emailImportMode === 'auto'" class="field import-api-field">
                <span>接码 API 域名</span>
                <input v-model="form.mailApiBaseUrl" placeholder="http://wremail.cc/" />
              </label>
              <p v-else class="hint manual-import-hint">
                手动接码模式下每行只要有邮箱即可，例如：
                <code>user@example.com</code>
              </p>
              <div class="row-actions import-actions">
                <button class="ghost" :disabled="importingEmails" @click="clearEmailImport">清空</button>
                <button class="primary" :disabled="!emailText.trim() || importingEmails" @click="importEmails">
                  {{ importingEmails ? "导入中..." : "导入邮箱" }}
                </button>
              </div>
            </div>
            <pre v-if="importResult" class="import-result">{{ importResult }}</pre>
          </div>
        </section>
      </div>

      <div v-if="showEmailPoolModal" class="modal-backdrop" @click.self="closeEmailPool">
        <section class="panel modal-card email-pool-modal" role="dialog" aria-modal="true" aria-labelledby="email-pool-title">
          <div class="section-head">
            <div>
              <p class="eyebrow">Pool List</p>
              <h2 id="email-pool-title">邮箱池列表</h2>
            </div>
            <div class="modal-actions">
              <label class="field split-count-field">
                <span>每个分裂</span>
                <input v-model.number="splitAliasCount" type="number" min="1" max="50" />
              </label>
              <button class="ghost small" :disabled="!selectableParentEmails.length" @click="selectParentEmails">
                只选可启动母号 {{ selectableParentEmails.length }}
              </button>
              <button class="primary small" :disabled="!selectedRunnableEmailIds.length || startingSelectedTasks" :title="selectedLaunchButtonTitle" @click="startSelectedEmailTasks">
                {{ startingSelectedTasks ? "启动中..." : selectedLaunchButtonText }}
              </button>
              <button class="ghost small" :disabled="!selectedRepairableEmailIds.length || checkingAccessTokens" @click="checkSelectedAccessTokens">
                {{ checkingAccessTokens ? "检验中..." : `检验AT ${selectedRepairableEmailIds.length}` }}
              </button>
              <button class="ghost small" :disabled="!selectedRepairableEmailIds.length" @click="repairSelectedAccessTokens">
                修复AT {{ selectedRepairableEmailIds.length }}
              </button>
              <button class="ghost small" :disabled="!selectedEmailIds.length" @click="splitSelectedEmails">
                分裂选中 x{{ splitAliasCount || 4 }}
              </button>
              <button class="danger small" :disabled="!selectedEmailIds.length" @click="deleteSelectedEmails">
                删除选中 {{ selectedEmailIds.length }}
              </button>
              <button class="danger small" :disabled="!summary.emails.failed" @click="deleteEmailsByStatus('failed')">删除失败</button>
              <button class="danger small" :disabled="!freeChildEmails.length" @click="deleteFreeChildEmails">
                删除空闲子邮箱 {{ freeChildEmails.length }}
              </button>
              <button class="danger small" :disabled="!summary.emails.free" @click="deleteEmailsByStatus('free')">删除空闲</button>
              <button class="danger small" :disabled="!summary.emails.banned" @click="deleteEmailsByStatus('banned')">删除GPT封号</button>
              <button class="ghost small" @click="loadEmails">刷新邮箱</button>
              <button class="ghost small" @click="closeEmailPool">关闭</button>
            </div>
          </div>
          <div class="modal-body">
            <div class="pool-status-grid modal-status-grid">
              <div>
                <span>空闲</span>
                <strong>{{ summary.emails.free }}</strong>
              </div>
              <div>
                <span>运行中</span>
                <strong>{{ summary.emails.running }}</strong>
              </div>
              <div>
                <span>成功</span>
                <strong>{{ summary.emails.success }}</strong>
              </div>
              <div>
                <span>失败</span>
                <strong>{{ summary.emails.failed }}</strong>
              </div>
              <div>
                <span>GPT封号</span>
                <strong>{{ summary.emails.banned }}</strong>
              </div>
              <div>
                <span>子邮箱</span>
                <strong>{{ childEmails.length }}</strong>
              </div>
              <div>
                <span>封号子邮箱</span>
                <strong>{{ bannedChildEmails.length }}</strong>
              </div>
            </div>
            <pre v-if="accessTokenCheckResult" class="check-result">{{ accessTokenCheckResult }}</pre>
            <div class="pool-search-row">
              <label class="pool-search-field">
                <span>筛选邮箱</span>
                <input
                  v-model.trim="emailPoolSearch"
                  placeholder="邮箱 / 母号 / Sub2API账号"
                  autocomplete="off"
                  spellcheck="false"
                />
              </label>
              <button class="ghost small" :disabled="!emailPoolSearch" @click="emailPoolSearch = ''">清空</button>
              <small class="muted">显示 {{ filteredEmails.length }} / {{ emails.length }}</small>
            </div>
            <div class="pool-filter-bar" role="tablist" aria-label="邮箱池筛选">
              <button
                v-for="filter in emailPoolFilters"
                :key="filter.value"
                type="button"
                :class="['filter-chip', {active: emailPoolFilter === filter.value}]"
                @click="selectEmailPoolFilter(filter.value)"
              >
                <span>{{ filter.value === "atRepairNeeded" && checkingAccessTokens ? "检测中" : filter.label }}</span>
                <strong>{{ filter.count }}</strong>
              </button>
            </div>
            <div class="table-wrap modal-table">
              <table>
                <thead>
                  <tr>
                    <th>
                      <input
                        type="checkbox"
                        :checked="allVisibleEmailsSelected"
                        :disabled="!deletableEmails.length"
                        @change="toggleAllEmails"
                      />
                    </th>
                    <th>邮箱</th>
                    <th>状态</th>
                    <th>接码</th>
                    <th>Sub2API</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="item in filteredEmails" :key="item.id">
                    <td>
                      <input
                        type="checkbox"
                        :checked="selectedEmailIds.includes(item.id)"
                        :disabled="item.status === 'running'"
                        @change="toggleEmailSelection(item.id)"
                      />
                    </td>
                    <td>
                      <div class="cell-with-action">
                        <span class="mono clipped">{{ item.email }}</span>
                        <span v-if="emailAtCheckResults[item.id]" :class="['at-result-badge', emailAtCheckResults[item.id].ok ? 'ok' : 'bad']">
                          {{ emailAtCheckResults[item.id].ok ? "AT正常" : "需修复" }}
                        </span>
                        <button class="ghost tiny" @click="copyText(item.email, '邮箱已复制')">复制</button>
                        <button class="ghost tiny" :disabled="!canRepairEmail(item) || checkingAccessTokens" @click="checkEmailAccessToken(item)">
                          检验AT
                        </button>
                        <button class="ghost tiny" :disabled="!canRepairEmail(item)" @click="repairEmailAccessToken(item)">
                          修复AT
                        </button>
                      </div>
                      <div v-if="item.parentEmail" class="email-meta-row">
                        <span :class="['child-badge', item.status === 'banned' ? 'banned' : '']">
                          {{ item.status === "banned" ? "子邮箱 · GPT封号" : "子邮箱" }}
                        </span>
                        <small class="muted">母邮箱：{{ item.parentEmail }}</small>
                      </div>
                    </td>
                    <td><span :class="['status', item.status]">{{ statusText(item.status) }}</span></td>
                    <td>
                      <span :class="['otp-mode-badge', item.otpMode === 'manual' ? 'manual' : item.otpMode === 'emailnator' ? 'emailnator' : 'auto']">
                        {{ item.otpMode === "manual" ? "手动接码" : item.otpMode === "emailnator" ? "Emailnator" : item.otpMode === "smsbower-mail" ? "SMSBower" : "自动接码" }}
                      </span>
                      <small class="muted clipped">{{ item.mailboxUrlMasked }}</small>
                    </td>
                    <td class="mono clipped">{{ item.sub2apiAccount || "-" }}</td>
                    <td><button class="danger small" :disabled="item.status === 'running'" @click="deleteEmail(item.id, item.email)">删除</button></td>
                  </tr>
                  <tr v-if="!filteredEmails.length">
                    <td colspan="6" class="empty">{{ emails.length ? "当前筛选下没有邮箱。" : "还没有邮箱，先在上方导入。" }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </div>

      <div v-if="showTaskLogModal && selectedTask" class="modal-backdrop" @click.self="closeTaskLog">
        <section class="panel modal-card log-modal" role="dialog" aria-modal="true" aria-labelledby="task-log-title">
          <div class="section-head">
            <div>
              <p class="eyebrow">Logs</p>
              <h2 id="task-log-title">{{ selectedTask.email }}</h2>
            </div>
            <div class="modal-actions">
              <button
                v-if="selectedTask.status === 'queued' || selectedTask.status === 'running'"
                class="danger small"
                @click="cancelTask(selectedTask.id)"
              >
                取消任务
              </button>
              <button
                v-if="canDeleteTask(selectedTask)"
                class="ghost small"
                @click="retryTask(selectedTask.id)"
              >
                重试任务
              </button>
              <button
                v-if="canDeleteTask(selectedTask)"
                class="danger small"
                @click="deleteTask(selectedTask.id)"
              >
                删除任务
              </button>
              <button class="ghost small" @click="closeTaskLog">关闭</button>
            </div>
          </div>
          <div class="modal-body">
            <div class="result-grid">
              <div class="mini-result">
                <span>状态</span>
                <strong>{{ statusText(selectedTask.status) }}</strong>
              </div>
              <div class="mini-result">
                <span>邮箱</span>
                <strong>{{ selectedTask.email }}</strong>
                <button class="ghost tiny" @click="copyText(selectedTask.email, '邮箱已复制')">复制邮箱</button>
              </div>
              <div class="mini-result">
                <span>AT</span>
                <strong>{{ selectedTask.accessTokenPreview || "-" }}</strong>
                <button
                  class="ghost tiny"
                  :disabled="!selectedTask.accessToken && !selectedTask.accessTokenPreview"
                  @click="copyAccessToken(selectedTask)"
                >
                  复制 AT
                </button>
              </div>
              <div class="mini-result">
                <span>Sub2API</span>
                <strong>{{ selectedTask.sub2apiAccount || "-" }}</strong>
              </div>
              <div class="mini-result">
                <span>JSON 文件</span>
                <strong>{{ selectedTask.jsonOutFile || "-" }}</strong>
              </div>
              <div class="mini-result">
                <span>K12 成功</span>
                <strong>{{ selectedTask.workspaceResults.filter((r) => r.ok).length }}/{{ selectedTask.workspaceIds.length }}</strong>
              </div>
              <div class="mini-result proxy-usage-mini">
                <span>今日使用代理</span>
                <strong v-if="selectedTask.dailyOpenAiProxyUsage?.length" :title="proxyUsageTitle(selectedTask.dailyOpenAiProxyUsage)">
                  {{ selectedTask.dailyOpenAiProxyUsage.slice(0, 3).map(formatProxyUsage).join(" / ") }}
                  <small v-if="selectedTask.dailyOpenAiProxyUsage.length > 3">+{{ selectedTask.dailyOpenAiProxyUsage.length - 3 }}</small>
                </strong>
                <strong v-else>-</strong>
              </div>
            </div>
            <div v-if="selectedTask.waitingOtp" class="manual-otp-panel">
              <div>
                <p class="eyebrow">Manual OTP</p>
                <h3>等待手动输入验证码</h3>
                <p class="hint">
                  {{ selectedTask.waitingOtpLabel || "邮箱" }}验证码已发送到
                  <strong>{{ selectedTask.waitingOtpEmail || selectedTask.email }}</strong>
                </p>
              </div>
              <div class="manual-otp-actions">
                <input
                  v-model="manualOtpCode"
                  class="manual-otp-input"
                  inputmode="numeric"
                  maxlength="6"
                  placeholder="6位验证码"
                  @keyup.enter="submitManualOtp"
                />
                <button class="primary" :disabled="manualOtpCode.trim().length !== 6 || submittingOtp" @click="submitManualOtp">
                  {{ submittingOtp ? "提交中..." : "提交验证码" }}
                </button>
              </div>
            </div>
            <ol class="logs">
              <li v-for="(log, index) in selectedTask.logs" :key="index" :class="log.level">
                <time>{{ fmtTime(log.at) }}</time>
                <span>{{ log.message }}</span>
              </li>
              <li v-if="!selectedTask.logs.length" class="empty-log">
                <span>暂无日志。</span>
              </li>
            </ol>
          </div>
        </section>
      </div>

    </Teleport>
  </main>
</template>

<script setup lang="ts">
import {computed, onMounted, onUnmounted, reactive, ref, watch} from "vue";
import {
  isK12RepairNeededResult,
  mergeK12RepairScanResults,
} from "./emailPoolRepairFilter";
import {
  isRunnableMotherEmail,
  launchTaskTotal,
  summarizeLaunchSelection,
  type WorkspaceLaunchMode,
} from "./emailLaunch";
import {
  activeTaskIdsOfGroup,
  buildTaskGroups,
  buildTaskRootGroups,
  canTopUpTaskGroupFission,
  visibleTaskTreeKeys,
  visibleTasksForWorkspaceIds,
  type TaskGroupRow,
  type TaskRootGroupRow,
} from "./taskGroups";
import {taskDetailNumber, taskRootNumber, taskWorkspaceNumber} from "./taskTreeNumber";
import {taskTreeToneClass, taskWorkspaceToneClass} from "./taskTreeTone";
import {workspaceStateFromRootGroup, workspaceStateFromStatus, workspaceStateFromTask} from "./workspaceDisplayState";
import {atRepairRecentStatusText, refillHistoryOutcome, refillRecentStatusText} from "./refillHistoryView";
import {refillHistoryDetailLines, refillHistoryPreviewText} from "./refillHistoryDetails";
import {launchBatchDetailRows, type LaunchBatchDetailRows} from "./launchBatchDetails";
import {summarizeLaunchBatches} from "./launchBatchSummary";
import {mergeTaskDetailWithListTask} from "./taskDetailMerge";
import {dedupeWorkspaceIds, parseWorkspaceIds} from "./workspaceIds";

interface EmailItem {
  id: string;
  email: string;
  parentEmail?: string;
  otpMode?: string;
  status: string;
  mailboxUrlMasked: string;
  sub2apiAccount?: string;
  lastError?: string;
}

type EmailPoolFilter = "all" | "parent" | "child" | "free" | "running" | "success" | "failed" | "banned" | "bannedChild" | "atRepairNeeded";
type RefillHistoryFilter = "all" | "refill" | "at-repair" | "delete-403" | "workspace-delete" | "batch";

interface OpenAiProxyUsageItem {
  label: string;
  maskedProxyUrl: string;
  count: number;
  lastUsedAt: string;
  username?: string;
  node?: string;
  endpoint?: string;
  proxyHost?: string;
}

interface TaskItem {
  id: string;
  kind?: string;
  emailId?: string;
  email: string;
  rootEmail?: string;
  parentEmail?: string;
  otpMode?: string;
  status: string;
  route: string;
  error?: string;
  createdAt?: string;
  updatedAt?: string;
  startedAt?: string;
  finishedAt?: string;
  notBefore?: string;
  accessToken?: string;
  accessTokenPreview?: string;
  accessTokenLiveness?: string;
  accessTokenLivenessStatus?: number;
  accessTokenLivenessMessage?: string;
  accessTokenLivenessCheckedAt?: string;
  sub2apiAccount?: string;
  jsonOutFile?: string;
  jsonOutFormat?: string;
  waitingOtp?: boolean;
  waitingOtpLabel?: string;
  waitingOtpEmail?: string;
  waitingOtpSince?: string;
  smsBowerMailRoot?: string;
  smsBowerFissionRemainingAfterThis?: number;
  smsBowerFissionChildrenRemaining?: number;
  launchBatchId?: string;
  launchBatchTargetTasks?: number;
  smsBowerBatchId?: string;
  smsBowerBatchTargetSuccesses?: number;
  workspaceBlocked?: boolean;
  workspaceBlockReason?: string;
  workspaceIds: string[];
  workspaceResults: Array<{ok: boolean}>;
  dailyOpenAiProxyUsage?: OpenAiProxyUsageItem[];
  logs: Array<{at: string; level: string; message: string}>;
}

interface WorkspaceBlockItem {
  rootEmail: string;
  workspaceId: string;
  reason: string;
  createdAt: string;
  updatedAt: string;
  scope?: "root" | "email";
  source?: string;
  accountName?: string;
}

type TaskTableGroup = TaskGroupRow<TaskItem>;
type TaskTableRootGroup = TaskRootGroupRow<TaskItem>;
type TaskSelectionGroup = {key: string; tasks: TaskItem[]; primaryTask: TaskItem};

interface AccessTokenCheckItem {
  emailId?: string;
  email: string;
  accountName?: string;
  accountId?: string;
  ok: boolean;
  issue?: string;
  repairable?: boolean;
  status: number;
  message: string;
  latencyMs: number;
}

interface Sub2ApiRefillResult {
  id?: string;
  kind?: "refill" | "at-repair" | "delete-403" | "workspace-delete" | "batch" | "runtime";
  checkedAt: string;
  source?: "manual" | "timer" | "system";
  ok?: boolean;
  groupName: string;
  groupLabel: string;
  threshold: number;
  refillEmailCount: number;
  deepCheckEnabled?: boolean;
  basicNormalAccounts?: number;
  normalAccounts: number;
  deepChecked?: number;
  deepOk?: number;
  deepFailed?: number;
  pendingTasks: number;
  availableEmails: number;
  createdTasks: number;
  shouldRefill: boolean;
  message: string;
  error?: string;
  samples?: string[];
  scannedAccounts?: number;
  issueAccounts?: number;
  skippedTerminal?: number;
}

interface Sub2ApiAutoAtRepairResult {
  checkedAt: string;
  source?: "manual" | "timer";
  groupName: string;
  groupLabel: string;
  scannedAccounts: number;
  issueAccounts: number;
  matchedEmails: number;
  createdTasks: number;
  skippedRunning: number;
  skippedUnmatched: number;
  skippedTerminal?: number;
  message: string;
  samples?: string[];
}

interface Sub2ApiAutoAtRepairStatus {
  enabled: boolean;
  running: boolean;
  lastCheckedAt: string;
  lastError: string;
  lastResult: Sub2ApiAutoAtRepairResult | null;
}

interface Sub2ApiRefillStatus {
  enabled: boolean;
  running: boolean;
  nextCheckAt: string;
  lastCheckedAt: string;
  lastError: string;
  lastResult: Sub2ApiRefillResult | null;
  history?: Sub2ApiRefillResult[];
  autoAtRepair: Sub2ApiAutoAtRepairStatus;
}

interface SmsBowerAccountStatus {
  enabled: boolean;
  apiKeyPresent: boolean;
  apiKeyMasked: string;
  ok: boolean;
  balance?: number;
  currency: string;
  localSpend: number;
  rentedCount: number;
  closedCount: number;
  fetchedAt: string;
  error?: string;
}

const defaultSummary = {
  emails: {total: 0, free: 0, running: 0, success: 0, failed: 0, banned: 0},
  tasks: {total: 0, queued: 0, running: 0, success: 0, failed: 0, canceled: 0},
};

const summary = reactive(JSON.parse(JSON.stringify(defaultSummary)));
const sub2apiRefillStatus = reactive<Sub2ApiRefillStatus>({
  enabled: false,
  running: false,
  nextCheckAt: "",
  lastCheckedAt: "",
  lastError: "",
  lastResult: null,
  history: [],
  autoAtRepair: {
    enabled: false,
    running: false,
    lastCheckedAt: "",
    lastError: "",
    lastResult: null,
  },
});
const sub2apiRefillHistory = ref<Sub2ApiRefillResult[]>([]);
const refillHistoryFilter = ref<RefillHistoryFilter>("all");
const expandedRefillHistoryIds = ref<string[]>([]);
const expandedBatchIds = ref<string[]>([]);
const emails = ref<EmailItem[]>([]);
const tasks = ref<TaskItem[]>([]);
const workspaceBlocks = ref<WorkspaceBlockItem[]>([]);
const selectedTask = ref<TaskItem | null>(null);
const selectedTaskDetailLoadingId = ref("");
const emailText = ref("");
const emailImportMode = ref<"auto" | "manual">("auto");
const emailImportFileName = ref("");
const importResult = ref("");
const manualOtpCode = ref("");
const submittingOtp = ref(false);
const importingEmails = ref(false);
const checkingAccessTokens = ref(false);
const checkingTasks = ref(false);
const checkingTaskAtId = ref("");
const retryingFailedTasks = ref(false);
const stoppingActiveTasks = ref(false);
const toppingUpFissionKey = ref("");
const toppingUpAllFission = ref(false);
const accessTokenCheckResult = ref("");
const taskCheckResult = ref("");
const selectedEmailIds = ref<string[]>([]);
const selectedTaskIds = ref<string[]>([]);
const emailPoolFilter = ref<EmailPoolFilter>("all");
const emailPoolSearch = ref("");
const emailAtCheckResults = ref<Record<string, AccessTokenCheckItem>>({});
const taskPageSize = 50;
const taskPage = ref(1);
const expandedTaskGroupKeys = ref<string[]>([]);
const dataImportInput = ref<HTMLInputElement | null>(null);
const splitAliasCount = ref(4);
const workspaceText = ref("");
const dedupingWorkspaceIds = ref(false);
const workspaceDedupeMessage = ref("");
const runCount = ref(1);
const workspaceLaunchMode = ref<WorkspaceLaunchMode>("all");
const toast = ref("");
const savingConfig = ref(false);
const importingData = ref(false);
const startingSelectedTasks = ref(false);
const startingSub2apiRefill = ref(false);
const startingSub2apiAutoAtRepair = ref(false);
const smsBowerApiKeySaved = ref(false);
const smsBowerApiKeyMasked = ref("");
const smsBowerBackendUnsupported = ref(false);
const openAiProxyPoolCountSaved = ref(0);
const openAiProxyPoolMasked = ref<string[]>([]);
const openAiProxySubscriptionCountSaved = ref(0);
const openAiProxyMihonoMappingRows = ref<any[]>([]);
const openAiProxyMihonoMappingCount = ref(0);
const openAiProxyMihonoMappingTotalCount = ref(0);
const openAiProxyMihonoMappingFilteredCount = ref(0);
const openAiProxyMihonoPasswordSaved = ref(false);
const openAiProxyMihonoPasswordMasked = ref("");
const testingMihonoProxy = ref(false);
const mihonoProxyTestMessage = ref("");
const smsBowerAccount = reactive<SmsBowerAccountStatus>({
  enabled: false,
  apiKeyPresent: false,
  apiKeyMasked: "",
  ok: false,
  currency: "USD",
  localSpend: 0,
  rentedCount: 0,
  closedCount: 0,
  fetchedAt: "",
});
const showSettingsModal = ref(false);
const showEmailImportModal = ref(false);
const showEmailPoolModal = ref(false);
const showTaskLogModal = ref(false);
const showSub2apiRefillHistoryModal = ref(false);
let timer: number | undefined;
let smsBowerAccountTimer: number | undefined;

const form = reactive({
  defaultPassword: "",
  defaultProxyUrl: "",
  openAiProxyPoolEnabled: false,
  openAiProxyPoolText: "",
  openAiProxyPoolApiUrl: "",
  openAiProxySubscriptionText: "",
  openAiProxyMihonoUsername: "",
  openAiProxyMihonoPassword: "",
  openAiProxyPoolMaxRetries: 2,
  mailApiBaseUrl: "",
  workspaceIds: [] as string[],
  route: "request",
  joinIntervalMs: 1500,
  poolFissionMailboxOtpCooldownMs: 300000,
  taskConcurrency: 1,
  runWorkspaceJoin: true,
  runSub2Api: true,
  sub2apiNoRtMode: false,
  sub2apiUrl: "",
  sub2apiEmail: "",
  sub2apiPassword: "",
  sub2apiGroupName: "k12",
  sub2apiProxyName: "",
  sub2apiAccountPriority: 1,
  sub2apiConcurrency: 10,
  sub2apiAutoRefillEnabled: false,
  sub2apiAutoAtRepairEnabled: false,
  sub2apiRefillGroupName: "k12",
  sub2apiRefillThreshold: 5,
  sub2apiRefillEmailCount: 5,
  sub2apiRefillIntervalMs: 300000,
  sub2apiRefillDeepCheckEnabled: false,
  gmailMailProvider: "smsbower",
  smsBowerMailEnabled: false,
  smsBowerApiKey: "",
  smsBowerMailBaseUrl: "https://smsbower.page/api/mail",
  smsBowerMailService: "openai",
  smsBowerMailDomain: "gmail.com",
  smsBowerMailMaxPrice: "",
  smsBowerGmailFissionEnabled: false,
  smsBowerGmailFissionCount: 1,
  emailnatorBaseUrl: "https://www.emailnator.com",
  emailnatorEmailType: "plusGmail",
  tokenOut: "",
  jsonOutDir: "",
  jsonOutFormat: "sub2api",
});

const busy = computed(() => summary.tasks.running > 0 || summary.tasks.queued > 0);
const activeTaskCount = computed(() => summary.tasks.running + summary.tasks.queued);
const workspaceCount = computed(() => currentWorkspaceIds().length);
const launchMotherCount = computed(() => {
  const count = Math.max(1, Number(runCount.value) || 1);
  return form.smsBowerMailEnabled ? count : Math.min(count, emails.value.filter(isRunnableMotherEmail).length);
});
const launchTaskCount = computed(() => launchTaskTotal(launchMotherCount.value, workspaceCount.value, workspaceLaunchMode.value));
const startTasksDisabled = computed(() => busy.value || (!form.smsBowerMailEnabled && launchTaskCount.value <= 0));
const filteredEmails = computed(() => emails.value.filter((item) => matchesEmailPoolFilter(item, emailPoolFilter.value) && matchesEmailPoolSearch(item)));
const atRepairNeededEmails = computed(() => emails.value.filter((item) => isK12RepairNeededResult(emailAtCheckResults.value[item.id]) && canRepairEmail(item)));
const emailPoolFilters = computed<Array<{value: EmailPoolFilter; label: string; count: number}>>(() => [
  {value: "all", label: "全部", count: emails.value.length},
  {value: "atRepairNeeded", label: "需修复", count: atRepairNeededEmails.value.length},
  {value: "parent", label: "母号", count: emails.value.filter((item) => !item.parentEmail).length},
  {value: "child", label: "子号", count: emails.value.filter((item) => Boolean(item.parentEmail)).length},
  {value: "free", label: "空闲", count: emails.value.filter((item) => item.status === "free").length},
  {value: "running", label: "运行", count: emails.value.filter((item) => item.status === "running").length},
  {value: "success", label: "成功", count: emails.value.filter((item) => item.status === "success").length},
  {value: "failed", label: "失败", count: emails.value.filter((item) => item.status === "failed").length},
  {value: "banned", label: "封号", count: emails.value.filter((item) => item.status === "banned").length},
  {value: "bannedChild", label: "封号子号", count: emails.value.filter((item) => Boolean(item.parentEmail) && item.status === "banned").length},
]);
const selectedVisibleEmailIds = computed(() => filteredEmails.value
  .filter((item) => selectedEmailIds.value.includes(item.id))
  .map((item) => item.id));
const selectedRunnableEmailIds = computed(() => filteredEmails.value
  .filter((item) => selectedEmailIds.value.includes(item.id) && isRunnableMotherEmail(item))
  .map((item) => item.id));
const selectedLaunchSummary = computed(() => summarizeLaunchSelection({
  selectedCount: selectedVisibleEmailIds.value.length,
  runnableMotherCount: selectedRunnableEmailIds.value.length,
  workspaceCount: workspaceCount.value,
  workspaceLaunchMode: workspaceLaunchMode.value,
}));
const selectedRunnableTaskCount = computed(() => selectedLaunchSummary.value.taskCount);
watch(activeTaskCount, (count) => {
  if (count <= 0) stoppingActiveTasks.value = false;
});
function launchWorkspaceModeText(multiplier: number) {
  if (workspaceLaunchMode.value === "random-one") return "随机1空间";
  return multiplier > 1 ? `${multiplier}空间` : "1批";
}
const selectedLaunchButtonText = computed(() => {
  const summary = selectedLaunchSummary.value;
  const workspaceText = launchWorkspaceModeText(summary.workspaceMultiplier);
  if (!summary.selectedCount) return `启动选中 ${summary.taskCount}`;
  const skippedText = summary.skippedCount ? `，跳过${summary.skippedCount}` : "";
  return `启动选中 ${summary.taskCount}（${summary.runnableMotherCount}×${workspaceText}${skippedText}）`;
});
const selectedLaunchButtonTitle = computed(() => {
  const summary = selectedLaunchSummary.value;
  const skippedText = summary.skippedCount ? `；跳过 ${summary.skippedCount} 个不可启动（子号/运行中）` : "";
  return `已勾选 ${summary.selectedCount} 个；可启动母号 ${summary.runnableMotherCount} 个；空间模式 ${launchWorkspaceModeText(summary.workspaceMultiplier)}；任务数 ${summary.runnableMotherCount} × ${summary.workspaceMultiplier} = ${summary.taskCount}${skippedText}`;
});
const selectedRepairableEmailIds = computed(() => emails.value
  .filter((item) => selectedEmailIds.value.includes(item.id) && item.status !== "running" && item.status !== "banned")
  .map((item) => item.id));
const checkableTasks = computed(() => tasks.value.filter((item) => canCheckTaskAt(item)));
const selectedCheckableTaskIds = computed(() => checkableTasks.value
  .filter((item) => selectedTaskIds.value.includes(item.id))
  .map((item) => item.id));
const allCheckableTasksSelected = computed(() => checkableTasks.value.length > 0 && checkableTasks.value.every((item) => selectedTaskIds.value.includes(item.id)));
const inactiveMarkedTasks = computed(() => tasks.value.filter((item) => item.accessTokenLiveness === "inactive" || item.accessTokenLiveness === "banned"));
const sortedTasks = computed(() => {
  const rank = (status: string) => status === "running" ? 0 : status === "queued" ? 1 : 2;
  return visibleTasksForWorkspaceIds(tasks.value, currentWorkspaceIds())
    .map((task, index) => ({task, index}))
    .sort((a, b) => rank(a.task.status) - rank(b.task.status) || a.index - b.index)
    .map((item) => item.task);
});
const taskGroups = computed(() => buildTaskGroups(sortedTasks.value, {minimumTargetChildren: form.smsBowerGmailFissionCount}));
const taskRootGroups = computed(() => buildTaskRootGroups(sortedTasks.value, {minimumTargetChildren: form.smsBowerGmailFissionCount}));
const topUpFissionGroups = computed(() => taskGroups.value.filter(canTopUpFission));
const taskTotalPages = computed(() => Math.max(1, Math.ceil(taskRootGroups.value.length / taskPageSize)));
const taskPageStart = computed(() => (taskPage.value - 1) * taskPageSize);
const taskPageEnd = computed(() => Math.min(taskRootGroups.value.length, taskPageStart.value + taskPageSize));
const pagedTaskRootGroups = computed(() => taskRootGroups.value.slice(taskPageStart.value, taskPageEnd.value));
const selectableParentEmails = computed(() => filteredEmails.value.filter(isRunnableMotherEmail));
const passwordPlaceholder = computed(() => form.sub2apiPassword ? "已填写" : "留空则不修改已保存密码");
const smsBowerApiKeyPlaceholder = computed(() => form.smsBowerApiKey || smsBowerApiKeySaved.value ? "已设置 Key，留空则不修改" : "填写 SMSBower API Key");
const smsBowerBalanceText = computed(() => {
  if (!form.smsBowerMailEnabled) return "未启用";
  if (form.gmailMailProvider === "emailnator") return "Emailnator";
  if (!smsBowerAccount.apiKeyPresent) return "未设置Key";
  if (smsBowerAccount.ok && smsBowerAccount.balance !== undefined) return `${formatMoney(smsBowerAccount.balance)} ${smsBowerAccount.currency || "USD"}`;
  return "获取失败";
});
const smsBowerSpendText = computed(() => {
  if (!form.smsBowerMailEnabled) return "动态 Gmail 未启用";
  if (form.gmailMailProvider === "emailnator") return `免费生成 Gmail：${form.emailnatorEmailType || "plusGmail"}`;
  if (!smsBowerAccount.apiKeyPresent) return "设置页填写 Key 后显示余额";
  const base = `本地花费 ${formatMoney(smsBowerAccount.localSpend)} / 租号 ${smsBowerAccount.rentedCount}`;
  if (!smsBowerAccount.ok && smsBowerAccount.error) return `${base}，${smsBowerAccount.error}`;
  return base;
});
const deletableEmails = computed(() => filteredEmails.value.filter((item) => item.status !== "running"));
const childEmails = computed(() => emails.value.filter((item) => Boolean(item.parentEmail)));
const bannedChildEmails = computed(() => childEmails.value.filter((item) => item.status === "banned"));
const freeChildEmails = computed(() => emails.value.filter((item) => Boolean(item.parentEmail) && item.status === "free"));
const allVisibleEmailsSelected = computed(() => deletableEmails.value.length > 0 && deletableEmails.value.every((item) => selectedEmailIds.value.includes(item.id)));
const refillSummaryText = computed(() => {
  const result = sub2apiRefillStatus.lastResult;
  if (sub2apiRefillStatus.running) return "检测中";
  if (sub2apiRefillStatus.lastError) return `错误：${sub2apiRefillStatus.lastError}`;
  if (!result) return sub2apiRefillStatus.enabled ? "等待首次检测" : "未启用";
  return `${result.groupName} / 预警 ${result.threshold} / 已补 ${result.createdTasks}`;
});
const autoAtRepairSummaryText = computed(() => {
  const status = sub2apiRefillStatus.autoAtRepair;
  const result = status.lastResult;
  if (status.running) return "扫描中";
  if (status.lastError) return `错误：${status.lastError}`;
  if (!result) return status.enabled ? "等待首次自检" : "未启用";
  return `${result.groupName} / 错 ${result.issueAccounts} / 已补 ${result.createdTasks}`;
});
const refillHistoryKindLabel = (kind?: string) => ({
  refill: "补号",
  "at-repair": "补AT",
  "delete-403": "删除403",
  "workspace-delete": "删空间",
  batch: "批次",
  runtime: "运行",
} as Record<string, string>)[kind || "refill"] || "补号";
const refillHistoryFilters = computed(() => {
  const count = (kind: string) => sub2apiRefillHistory.value.filter((item) => (item.kind || "refill") === kind).length;
  return [
    {value: "all", label: "全部", count: sub2apiRefillHistory.value.length},
    {value: "at-repair", label: "补AT", count: count("at-repair")},
    {value: "refill", label: "补号", count: count("refill")},
    {value: "delete-403", label: "删除403", count: count("delete-403")},
    {value: "workspace-delete", label: "删空间", count: count("workspace-delete")},
    {value: "batch", label: "批次", count: activeBatchSummaries.value.length},
  ];
});
const filteredSub2apiRefillHistory = computed(() => {
  if (refillHistoryFilter.value === "all") return sub2apiRefillHistory.value;
  if (refillHistoryFilter.value === "batch") return [];
  return sub2apiRefillHistory.value.filter((item) => (item.kind || "refill") === refillHistoryFilter.value);
});
function refillHistoryRowId(item: Sub2ApiRefillResult) {
  return item.id || `${item.kind || "refill"}:${item.checkedAt}:${item.message || item.error || ""}`;
}
function isRefillHistoryExpanded(item: Sub2ApiRefillResult) {
  return expandedRefillHistoryIds.value.includes(refillHistoryRowId(item));
}
function toggleRefillHistoryRow(item: Sub2ApiRefillResult) {
  const id = refillHistoryRowId(item);
  expandedRefillHistoryIds.value = expandedRefillHistoryIds.value.includes(id)
    ? expandedRefillHistoryIds.value.filter((itemId) => itemId !== id)
    : [...expandedRefillHistoryIds.value, id];
}
function refillHistoryDetails(item: Sub2ApiRefillResult) {
  return refillHistoryDetailLines(item);
}
function refillHistoryPreview(item: Sub2ApiRefillResult) {
  return refillHistoryPreviewText(item);
}
const activeBatchSummaries = computed(() => {
  return summarizeLaunchBatches(tasks.value);
});
function isBatchExpanded(batchId: string) {
  return expandedBatchIds.value.includes(batchId);
}
function toggleBatchRow(batchId: string) {
  expandedBatchIds.value = expandedBatchIds.value.includes(batchId)
    ? expandedBatchIds.value.filter((item) => item !== batchId)
    : [...expandedBatchIds.value, batchId];
}
function batchDetails(batchId: string): LaunchBatchDetailRows {
  return launchBatchDetailRows(tasks.value, batchId, 500);
}
function setRefillHistoryFilter(value: string) {
  if (["all", "refill", "at-repair", "delete-403", "workspace-delete", "batch"].includes(value)) {
    refillHistoryFilter.value = value as RefillHistoryFilter;
    expandedRefillHistoryIds.value = [];
    expandedBatchIds.value = [];
  }
}
const emailImportPlaceholder = computed(() => emailImportMode.value === "manual"
  ? "手动接码模式：\nuser1@example.com\nuser2@example.com"
  : "支持：\nemail----password----clientId----refreshToken\nemail-----http://mail-api/api/GetLastEmails?email=...");

watch(taskTotalPages, (pages) => {
  if (taskPage.value > pages) taskPage.value = pages;
  if (taskPage.value < 1) taskPage.value = 1;
}, {immediate: true});

watch([taskGroups, taskRootGroups], ([groups, rootGroups]) => {
  const visibleKeys = new Set(visibleTaskTreeKeys(groups, rootGroups));
  expandedTaskGroupKeys.value = expandedTaskGroupKeys.value.filter((key) => visibleKeys.has(key));
});

watch(activeBatchSummaries, (items) => {
  const visibleIds = new Set(items.map((item) => item.id));
  expandedBatchIds.value = expandedBatchIds.value.filter((id) => visibleIds.has(id));
});

watch([emailPoolFilter, emailPoolSearch], () => {
  const visibleIds = new Set(filteredEmails.value.map((item) => item.id));
  selectedEmailIds.value = selectedEmailIds.value.filter((id) => visibleIds.has(id));
});

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

function formatProxyUsage(item: OpenAiProxyUsageItem): string {
  return item.count > 1 ? `${item.label} x${item.count}` : item.label;
}

function proxyUsageTitle(items: OpenAiProxyUsageItem[] = []): string {
  return items.map(formatProxyUsage).join("\n");
}

function showToast(message: string) {
  toast.value = message;
  window.setTimeout(() => {
    if (toast.value === message) toast.value = "";
  }, 2600);
}

function matchesEmailPoolFilter(item: EmailItem, filter: EmailPoolFilter) {
  if (filter === "all") return true;
  if (filter === "atRepairNeeded") return Boolean(isK12RepairNeededResult(emailAtCheckResults.value[item.id]) && canRepairEmail(item));
  if (filter === "parent") return !item.parentEmail;
  if (filter === "child") return Boolean(item.parentEmail);
  if (filter === "bannedChild") return Boolean(item.parentEmail) && item.status === "banned";
  return item.status === filter;
}

function normalizeEmailSearchText(value: string) {
  return value.toLowerCase().replace(/--nort\b/g, "").trim();
}

function matchesEmailPoolSearch(item: EmailItem) {
  const query = normalizeEmailSearchText(emailPoolSearch.value);
  if (!query) return true;
  const fields = [
    item.email,
    item.parentEmail || "",
    item.sub2apiAccount || "",
    item.mailboxUrlMasked || "",
    statusText(item.status),
    item.otpMode || "",
    item.lastError || "",
  ].map(normalizeEmailSearchText);
  return fields.some((field) => field.includes(query));
}

function canRepairEmail(item: EmailItem) {
  return item.status !== "running" && item.status !== "banned";
}

async function selectEmailPoolFilter(filter: EmailPoolFilter) {
  emailPoolFilter.value = filter;
  if (filter === "atRepairNeeded") {
    await refreshK12RepairNeededEmails();
  }
}

function formatTaskCreateSkipReasons(data: any): string {
  const reasons = data?.skippedReasons || {};
  const labels: Record<string, string> = {
    missing: "不存在",
    smsbowerClosed: "SMSBower接码已关闭",
    googleSsoUnsupported: "Google登录不支持",
    running: "运行中",
    banned: "封号",
    success: "已成功",
    active: "已有任务",
    workspaceBlocked: "空间403",
  };
  const parts = Object.entries(labels)
    .map(([key, label]) => {
      const count = Number(reasons[key] || 0);
      return count > 0 ? `${label} ${count}` : "";
    })
    .filter(Boolean);
  const skipped = Number(data?.skippedRunning || 0) + Number(data?.missing || 0);
  if (!skipped) return "";
  return parts.length ? `，跳过 ${skipped} 个（${parts.join("，")}）` : `，跳过 ${skipped} 个`;
}

function currentWorkspaceIds(): string[] {
  return dedupeWorkspaceIds(parseWorkspaceIds(workspaceText.value));
}

function latestSub2apiHistoryOfKind<T>(history: T[], kind: string): T | null {
  return (history as Array<T & {kind?: string}>).find((item) => (item.kind || "refill") === kind) || null;
}

async function dedupeWorkspaceConfig() {
  if (dedupingWorkspaceIds.value) return;
  const workspaceIds = parseWorkspaceIds(workspaceText.value);
  if (!workspaceIds.length) {
    showToast("请先填写 workspace id");
    return;
  }
  dedupingWorkspaceIds.value = true;
  workspaceDedupeMessage.value = "";
  try {
    const localDeduped = dedupeWorkspaceIds(workspaceIds);
    const data = await api<{config?: any; summary?: any; canceledStaleWorkspaceTasks?: number}>("/api/config", {
      method: "PATCH",
      body: JSON.stringify({...form, workspaceIds: localDeduped}),
    });
    const deduped = Array.isArray(data.config?.workspaceIds) ? data.config.workspaceIds : localDeduped;
    const duplicateCount = Math.max(0, workspaceIds.length - deduped.length);
    workspaceText.value = deduped.join("\n");
    form.workspaceIds = deduped;
    if (data.summary) await loadSummary();
    const canceled = Number(data.canceledStaleWorkspaceTasks || 0);
    workspaceDedupeMessage.value = duplicateCount
      ? `已去重 ${duplicateCount} 条重复 workspace ID，保留 ${deduped.length} 条${canceled ? `，取消旧任务 ${canceled} 个` : ""}`
      : `没有重复 workspace ID，当前 ${deduped.length} 条`;
    showToast(workspaceDedupeMessage.value);
  } catch (error) {
    showToast(`空间 ID 去重失败：${error instanceof Error ? error.message : String(error)}`);
  } finally {
    dedupingWorkspaceIds.value = false;
  }
}

function applySub2apiRefillStatus(status: any, fallbackRefillResult: Sub2ApiRefillResult | null = null, fallbackAtRepairResult: Sub2ApiAutoAtRepairResult | null = null) {
  const {autoAtRepair, ...refillStatus} = status || {};
  const history = Array.isArray(refillStatus.history) ? refillStatus.history as Sub2ApiRefillResult[] : [];
  Object.assign(sub2apiRefillStatus, {
    ...refillStatus,
    lastResult: refillStatus.lastResult || fallbackRefillResult || latestSub2apiHistoryOfKind(history, "refill") || null,
  });
  Object.assign(sub2apiRefillStatus.autoAtRepair, {
    ...(autoAtRepair || {}),
    lastResult: autoAtRepair?.lastResult || fallbackAtRepairResult || latestSub2apiHistoryOfKind(history, "at-repair") || null,
  });
}

async function loadSummary() {
  const data = await api<any>("/api/summary");
  Object.assign(summary.emails, data.emails || defaultSummary.emails);
  Object.assign(summary.tasks, data.tasks || defaultSummary.tasks);
  applySub2apiRefillStatus(data.sub2apiRefill || {});
  if (Array.isArray(data.sub2apiRefill?.history)) {
    sub2apiRefillHistory.value = data.sub2apiRefill.history;
  }
}

async function hydrateOpenAiProxySubscriptionsFromMihono() {
  try {
    const data = await api<any>("/api/openai-proxy/mihono-subscriptions");
    const subscriptions = data.subscriptions || {};
    const text = typeof subscriptions.text === "string" ? subscriptions.text : "";
    if (text.trim()) {
      form.openAiProxySubscriptionText = text;
    }
    const count = Number(subscriptions.count || 0);
    if (Number.isFinite(count) && count > 0) {
      openAiProxySubscriptionCountSaved.value = count;
    }
  } catch {
    // Settings can still be edited when Mihono is temporarily unreachable.
  }
}

async function hydrateOpenAiProxyMihonoMappings() {
  try {
    const data = await api<any>("/api/openai-proxy/mihono-mappings");
    const mappings = data.mappings || {};
    openAiProxyMihonoMappingRows.value = Array.isArray(mappings.rows) ? mappings.rows : [];
    openAiProxyMihonoMappingCount.value = Number(mappings.count || openAiProxyMihonoMappingRows.value.length || 0);
    openAiProxyMihonoMappingTotalCount.value = Number(mappings.totalCount || openAiProxyMihonoMappingCount.value || 0);
    openAiProxyMihonoMappingFilteredCount.value = Number(mappings.filteredCount || 0);
  } catch {
    openAiProxyMihonoMappingRows.value = [];
    openAiProxyMihonoMappingCount.value = 0;
    openAiProxyMihonoMappingTotalCount.value = 0;
    openAiProxyMihonoMappingFilteredCount.value = 0;
  }
}

function applyConfigToForm(config: any) {
  smsBowerBackendUnsupported.value = !("smsBowerMailEnabled" in config);
  Object.assign(form, {
    defaultProxyUrl: config.defaultProxyUrl || "",
    openAiProxyPoolEnabled: config.openAiProxyPoolEnabled === true,
    openAiProxyPoolText: "",
    openAiProxyPoolApiUrl: config.openAiProxyPoolApiUrl || "",
    openAiProxySubscriptionText: "",
    openAiProxyMihonoUsername: config.openAiProxyMihonoUsername || "",
    openAiProxyMihonoPassword: "",
    openAiProxyPoolMaxRetries: config.openAiProxyPoolMaxRetries ?? 2,
    mailApiBaseUrl: config.mailApiBaseUrl || "",
    workspaceIds: config.workspaceIds || [],
    route: config.route || "request",
    joinIntervalMs: config.joinIntervalMs || 1500,
    poolFissionMailboxOtpCooldownMs: config.poolFissionMailboxOtpCooldownMs ?? 300000,
    taskConcurrency: config.taskConcurrency || 1,
    runWorkspaceJoin: config.runWorkspaceJoin !== false,
    runSub2Api: config.runSub2Api !== false,
    sub2apiNoRtMode: config.sub2apiNoRtMode === true,
    sub2apiUrl: config.sub2apiUrl || "",
    sub2apiEmail: config.sub2apiEmail || "",
    sub2apiPassword: "",
    sub2apiGroupName: config.sub2apiGroupName || "k12",
    sub2apiProxyName: config.sub2apiProxyName || "",
    sub2apiAccountPriority: config.sub2apiAccountPriority || 1,
    sub2apiConcurrency: config.sub2apiConcurrency || 10,
    sub2apiAutoRefillEnabled: config.sub2apiAutoRefillEnabled === true,
    sub2apiAutoAtRepairEnabled: config.sub2apiAutoAtRepairEnabled === true,
    sub2apiRefillGroupName: config.sub2apiRefillGroupName || config.sub2apiGroupName || "k12",
    sub2apiRefillThreshold: config.sub2apiRefillThreshold ?? 5,
    sub2apiRefillEmailCount: config.sub2apiRefillEmailCount ?? 5,
    sub2apiRefillIntervalMs: config.sub2apiRefillIntervalMs ?? 300000,
    sub2apiRefillDeepCheckEnabled: config.sub2apiRefillDeepCheckEnabled === true,
    gmailMailProvider: config.gmailMailProvider === "emailnator" ? "emailnator" : "smsbower",
    smsBowerMailEnabled: config.smsBowerMailEnabled === true,
    smsBowerApiKey: "",
    smsBowerMailBaseUrl: config.smsBowerMailBaseUrl || "https://smsbower.page/api/mail",
    smsBowerMailService: config.smsBowerMailService || "openai",
    smsBowerMailDomain: config.smsBowerMailDomain || "gmail.com",
    smsBowerMailMaxPrice: config.smsBowerMailMaxPrice || "",
    smsBowerGmailFissionEnabled: config.smsBowerGmailFissionEnabled === true,
    smsBowerGmailFissionCount: config.smsBowerGmailFissionCount ?? 1,
    emailnatorBaseUrl: config.emailnatorBaseUrl || "https://www.emailnator.com",
    emailnatorEmailType: config.emailnatorEmailType || "plusGmail",
    tokenOut: config.tokenOut || "",
    jsonOutDir: config.jsonOutDir || "",
    jsonOutFormat: config.jsonOutFormat === "cpa" ? "cpa" : "sub2api",
  });
  openAiProxyPoolCountSaved.value = Number(config.openAiProxyPoolCount || 0);
  openAiProxyPoolMasked.value = Array.isArray(config.openAiProxyPoolMasked) ? config.openAiProxyPoolMasked : [];
  openAiProxySubscriptionCountSaved.value = Number(config.openAiProxySubscriptionCount || 0);
  openAiProxyMihonoPasswordSaved.value = Boolean(config.openAiProxyMihonoPasswordPresent);
  openAiProxyMihonoPasswordMasked.value = config.openAiProxyMihonoPasswordMasked || "";
  smsBowerApiKeySaved.value = Boolean(config.smsBowerApiKeyPresent);
  smsBowerApiKeyMasked.value = config.smsBowerApiKeyMasked || "";
  workspaceText.value = (config.workspaceIds || []).join("\n");
}

async function hydrateExternalSettingsState() {
  await Promise.allSettled([
    hydrateOpenAiProxySubscriptionsFromMihono(),
    hydrateOpenAiProxyMihonoMappings(),
  ]);
}

async function loadConfig(options: {hydrateExternal?: boolean} = {}) {
  const data = await api<any>("/api/config");
  const config = data.config || {};
  applyConfigToForm(config);
  if (options.hydrateExternal === true) {
    await hydrateExternalSettingsState();
  }
}

async function loadSmsBowerAccount() {
  const data = await api<SmsBowerAccountStatus>("/api/smsbower/account");
  Object.assign(smsBowerAccount, {
    enabled: data.enabled === true,
    apiKeyPresent: data.apiKeyPresent === true,
    apiKeyMasked: data.apiKeyMasked || "",
    ok: data.ok === true,
    balance: data.balance,
    currency: data.currency || "USD",
    localSpend: Number(data.localSpend || 0),
    rentedCount: Number(data.rentedCount || 0),
    closedCount: Number(data.closedCount || 0),
    fetchedAt: data.fetchedAt || "",
    error: data.error || "",
  });
  smsBowerApiKeySaved.value = data.apiKeyPresent === true;
  smsBowerApiKeyMasked.value = data.apiKeyMasked || smsBowerApiKeyMasked.value;
}

async function saveConfig() {
  if (savingConfig.value) return false;
  savingConfig.value = true;
  try {
    const requestedSmsBowerEnabled = form.smsBowerMailEnabled === true;
    const payload = {
      ...form,
      workspaceIds: currentWorkspaceIds(),
    };
    const saved = await api<any>("/api/config", {method: "PATCH", body: JSON.stringify(payload)});
    const savedConfig = saved.config || {};
    if (requestedSmsBowerEnabled && !("smsBowerMailEnabled" in savedConfig)) {
      smsBowerBackendUnsupported.value = true;
      throw new Error("当前后端仍是旧版本，未识别 SMSBower 配置字段。请重启服务后再保存。");
    }
    applyConfigToForm(savedConfig);
    await loadSummary();
    void hydrateExternalSettingsState();
    void refreshSmsBowerAccountQuietly();
    if (requestedSmsBowerEnabled && !form.smsBowerMailEnabled) {
      throw new Error("SMSBower Gmail 开关未保存成功，请重启后端后重试。");
    }
    showSettingsModal.value = false;
    showToast(`配置已保存${form.smsBowerMailEnabled ? `：${form.gmailMailProvider === "emailnator" ? "Emailnator Gmail" : "SMSBower Gmail"} 已启用` : ""}`);
    return true;
  } catch (error) {
    showToast(`保存配置失败：${error instanceof Error ? error.message : String(error)}`);
    return false;
  } finally {
    savingConfig.value = false;
  }
}

async function testMihonoProxyPool() {
  if (testingMihonoProxy.value) return;
  testingMihonoProxy.value = true;
  mihonoProxyTestMessage.value = "";
  try {
    const data = await api<any>("/api/openai-proxy/test-mihono-proxy", {method: "POST", body: "{}"});
    const result = data.result || {};
    if (result.ok) {
      mihonoProxyTestMessage.value = `可用：代理 ${result.proxyCount || 0} 条，测试 ${result.testedProxyMasked || "第一条"} HTTP ${result.status || ""}`.trim();
    } else {
      mihonoProxyTestMessage.value = `不可用：代理 ${result.proxyCount || 0} 条，${result.error || "测试失败"}`;
    }
    await hydrateOpenAiProxyMihonoMappings();
  } catch (error) {
    mihonoProxyTestMessage.value = `测试失败：${error instanceof Error ? error.message : String(error)}`;
  } finally {
    testingMihonoProxy.value = false;
  }
}

async function loadEmails() {
  const data = await api<any>("/api/emails");
  emails.value = data.items || [];
  const existingIds = new Set(emails.value.map((item) => item.id));
  selectedEmailIds.value = selectedEmailIds.value.filter((id) => existingIds.has(id));
  emailAtCheckResults.value = Object.fromEntries(
    Object.entries(emailAtCheckResults.value).filter(([id]) => existingIds.has(id)),
  );
}

function openSettings() {
  showSettingsModal.value = true;
  void hydrateExternalSettingsState();
}

function closeSettings() {
  showSettingsModal.value = false;
}

function openEmailImport() {
  showEmailImportModal.value = true;
}

function closeEmailImport() {
  showEmailImportModal.value = false;
}

async function openEmailPool() {
  showEmailPoolModal.value = true;
  await Promise.all([loadSummary(), loadEmails()]);
}

function closeEmailPool() {
  showEmailPoolModal.value = false;
  selectedEmailIds.value = [];
}

async function loadSub2apiRefillHistory() {
  const data = await api<any>("/api/sub2api/refill/history?limit=100");
  sub2apiRefillHistory.value = data.items || [];
}

async function openSub2apiRefillHistory() {
  showSub2apiRefillHistoryModal.value = true;
  await Promise.all([loadSummary(), loadSub2apiRefillHistory()]);
}

function closeSub2apiRefillHistory() {
  showSub2apiRefillHistoryModal.value = false;
  expandedRefillHistoryIds.value = [];
  expandedBatchIds.value = [];
}

async function loadTasks() {
  const data = await api<any>("/api/tasks");
  tasks.value = data.items || [];
  workspaceBlocks.value = data.workspaceBlocks || [];
  const existing = new Set(tasks.value.map((item) => item.id));
  selectedTaskIds.value = selectedTaskIds.value.filter((id) => existing.has(id));
  if (selectedTask.value) {
    const listTask = tasks.value.find((item) => item.id === selectedTask.value?.id);
    if (listTask) selectedTask.value = mergeTaskDetailWithListTask(selectedTask.value, listTask);
    if (showTaskLogModal.value) void refreshSelectedTaskDetail(selectedTask.value.id);
  } else if (tasks.value.length) {
    selectedTask.value = sortedTasks.value[0];
  }
}

async function refreshAll() {
  await Promise.all([loadSummary(), loadEmails(), loadTasks()]);
}

async function refreshSmsBowerAccountQuietly() {
  try {
    await loadSmsBowerAccount();
  } catch {
    Object.assign(smsBowerAccount, {
      ...smsBowerAccount,
      ok: false,
      error: "余额接口请求失败",
      fetchedAt: new Date().toISOString(),
    });
  }
}

async function exportData() {
  try {
    const response = await fetch("/api/data/export");
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || `HTTP ${response.status}`);
    }
    const blob = await response.blob();
    const disposition = response.headers.get("content-disposition") || "";
    const matched = disposition.match(/filename="?([^"]+)"?/i);
    const filename = matched?.[1] || `gpt-k12-data-${new Date().toISOString().slice(0, 10)}.json`;
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    showToast("数据导出已开始下载");
  } catch (error) {
    showToast(`导出数据失败：${error instanceof Error ? error.message : String(error)}`);
  }
}

function triggerDataImport() {
  dataImportInput.value?.click();
}

async function importDataFile(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  const ok = window.confirm("导入会覆盖当前配置、邮箱池、任务和 pool_tokens。系统会先自动备份当前数据。确认继续？");
  if (!ok) {
    input.value = "";
    return;
  }
  importingData.value = true;
  try {
    const text = await file.text();
    JSON.parse(text);
    const result = await api<any>("/api/data/import", {method: "POST", body: text});
    selectedEmailIds.value = [];
    selectedTaskIds.value = [];
    selectedTask.value = null;
    showTaskLogModal.value = false;
    await loadConfig();
    await refreshAll();
    showToast(`导入完成：邮箱 ${result.emails ?? 0}，任务 ${result.tasks ?? 0}`);
  } catch (error) {
    showToast(`导入数据失败：${error instanceof Error ? error.message : String(error)}`);
  } finally {
    importingData.value = false;
    input.value = "";
  }
}

async function loadEmailImportFile(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  try {
    emailText.value = await file.text();
    emailImportFileName.value = file.name;
    importResult.value = "";
    const lineCount = emailText.value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).length;
    showToast(`已读取文件：${file.name}，${lineCount} 行`);
  } catch (error) {
    showToast(`读取文件失败：${error instanceof Error ? error.message : String(error)}`);
  } finally {
    input.value = "";
  }
}

function clearEmailImport() {
  emailText.value = "";
  emailImportFileName.value = "";
  importResult.value = "";
}

async function importEmails() {
  if (importingEmails.value) return;
  const text = emailText.value.trim();
  if (!text) {
    showToast("请先粘贴邮箱内容或选择 txt 文件");
    return;
  }
  importingEmails.value = true;
  importResult.value = "";
  try {
    const data = await api<any>("/api/emails/import", {
      method: "POST",
      body: JSON.stringify({text, mailApiBaseUrl: form.mailApiBaseUrl, otpMode: emailImportMode.value}),
    });
    importResult.value = [
      `接码模式：${emailImportMode.value === "manual" ? "手动接码" : "自动接码"}`,
      `读取行数：${data.inputLines ?? "-"}`,
      `新增：${data.added ?? 0}`,
      `更新：${data.updated ?? 0}`,
      `本次重复跳过：${data.skipped ?? 0}`,
      `无效：${data.invalid ?? 0}`,
      `邮箱池总数：${data.total ?? 0}`,
      data.invalidSamples?.length ? `无效示例：\n${data.invalidSamples.map((item: string) => `- ${item}`).join("\n")}` : "",
    ].filter(Boolean).join("\n");
    showToast(`导入完成：新增 ${data.added ?? 0}，更新 ${data.updated ?? 0}，无效 ${data.invalid ?? 0}`);
    await refreshAll();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    importResult.value = `导入失败：${message}`;
    showToast(`导入失败：${message}`);
  } finally {
    importingEmails.value = false;
  }
}

function toggleEmailSelection(id: string) {
  selectedEmailIds.value = selectedEmailIds.value.includes(id)
    ? selectedEmailIds.value.filter((item) => item !== id)
    : [...selectedEmailIds.value, id];
}

function toggleAllEmails(event: Event) {
  const checked = (event.target as HTMLInputElement).checked;
  const visibleIds = new Set(filteredEmails.value.map((item) => item.id));
  selectedEmailIds.value = checked
    ? [
      ...selectedEmailIds.value.filter((id) => !visibleIds.has(id)),
      ...deletableEmails.value.map((item) => item.id),
    ]
    : selectedEmailIds.value.filter((id) => !visibleIds.has(id));
}

function selectParentEmails() {
  selectedEmailIds.value = selectableParentEmails.value.map((item) => item.id);
  showToast(`已选择可启动母号 ${selectedEmailIds.value.length} 个`);
}

async function splitSelectedEmails() {
  if (!selectedEmailIds.value.length) return;
  const count = Math.max(1, Math.min(50, Number(splitAliasCount.value) || 4));
  const ok = window.confirm(`确认将选中的 ${selectedEmailIds.value.length} 个邮箱按每个 ${count} 个子邮箱分裂？子邮箱会复用母邮箱接码地址。`);
  if (!ok) return;
  const result = await api<any>("/api/emails/split", {
    method: "POST",
    body: JSON.stringify({ids: selectedEmailIds.value, count}),
  });
  selectedEmailIds.value = [];
  showToast(`分裂完成：新增 ${result.created ?? 0} 个子邮箱${result.skipped ? `，跳过 ${result.skipped} 个` : ""}`);
  await refreshAll();
}

async function deleteEmail(id: string, email = "") {
  const ok = window.confirm(`确认删除邮箱 ${email || id}？`);
  if (!ok) return;
  const result = await api<any>(`/api/emails/${encodeURIComponent(id)}`, {method: "DELETE"});
  showToast(`删除完成：删除 ${result.removed ?? 0} 个${result.removedTasks ? `，同步清理任务 ${result.removedTasks} 个` : ""}${result.skippedRunning ? `，跳过运行中 ${result.skippedRunning} 个` : ""}`);
  selectedEmailIds.value = selectedEmailIds.value.filter((item) => item !== id);
  await refreshAll();
}

async function deleteSelectedEmails() {
  if (!selectedEmailIds.value.length) return;
  const ok = window.confirm(`确认删除选中的 ${selectedEmailIds.value.length} 个邮箱？运行中的邮箱会跳过。`);
  if (!ok) return;
  const result = await api<any>("/api/emails/delete", {
    method: "POST",
    body: JSON.stringify({ids: selectedEmailIds.value}),
  });
  selectedEmailIds.value = [];
  showToast(`批量删除完成：删除 ${result.removed ?? 0} 个${result.removedTasks ? `，同步清理任务 ${result.removedTasks} 个` : ""}${result.skippedRunning ? `，跳过运行中 ${result.skippedRunning} 个` : ""}`);
  await refreshAll();
}

async function deleteEmailsByStatus(status: "free" | "failed" | "success" | "banned") {
  const label = statusText(status);
  const ok = window.confirm(`确认删除所有${label}邮箱？`);
  if (!ok) return;
  const result = await api<any>("/api/emails/delete", {
    method: "POST",
    body: JSON.stringify({status}),
  });
  selectedEmailIds.value = [];
  showToast(`删除${label}邮箱完成：删除 ${result.removed ?? 0} 个${result.removedTasks ? `，同步清理任务 ${result.removedTasks} 个` : ""}`);
  await refreshAll();
}

async function deleteFreeChildEmails() {
  const items = freeChildEmails.value;
  if (!items.length) return;
  const ok = window.confirm(`确认删除 ${items.length} 个空闲子邮箱？母邮箱、运行中、成功、失败和GPT封号邮箱不会删除。`);
  if (!ok) return;
  const ids = items.map((item) => item.id);
  const result = await api<any>("/api/emails/delete", {
    method: "POST",
    body: JSON.stringify({ids}),
  });
  const removedIds = new Set(ids);
  selectedEmailIds.value = selectedEmailIds.value.filter((id) => !removedIds.has(id));
  showToast(`删除空闲子邮箱完成：删除 ${result.removed ?? 0} 个${result.removedTasks ? `，同步清理任务 ${result.removedTasks} 个` : ""}${result.skippedRunning ? `，跳过运行中 ${result.skippedRunning} 个` : ""}`);
  await refreshAll();
}

async function startSelectedEmailTasks() {
  if (startingSelectedTasks.value) return;
  const emailIds = selectedRunnableEmailIds.value;
  const launchSummary = selectedLaunchSummary.value;
  if (!emailIds.length) {
    showToast("请选择非运行中的邮箱");
    return;
  }
  startingSelectedTasks.value = true;
  try {
    const saved = await saveConfig();
    if (!saved) return;
    const data = await api<any>("/api/tasks", {
      method: "POST",
      body: JSON.stringify({
        emailIds,
        count: emailIds.length,
        concurrency: form.taskConcurrency,
        workspaceIds: currentWorkspaceIds(),
        workspaceLaunchMode: workspaceLaunchMode.value,
        route: form.route,
        runWorkspaceJoin: form.runWorkspaceJoin,
        runSub2Api: form.runSub2Api,
        sub2apiNoRtMode: form.sub2apiNoRtMode,
        sub2apiGroupName: form.sub2apiGroupName || "k12",
      }),
    });
    selectedEmailIds.value = [];
    const clientSkipText = launchSummary.skippedCount ? `，前端跳过不可启动 ${launchSummary.skippedCount} 个` : "";
    showToast(`已用选中邮箱创建 ${data.tasks?.length || data.count || 0} 个任务${clientSkipText}${formatTaskCreateSkipReasons(data)}`);
    void refreshAll();
  } catch (error) {
    showToast(`启动选中失败：${error instanceof Error ? error.message : String(error)}`);
  } finally {
    startingSelectedTasks.value = false;
  }
}

async function checkSelectedAccessTokens() {
  const emailIds = selectedRepairableEmailIds.value;
  if (!emailIds.length) {
    showToast("请选择非运行中的邮箱");
    return;
  }
  checkingAccessTokens.value = true;
  accessTokenCheckResult.value = "";
  try {
    const data = await api<any>("/api/emails/check-at", {
      method: "POST",
      body: JSON.stringify({
        emailIds,
        sub2apiGroupName: form.sub2apiGroupName || "k12",
      }),
    });
    const items = (data.items || []) as AccessTokenCheckItem[];
    for (const result of items) {
      if (!result.emailId) continue;
      emailAtCheckResults.value = {
        ...emailAtCheckResults.value,
        [result.emailId]: result,
      };
      if (!result.accountName) continue;
      const email = emails.value.find((item) => item.id === result.emailId);
      if (email) email.sub2apiAccount = result.accountName;
    }
    const skipped = Number(data.skippedRunning || 0) + Number(data.missing || 0);
    const cleaned = Number(data.prunedTasks || 0);
    const unlinked = Number(data.clearedSub2Links || 0);
    const cleanSuffix = cleaned || unlinked ? `，清理任务 ${cleaned}，解绑 ${unlinked}` : "";
    accessTokenCheckResult.value = [
      `AT 检验完成：通过 ${data.ok ?? 0}，失败 ${data.failed ?? 0}${skipped ? `，跳过 ${skipped}` : ""}${cleanSuffix}`,
      ...items.slice(0, 20).map((item) => (
        `${item.ok ? "OK" : "FAIL"} ${item.email}${item.accountName ? ` (${item.accountName})` : ""}: ${item.message}`
      )),
      items.length > 20 ? `还有 ${items.length - 20} 条未显示` : "",
    ].filter(Boolean).join("\n");
    if (items.some((item) => item.emailId && isK12RepairNeededResult(item))) {
      emailPoolFilter.value = "atRepairNeeded";
    }
    showToast(`AT 检验完成：通过 ${data.ok ?? 0}，失败 ${data.failed ?? 0}${cleanSuffix}`);
    if (cleaned || unlinked) await refreshAll();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    accessTokenCheckResult.value = `AT 检验失败：${message}`;
    showToast(`AT 检验失败：${message}`);
  } finally {
    checkingAccessTokens.value = false;
  }
}

async function refreshK12RepairNeededEmails() {
  if (checkingAccessTokens.value) return;
  const emailIds = emails.value.filter(canRepairEmail).map((item) => item.id);
  if (!emailIds.length) {
    emailAtCheckResults.value = mergeK12RepairScanResults(emailAtCheckResults.value, Object.keys(emailAtCheckResults.value), []);
    showToast("没有可检测的邮箱");
    return;
  }

  checkingAccessTokens.value = true;
  accessTokenCheckResult.value = "正在从 Sub2API 扫描 K12 状态错误账号...";
  try {
    const data = await api<any>("/api/emails/check-at", {
      method: "POST",
      body: JSON.stringify({
        emailIds,
        sub2apiGroupName: form.sub2apiGroupName || "k12",
        onlyK12RepairIssues: true,
        autoCreateRepairTasks: false,
      }),
    });
    const items = (data.items || []) as AccessTokenCheckItem[];
    emailAtCheckResults.value = mergeK12RepairScanResults(emailAtCheckResults.value, emailIds, items);
    for (const result of items) {
      if (!result.emailId || !result.accountName) continue;
      const email = emails.value.find((item) => item.id === result.emailId);
      if (email) email.sub2apiAccount = result.accountName;
    }
    const cleaned = Number(data.prunedTasks || 0);
    const unlinked = Number(data.clearedSub2Links || 0);
    const cleanSuffix = cleaned || unlinked ? `，清理任务 ${cleaned}，解绑 ${unlinked}` : "";
    accessTokenCheckResult.value = [
      `K12 状态扫描完成：错误 ${items.length} 个${cleanSuffix}`,
      ...items.slice(0, 20).map((item) => `${item.email}${item.accountName ? ` (${item.accountName})` : ""}: ${item.message}`),
      items.length > 20 ? `还有 ${items.length - 20} 条未显示` : "",
    ].filter(Boolean).join("\n");
    showToast(`K12 状态错误 ${items.length} 个${cleanSuffix}`);
    if (cleaned || unlinked) await refreshAll();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    accessTokenCheckResult.value = `K12 状态扫描失败：${message}`;
    showToast(`K12 状态扫描失败：${message}`);
  } finally {
    checkingAccessTokens.value = false;
  }
}

async function checkEmailAccessToken(item: EmailItem) {
  if (!canRepairEmail(item) || checkingAccessTokens.value) return;
  selectedEmailIds.value = [item.id];
  await checkSelectedAccessTokens();
}

async function repairSelectedAccessTokens() {
  const emailIds = selectedRepairableEmailIds.value;
  if (!emailIds.length) {
    showToast("请选择非运行中的邮箱");
    return;
  }
  const ok = window.confirm(`确认修复选中的 ${emailIds.length} 个账号 AT？会创建任务，失效时重新邮箱接码登录并更新 Sub2API 对应账号。`);
  if (!ok) return;
  const saved = await saveConfig();
  if (!saved) return;
  const data = await api<any>("/api/tasks/repair-at", {
    method: "POST",
    body: JSON.stringify({
      emailIds,
      sub2apiGroupName: form.sub2apiGroupName || "k12",
    }),
  });
  selectedEmailIds.value = [];
  const skipped = Number(data.skippedRunning || 0) + Number(data.missing || 0) + Number(data.skippedNoAccount || 0);
  if (data.tasks?.[0]) {
    selectedTask.value = data.tasks[0];
    showTaskLogModal.value = true;
  }
  showToast(`已创建 AT 修复任务 ${data.tasks?.length || 0} 个${skipped ? `，跳过 ${skipped} 个` : ""}`);
  await refreshAll();
}

async function repairEmailAccessToken(item: EmailItem) {
  if (!canRepairEmail(item)) return;
  selectedEmailIds.value = [item.id];
  await repairSelectedAccessTokens();
}

async function startTasks() {
  const saved = await saveConfig();
  if (!saved) return;
  try {
    const data = await api<any>("/api/tasks", {
      method: "POST",
      body: JSON.stringify({
        count: launchMotherCount.value,
        concurrency: form.taskConcurrency,
        workspaceIds: currentWorkspaceIds(),
        workspaceLaunchMode: workspaceLaunchMode.value,
        route: form.route,
        runWorkspaceJoin: form.runWorkspaceJoin,
        runSub2Api: form.runSub2Api,
        sub2apiNoRtMode: form.sub2apiNoRtMode,
        sub2apiGroupName: form.sub2apiGroupName || "k12",
      }),
    });
    showToast(`已创建 ${data.count || data.tasks?.length || 0} 个任务${formatTaskCreateSkipReasons(data)}`);
    void refreshAll();
  } catch (error) {
    showToast(`启动任务失败：${error instanceof Error ? error.message : String(error)}`);
  }
}

async function startSub2apiRefill() {
  if (startingSub2apiRefill.value || sub2apiRefillStatus.running) return;
  const saved = await saveConfig();
  if (!saved) return;
  startingSub2apiRefill.value = true;
  try {
    const data = await api<any>("/api/sub2api/refill/start", {method: "POST", body: "{}"});
    applySub2apiRefillStatus(data.status || {}, data.result || null);
    if (Array.isArray(data.status?.history)) {
      sub2apiRefillHistory.value = data.status.history;
    }
    showToast(data.result?.message || "补号检测完成");
    await refreshAll();
  } catch (error) {
    showToast(`补号检测失败：${error instanceof Error ? error.message : String(error)}`);
    await loadSummary();
  } finally {
    startingSub2apiRefill.value = false;
  }
}

async function startSub2apiAutoAtRepair() {
  if (startingSub2apiAutoAtRepair.value || sub2apiRefillStatus.autoAtRepair.running) return;
  const saved = await saveConfig();
  if (!saved) return;
  startingSub2apiAutoAtRepair.value = true;
  try {
    const data = await api<any>("/api/sub2api/auto-at-repair/start", {method: "POST", body: "{}"});
    applySub2apiRefillStatus(data.status || {}, null, data.result || null);
    showToast(data.result?.message || "补 AT 自检完成");
    await refreshAll();
  } catch (error) {
    showToast(`补 AT 自检失败：${error instanceof Error ? error.message : String(error)}`);
    await loadSummary();
  } finally {
    startingSub2apiAutoAtRepair.value = false;
  }
}

async function cancelTask(id: string) {
  await api(`/api/tasks/${encodeURIComponent(id)}/cancel`, {method: "POST", body: "{}"});
  await refreshAll();
}

async function cancelTaskGroup(group: TaskSelectionGroup) {
  const ids = activeTaskIdsOfGroup(group);
  if (!ids.length) return;
  await Promise.all(ids.map((id) => api(`/api/tasks/${encodeURIComponent(id)}/cancel`, {method: "POST", body: "{}"})));
  showToast(`已取消 ${ids.length} 个运行/队列任务`);
  await refreshAll();
}

function canDeleteTask(task: TaskItem) {
  return task.status === "failed" || task.status === "canceled";
}

function canCheckTaskAt(task: TaskItem) {
  return Boolean(task.accessToken || task.accessTokenPreview) && task.status !== "queued" && task.status !== "running";
}

function isTaskGroupExpanded(key: string) {
  return expandedTaskGroupKeys.value.includes(key);
}

function toggleTaskGroup(group: TaskSelectionGroup) {
  expandedTaskGroupKeys.value = isTaskGroupExpanded(group.key)
    ? expandedTaskGroupKeys.value.filter((key) => key !== group.key)
    : [...expandedTaskGroupKeys.value, group.key];
}

function openOrToggleTaskGroup(group: TaskTableGroup) {
  if (group.detailTasks.length) {
    toggleTaskGroup(group);
    return;
  }
  openTaskLog(group.primaryTask);
}

function isTaskGroupFullySelected(group: TaskSelectionGroup) {
  return group.tasks.length > 0 && group.tasks.every((task) => selectedTaskIds.value.includes(task.id));
}

function isTaskGroupPartlySelected(group: TaskSelectionGroup) {
  return group.tasks.some((task) => selectedTaskIds.value.includes(task.id));
}

function toggleTaskGroupSelection(group: TaskSelectionGroup) {
  const ids = group.tasks.map((task) => task.id);
  const selected = new Set(selectedTaskIds.value);
  if (ids.every((id) => selected.has(id))) {
    ids.forEach((id) => selected.delete(id));
  } else {
    ids.forEach((id) => selected.add(id));
  }
  selectedTaskIds.value = Array.from(selected);
}

function taskGroupHasSelectedTask(group: TaskSelectionGroup) {
  return Boolean(selectedTask.value && group.tasks.some((task) => task.id === selectedTask.value?.id));
}

function workspaceLabel(group: TaskTableGroup) {
  const [workspaceId] = group.workspaceIds;
  if (!workspaceId) return "无 workspace";
  return `${workspaceId.slice(0, 8)}...`;
}

function normalizeKey(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

function rootEmailOfTask(task: TaskItem) {
  const email = normalizeKey(task.rootEmail || task.parentEmail || task.smsBowerMailRoot || task.email);
  const at = email.indexOf("@");
  if (at <= 0) return email;
  const local = email.slice(0, at);
  const plus = local.indexOf("+");
  return plus >= 0 ? `${local.slice(0, plus)}${email.slice(at)}` : email;
}

function workspaceKeyOfIds(workspaceIds?: string[]) {
  return normalizeKey((workspaceIds || []).find(Boolean));
}

function workspaceBlockForEmail(email: string, workspaceIds?: string[]) {
  const identity = normalizeKey(email);
  const workspaceId = workspaceKeyOfIds(workspaceIds);
  if (!identity || !workspaceId) return undefined;
  return workspaceBlocks.value.find((item) => (
    item.scope === "email"
    && normalizeKey(item.rootEmail) === identity
    && normalizeKey(item.workspaceId) === workspaceId
  ));
}

function uniqueWorkspaceBlocks(blocks: WorkspaceBlockItem[]) {
  const seen = new Set<string>();
  return blocks.filter((item) => {
    const key = `${normalizeKey(item.rootEmail)}|${normalizeKey(item.workspaceId)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function workspaceBlocksForTasks(tasks: TaskItem[], workspaceIds?: string[]) {
  const emails = new Set(tasks.map((task) => normalizeKey(task.email)).filter(Boolean));
  const workspaceFilter = new Set((workspaceIds || []).map(normalizeKey).filter(Boolean));
  return uniqueWorkspaceBlocks(workspaceBlocks.value.filter((item) => (
    item.scope === "email"
    && emails.has(normalizeKey(item.rootEmail))
    && (!workspaceFilter.size || workspaceFilter.has(normalizeKey(item.workspaceId)))
  )));
}

function workspaceBlockTitle(blocks: WorkspaceBlockItem[]) {
  return blocks
    .map((item) => `${item.rootEmail} / ${item.workspaceId.slice(0, 8)}: ${item.reason || "403 workspace access denied"}`)
    .join("\n");
}

function taskStateDetailText(task: TaskItem) {
  return [
    task.workspaceBlockReason || "",
    task.accessTokenLivenessMessage || "",
    task.error || "",
    ...(task.logs || []).map((log) => log.message || ""),
  ].filter(Boolean).join("\n");
}

function tasksStateDetailText(tasks: TaskItem[]) {
  return tasks.map(taskStateDetailText).filter(Boolean).join("\n");
}

function workspaceState(group: TaskTableGroup) {
  const blocks = workspaceBlocksForTasks(group.tasks, group.workspaceIds);
  if (blocks.length) {
    return {
      kind: "partial",
      text: `死号 ${blocks.length}`,
      title: workspaceBlockTitle(blocks),
    };
  }
  return workspaceStateFromTask(group.status, tasksStateDetailText(group.tasks));
}

function taskWorkspaceState(task: TaskItem) {
  const block = workspaceBlockForEmail(task.email, task.workspaceIds);
  if (block || task.workspaceBlocked) {
    return {
      kind: "dead",
      text: "该号403",
      title: block?.reason || task.workspaceBlockReason || "该邮箱在这个 workspace 被 403 拒绝访问",
    };
  }
  return workspaceStateFromTask(task.status, taskStateDetailText(task));
}

function rootWorkspaceState(group: TaskTableRootGroup) {
  return workspaceStateFromRootGroup(group.status, tasksStateDetailText(group.tasks));
}

function canTopUpFission(group: TaskTableGroup) {
  return canTopUpTaskGroupFission(group);
}

async function continueFission(group: TaskTableGroup) {
  if (!canTopUpFission(group) || toppingUpFissionKey.value) return;
  toppingUpFissionKey.value = group.key;
  try {
    const data = await requestFissionTopUp(group);
    if (data.created?.[0]) {
      selectedTask.value = data.created[0];
      expandedTaskGroupKeys.value = Array.from(new Set([...expandedTaskGroupKeys.value, group.key]));
    }
    showToast(`已创建补分裂任务 ${data.created?.length || 0} 个：${data.successfulChildren ?? group.fissionSuccessChildren}/${data.targetSuccesses ?? group.fissionTargetChildren}`);
    await refreshAll();
  } catch (error) {
    showToast(`继续补分裂失败：${error instanceof Error ? error.message : String(error)}`);
  } finally {
    toppingUpFissionKey.value = "";
  }
}

async function requestFissionTopUp(group: TaskTableGroup) {
  return api<any>("/api/tasks/fission-top-up", {
    method: "POST",
    body: JSON.stringify({
      rootEmail: group.rootEmail,
      targetSuccesses: group.fissionTargetChildren,
      workspaceIds: group.workspaceIds,
    }),
  });
}

async function continueAllFission() {
  const groups = topUpFissionGroups.value;
  if (!groups.length || toppingUpAllFission.value) return;
  toppingUpAllFission.value = true;
  let created = 0;
  let failed = 0;
  try {
    for (const group of groups) {
      toppingUpFissionKey.value = group.key;
      try {
        const data = await requestFissionTopUp(group);
        created += Number(data.created?.length || 0);
        if (data.created?.[0] && !selectedTask.value) selectedTask.value = data.created[0];
      } catch {
        failed += 1;
      }
    }
    showToast(`一键补分裂完成：创建 ${created} 个${failed ? `，失败 ${failed} 组` : ""}`);
    await refreshAll();
  } finally {
    toppingUpFissionKey.value = "";
    toppingUpAllFission.value = false;
  }
}

function toggleTaskSelection(id: string) {
  selectedTaskIds.value = selectedTaskIds.value.includes(id)
    ? selectedTaskIds.value.filter((item) => item !== id)
    : [...selectedTaskIds.value, id];
}

function toggleAllCheckableTasks(event: Event) {
  const checked = (event.target as HTMLInputElement).checked;
  selectedTaskIds.value = checked ? checkableTasks.value.map((item) => item.id) : [];
}

function selectInactiveMarkedTasks() {
  selectedTaskIds.value = inactiveMarkedTasks.value.map((item) => item.id);
  showToast(`已勾选失活任务 ${selectedTaskIds.value.length} 个`);
}

function livenessText(value: string) {
  return ({
    alive: "存活",
    inactive: "失活",
    banned: "GPT封号",
    error: "错误",
    unknown: "未知",
  } as Record<string, string>)[value] || value;
}

function formatTaskCheckResult(data: any, title: string) {
  const items = (data.items || []) as Array<{email: string; ok: boolean; inactive: boolean; status: number; message: string; repairTaskId?: string; skipped?: boolean}>;
  return [
    `${title}：检查 ${data.checked ?? 0}，正常 ${data.ok ?? 0}，失活 ${data.inactive ?? 0}，修复 ${data.repaired ?? 0}，跳过 ${data.skipped ?? 0}`,
    ...items.slice(0, 80).map((item) => {
      const tag = item.skipped ? "SKIP" : item.ok ? "OK" : item.inactive ? "INACTIVE" : "FAIL";
      return `${tag} ${item.email} HTTP ${item.status || "-"}${item.repairTaskId ? ` repair=${item.repairTaskId}` : ""}: ${item.message}`;
    }),
    items.length > 80 ? `还有 ${items.length - 80} 条未显示` : "",
  ].filter(Boolean).join("\n");
}

async function checkSelectedTasks() {
  const taskIds = selectedCheckableTaskIds.value;
  if (!taskIds.length) {
    showToast("请选择有 AT 的非运行任务");
    return;
  }
  checkingTasks.value = true;
  taskCheckResult.value = "";
  try {
    const data = await api<any>("/api/tasks/check-at", {
      method: "POST",
      body: JSON.stringify({taskIds, autoRepair: false}),
    });
    taskCheckResult.value = formatTaskCheckResult(data, "任务 AT 测活完成");
    showToast(`测活完成：失活 ${data.inactive ?? 0} 个`);
    await refreshAll();
  } catch (error) {
    showToast(`批量测活失败：${error instanceof Error ? error.message : String(error)}`);
  } finally {
    checkingTasks.value = false;
  }
}

async function repairSelectedTasks() {
  if (!selectedTaskIds.value.length) {
    showToast("请选择任务");
    return;
  }
  try {
    const emailIds = Array.from(new Set(tasks.value
      .filter((task) => selectedTaskIds.value.includes(task.id))
      .map((task) => task.emailId)
      .filter(Boolean))) as string[];
    if (!emailIds.length) {
      showToast("选中任务缺少邮箱记录");
      return;
    }
    const data = await api<any>("/api/tasks/repair-at", {
      method: "POST",
      body: JSON.stringify({
        emailIds,
        sub2apiGroupName: form.sub2apiGroupName || "k12",
      }),
    });
    if (data.tasks?.[0]) {
      selectedTask.value = data.tasks[0];
      showTaskLogModal.value = true;
    }
    const skipped = Number(data.skippedRunning || 0) + Number(data.missing || 0) + Number(data.skippedNoAccount || 0);
    taskCheckResult.value = `已创建 AT 修复任务 ${data.tasks?.length || 0} 个${skipped ? `，跳过 ${skipped} 个` : ""}。Sub2API 没有账号时会自动新增账号。`;
    showToast(`已创建 AT 修复任务 ${data.tasks?.length || 0} 个`);
    await refreshAll();
  } catch (error) {
    showToast(`批量修复失败：${error instanceof Error ? error.message : String(error)}`);
  }
}

async function loadInactiveTaskData() {
  checkingTasks.value = true;
  taskCheckResult.value = "";
  try {
    const data = await api<any>("/api/tasks/check-at", {
      method: "POST",
      body: JSON.stringify({onlyInactive: true, autoRepair: false}),
    });
    taskCheckResult.value = formatTaskCheckResult(data, "失活任务数据");
    selectedTaskIds.value = (data.items || []).map((item: any) => item.taskId).filter(Boolean);
    showToast(`已获取失活任务 ${data.inactive ?? 0} 个`);
    await refreshAll();
  } catch (error) {
    showToast(`获取失活任务失败：${error instanceof Error ? error.message : String(error)}`);
  } finally {
    checkingTasks.value = false;
  }
}

async function checkTaskAccessToken(task: TaskItem) {
  if (!canCheckTaskAt(task)) {
    showToast("该任务没有可测活的 AT");
    return;
  }
  checkingTaskAtId.value = task.id;
  try {
    const data = await api<any>(`/api/tasks/${encodeURIComponent(task.id)}/check-at`, {method: "POST", body: "{}"});
    if (data.task) selectedTask.value = data.task;
    if (data.result?.banned) {
      showToast("账号已停用，当前邮箱记录已标记为GPT封号");
    } else if (data.repairTask) {
      selectedTask.value = data.repairTask;
      showTaskLogModal.value = true;
      showToast("AT 401，已自动创建修复任务");
    } else {
      showToast(data.result?.message || "AT 测活完成");
    }
    await refreshAll();
  } catch (error) {
    showToast(`AT 测活失败：${error instanceof Error ? error.message : String(error)}`);
  } finally {
    checkingTaskAtId.value = "";
  }
}

async function retryTask(id: string) {
  const data = await api<any>(`/api/tasks/${encodeURIComponent(id)}/retry`, {method: "POST", body: "{}"});
  if (data.task) {
    selectedTask.value = data.task;
    showTaskLogModal.value = true;
  }
  showToast("已创建重试任务");
  await refreshAll();
}

async function retryFailedTasks() {
  if (!summary.tasks.failed || retryingFailedTasks.value) return;
  const ok = window.confirm(`确认重跑 ${summary.tasks.failed} 个失败任务？`);
  if (!ok) return;
  retryingFailedTasks.value = true;
  try {
    const data = await api<any>("/api/tasks/retry-failed", {method: "POST", body: "{}"});
    selectedTaskIds.value = [];
    if (data.created?.[0]) {
      selectedTask.value = data.created[0];
      showTaskLogModal.value = true;
    }
    const skipped = Number(data.skipped || 0);
    showToast(`已创建重跑任务 ${data.count || 0} 个${skipped ? `，跳过 ${skipped}` : ""}`);
    await refreshAll();
  } catch (error) {
    showToast(`重跑失败任务失败：${error instanceof Error ? error.message : String(error)}`);
  } finally {
    retryingFailedTasks.value = false;
  }
}

async function cancelActiveTasks() {
  if (!activeTaskCount.value || stoppingActiveTasks.value) return;
  const ok = window.confirm(`确认停止全部 ${activeTaskCount.value} 个运行/队列任务？`);
  if (!ok) return;
  stoppingActiveTasks.value = true;
  try {
    const result = await api<any>("/api/tasks/cancel-active", {method: "POST", body: "{}"});
    selectedTaskIds.value = [];
    if (selectedTask.value?.status === "queued" || selectedTask.value?.status === "running") {
      selectedTask.value = null;
      showTaskLogModal.value = false;
    }
    showToast(`已停止 ${result.canceled ?? 0} 个任务`);
    summary.tasks.running = 0;
    summary.tasks.queued = 0;
    void refreshAll();
  } catch (error) {
    showToast(`停止任务失败：${error instanceof Error ? error.message : String(error)}`);
  } finally {
    stoppingActiveTasks.value = false;
  }
}

async function deleteTask(id: string) {
  await api(`/api/tasks/${encodeURIComponent(id)}`, {method: "DELETE"});
  if (selectedTask.value?.id === id) {
    selectedTask.value = null;
    showTaskLogModal.value = false;
  }
  showToast("任务已删除");
  await refreshAll();
}

async function clearFailedTasks() {
  if (!summary.tasks.failed) return;
  const ok = window.confirm(`确认清理 ${summary.tasks.failed} 个失败任务？`);
  if (!ok) return;
  const result = await api<any>("/api/tasks/clear-failed", {method: "POST", body: "{}"});
  selectedTaskIds.value = [];
  if (selectedTask.value?.status === "failed") {
    selectedTask.value = null;
    showTaskLogModal.value = false;
  }
  showToast(`已清理失败任务 ${result.removed ?? 0} 个`);
  await refreshAll();
}

async function copyText(value: string, message: string) {
  const text = String(value || "");
  if (!text) return;
  await navigator.clipboard.writeText(text);
  showToast(message);
}

async function copyAccessToken(task: TaskItem) {
  if (task.accessToken) {
    await copyText(task.accessToken, "完整 AT 已复制");
    return;
  }
  await copyText(task.accessTokenPreview || "", "当前只复制了 AT 预览值，刷新后可尝试复制完整 AT");
}

async function submitManualOtp() {
  const task = selectedTask.value;
  if (!task?.waitingOtp || submittingOtp.value) return;
  const code = manualOtpCode.value.trim();
  if (!/^\d{6}$/.test(code)) {
    showToast("请输入 6 位数字验证码");
    return;
  }
  submittingOtp.value = true;
  try {
    const data = await api<any>(`/api/tasks/${encodeURIComponent(task.id)}/otp`, {
      method: "POST",
      body: JSON.stringify({code}),
    });
    manualOtpCode.value = "";
    if (data.task) selectedTask.value = data.task;
    showToast("验证码已提交，任务继续执行");
    await refreshAll();
  } catch (error) {
    showToast(`提交验证码失败：${error instanceof Error ? error.message : String(error)}`);
  } finally {
    submittingOtp.value = false;
  }
}

function selectTask(task: TaskItem) {
  selectedTask.value = task;
}

async function openTaskLog(task: TaskItem) {
  selectedTask.value = task;
  manualOtpCode.value = "";
  showTaskLogModal.value = true;
  await refreshSelectedTaskDetail(task.id);
}

async function refreshSelectedTaskDetail(id: string) {
  if (selectedTaskDetailLoadingId.value === id) return;
  selectedTaskDetailLoadingId.value = id;
  try {
    const data = await api<any>(`/api/tasks/${encodeURIComponent(id)}`);
    if (data.task && selectedTask.value?.id === id) {
      selectedTask.value = data.task;
    }
  } catch {
    // Keep the lightweight row open; the next refresh or explicit action can retry.
  } finally {
    if (selectedTaskDetailLoadingId.value === id) selectedTaskDetailLoadingId.value = "";
  }
}

function closeTaskLog() {
  showTaskLogModal.value = false;
}

function sampleEmails() {
  emailText.value = emailImportMode.value === "manual"
    ? [
      "user1@example.com",
      "user2@example.com",
    ].join("\n")
    : [
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
    banned: "GPT封号",
    queued: "队列",
    canceled: "已取消",
    partial: "部分成功",
  } as Record<string, string>)[status] || status;
}

function fmtTime(value: string) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleTimeString();
}

function fmtDateTime(value: string) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function formatMoney(value: unknown) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "-";
  return number.toFixed(3).replace(/\.?0+$/g, "");
}

onMounted(async () => {
  await loadConfig();
  await Promise.all([refreshAll(), refreshSmsBowerAccountQuietly()]);
  timer = window.setInterval(refreshAll, 2500);
  smsBowerAccountTimer = window.setInterval(refreshSmsBowerAccountQuietly, 60000);
});

onUnmounted(() => {
  if (timer) window.clearInterval(timer);
  if (smsBowerAccountTimer) window.clearInterval(smsBowerAccountTimer);
});
</script>
