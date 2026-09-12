-- 公开写接口(创建/重试)限流存储:按 key(端点 + 客户端 IP)做每小时固定窗口计数。
-- window_start 为窗口起点(整点 ISO 时间);窗口滚动时由 Worker 端 upsert 重置 count,
-- 行数上界为「不同 key 数」,不随时间无限增长,无需额外清理任务。
CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  window_start TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0
);
