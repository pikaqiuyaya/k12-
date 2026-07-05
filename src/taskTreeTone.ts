const TASK_TREE_TONE_COUNT = 3;
const TASK_WORKSPACE_TONE_COUNT = 4;

export function taskTreeToneClass(index: number): string {
  if (!Number.isFinite(index) || index < 0) return "task-tree-tone-0";
  return `task-tree-tone-${Math.floor(index) % TASK_TREE_TONE_COUNT}`;
}

export function taskWorkspaceToneClass(index: number): string {
  if (!Number.isFinite(index) || index < 0) return "task-workspace-tone-0";
  return `task-workspace-tone-${Math.floor(index) % TASK_WORKSPACE_TONE_COUNT}`;
}
