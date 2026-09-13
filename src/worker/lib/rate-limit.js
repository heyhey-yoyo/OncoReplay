// 基于 D1 的轻量固定窗口限流:保护公开无鉴权的创建/重试接口,
// 防止 OpenAlex 与 Workers AI 配额被刷。可用性优先:存储失败一律 fail-open 放行。
const WINDOW_MS = 3600_000; // 1 小时固定窗口

export const RATE_LIMIT_DEFAULTS = {
  RATE_LIMIT_CREATE_PER_HOUR: 5,
  RATE_LIMIT_RETRY_PER_HOUR: 10,
};

// env 变量可覆盖默认值;非法值(非正整数)回退默认,避免配置错误把接口打死。
export function resolveRateLimit(env, name) {
  const parsed = Number(env?.[name]);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : RATE_LIMIT_DEFAULTS[name];
}

// 客户端 IP:优先 CF-Connecting-IP,缺失(本地 dev / 非 Cloudflare 直连)统一归入 'unknown' 桶。
export function clientIp(request) {
  return request?.headers?.get('cf-connecting-ip')?.trim() || 'unknown';
}

export function windowStartOf(now = new Date()) {
  return new Date(Math.floor(now.getTime() / WINDOW_MS) * WINDOW_MS).toISOString();
}

// 计数并判定:同一 key 在当前整点窗口内自增,窗口滚动时重置。
// 返回 { allowed, count, retryAfterSeconds };D1 不可用时记结构化日志并放行。
export async function checkRateLimit(env, key, limit, now = new Date()) {
  if (!env.DB || !Number.isFinite(limit) || limit <= 0) return { allowed: true, count: 0, retryAfterSeconds: 0 };
  const windowStart = windowStartOf(now);
  try {
    const upsert = env.DB.prepare(
      `INSERT INTO rate_limits (key, window_start, count) VALUES (?,?,1)
       ON CONFLICT(key) DO UPDATE SET
         count = CASE WHEN rate_limits.window_start = excluded.window_start THEN rate_limits.count + 1 ELSE 1 END,
         window_start = excluded.window_start`
    ).bind(key, windowStart);
    const read = env.DB.prepare(`SELECT count FROM rate_limits WHERE key=?`).bind(key);
    const [, readResult] = await env.DB.batch([upsert, read]);
    const count = Number(readResult?.results?.[0]?.count ?? 1);
    const elapsedSeconds = Math.max(0, Math.floor((now.getTime() - Date.parse(windowStart)) / 1000));
    const retryAfterSeconds = Math.max(1, Math.ceil(WINDOW_MS / 1000) - elapsedSeconds);
    return { allowed: count <= limit, count, retryAfterSeconds };
  } catch (cause) {
    // 限流存储失败不误伤正常用户:记结构化日志供排查,直接放行。
    console.log(JSON.stringify({ level: 'warn', event: 'rate_limit_store_failed', message: 'rate limit storage unavailable' }));
    return { allowed: true, count: 0, retryAfterSeconds: 0 };
  }
}
