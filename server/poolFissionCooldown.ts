export interface PoolFissionCooldownInput {
  isChildEmail: boolean;
  isSmsBowerMail: boolean;
  nowMs: number;
  cooldownMs: number;
  lastFinishedAtMs?: number;
}

export function poolFissionCooldownDelayMs(input: PoolFissionCooldownInput): number {
  if (!input.isChildEmail || input.isSmsBowerMail) return 0;
  if (!input.lastFinishedAtMs || !Number.isFinite(input.lastFinishedAtMs)) return 0;
  const elapsed = Math.max(0, input.nowMs - input.lastFinishedAtMs);
  return Math.max(0, input.cooldownMs - elapsed);
}
