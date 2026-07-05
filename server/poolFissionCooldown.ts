export interface PoolFissionCooldownInput {
  isChildEmail: boolean;
  isSmsBowerMail: boolean;
  nowMs: number;
  cooldownMs: number;
  lastFinishedAtMs?: number;
}

export const DEFAULT_POOL_FISSION_CHILD_COOLDOWN_MS = 15_000;
export const DEFAULT_POOL_FISSION_MAILBOX_OTP_COOLDOWN_MS = 300_000;

export function poolFissionCooldownDelayMs(input: PoolFissionCooldownInput): number {
  if (!input.isChildEmail || input.isSmsBowerMail) return 0;
  if (!input.lastFinishedAtMs || !Number.isFinite(input.lastFinishedAtMs)) return 0;
  const elapsed = Math.max(0, input.nowMs - input.lastFinishedAtMs);
  return Math.max(0, input.cooldownMs - elapsed);
}

export interface PoolFissionMailboxOtpCooldownInput extends PoolFissionCooldownInput {
  mailboxOtpDeliveryTimeout: boolean;
  finishedAtMs?: number;
}

export function poolFissionMailboxOtpCooldownDelayMs(input: PoolFissionMailboxOtpCooldownInput): number {
  if (!input.mailboxOtpDeliveryTimeout) return 0;
  return poolFissionCooldownDelayMs({
    ...input,
    lastFinishedAtMs: input.finishedAtMs,
  });
}
