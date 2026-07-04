import {createHash} from "node:crypto";

export interface Sub2ApiAdminLoginInput {
  origin: string;
  email: string;
  password: string;
}

export interface Sub2ApiAdminLoginManagerOptions {
  authenticate: (input: Sub2ApiAdminLoginInput) => Promise<string>;
  now?: () => number;
  cacheMs?: number;
  cooldownMs?: number;
}

interface LoginCacheEntry {
  token?: string;
  expiresAt?: number;
  cooldownUntil?: number;
  cooldownMessage?: string;
  inflight?: Promise<string>;
}

const DEFAULT_CACHE_MS = 10 * 60_000;
const DEFAULT_COOLDOWN_MS = 2 * 60_000;

export function isSub2ApiLoginRateLimitError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /\b429\b/i.test(message) || /rate limit|too many requests/i.test(message);
}

export function createSub2ApiAdminLoginManager(options: Sub2ApiAdminLoginManagerOptions) {
  const cache = new Map<string, LoginCacheEntry>();
  const now = options.now || (() => Date.now());
  const cacheMs = options.cacheMs ?? DEFAULT_CACHE_MS;
  const cooldownMs = options.cooldownMs ?? DEFAULT_COOLDOWN_MS;

  return {
    async login(input: Sub2ApiAdminLoginInput, opts: {force?: boolean} = {}): Promise<string> {
      const key = loginCacheKey(input);
      const current = now();
      const entry = cache.get(key) || {};

      if (entry.cooldownUntil && entry.cooldownUntil > current) {
        const seconds = Math.ceil((entry.cooldownUntil - current) / 1000);
        throw new Error(`Sub2API 管理登录冷却中，请 ${seconds} 秒后重试: ${entry.cooldownMessage || "rate limited"}`);
      }
      if (!opts.force && entry.token && entry.expiresAt && entry.expiresAt > current) {
        return entry.token;
      }
      if (!opts.force && entry.inflight) return entry.inflight;

      const inflight = options.authenticate(input)
        .then((token) => {
          cache.set(key, {
            token,
            expiresAt: now() + cacheMs,
          });
          return token;
        })
        .catch((error) => {
          if (isSub2ApiLoginRateLimitError(error)) {
            const message = error instanceof Error ? error.message : String(error);
            cache.set(key, {
              cooldownUntil: now() + cooldownMs,
              cooldownMessage: message,
            });
            throw new Error(`Sub2API /api/v1/auth/login 触发限流，已冷却 ${Math.ceil(cooldownMs / 1000)} 秒: ${message}`);
          }
          throw error;
        })
        .finally(() => {
          const latest = cache.get(key);
          if (latest?.inflight === inflight) {
            delete latest.inflight;
            cache.set(key, latest);
          }
        });

      cache.set(key, {...entry, inflight});
      return inflight;
    },
    clear() {
      cache.clear();
    },
  };
}

function loginCacheKey(input: Sub2ApiAdminLoginInput): string {
  const passwordHash = createHash("sha256").update(input.password).digest("hex");
  return `${input.origin}\n${input.email.toLowerCase()}\n${passwordHash}`;
}
