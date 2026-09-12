PRAGMA foreign_keys = ON;

-- 根治 replay_queries.query_hash 的 TOCTOU 重复:先清理存量重复,再加唯一索引。
-- 保留策略:同一 query_hash 优先保留「最有价值」的回放
-- (complete > processing > queued > 其他终态),同级再保留 rowid 最小(最早插入)的一行;
-- 仅按最早 rowid 保留可能把「失败后重试才成功」的 complete 回放删掉,故加状态优先级。
-- 被删回放通过 ON DELETE CASCADE 级联清理 replay_queries/jobs/events/branches/
-- replay_works/work_relations/ai_runs;feedback.replay_id 经 ON DELETE SET NULL 置空。
-- 注:query_hash 列为 NOT NULL,不存在多 NULL 行;SQLite 唯一索引本身允许多个 NULL 共存,
-- 即使未来该列放宽为可空,唯一索引语义依然成立。
DELETE FROM replays
WHERE id IN (
  SELECT q.replay_id
  FROM replay_queries q
  JOIN replays r ON r.id = q.replay_id
  WHERE q.rowid <> (
    SELECT k.rowid
    FROM replay_queries k
    JOIN replays kr ON kr.id = k.replay_id
    WHERE k.query_hash = q.query_hash
    ORDER BY
      CASE kr.status WHEN 'complete' THEN 0 WHEN 'processing' THEN 1 WHEN 'queued' THEN 2 ELSE 3 END,
      k.rowid
    LIMIT 1
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_replay_queries_query_hash ON replay_queries(query_hash);
