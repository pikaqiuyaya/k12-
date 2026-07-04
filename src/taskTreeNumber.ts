function safeIndex(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.floor(value);
}

export function taskRootNumber(pageStart: number, rootIndex: number): string {
  return `#${safeIndex(pageStart) + safeIndex(rootIndex) + 1}`;
}

export function taskWorkspaceNumber(pageStart: number, rootIndex: number, workspaceIndex: number): string {
  return `${taskRootNumber(pageStart, rootIndex)}.${safeIndex(workspaceIndex) + 1}`;
}

export function taskDetailNumber(pageStart: number, rootIndex: number, workspaceIndex: number, detailIndex: number): string {
  return `${taskWorkspaceNumber(pageStart, rootIndex, workspaceIndex)}.${safeIndex(detailIndex) + 1}`;
}
