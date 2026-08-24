PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS replays (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  original_query TEXT NOT NULL,
  normalized_query TEXT NOT NULL,
  status TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'unlisted',
  start_year INTEGER,
  end_year INTEGER,
  work_count INTEGER NOT NULL DEFAULT 0,
  event_count INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  expires_at TEXT
);

CREATE TABLE IF NOT EXISTS replay_queries (
  id TEXT PRIMARY KEY,
  replay_id TEXT NOT NULL REFERENCES replays(id) ON DELETE CASCADE,
  entities_json TEXT NOT NULL DEFAULT '[]',
  synonyms_json TEXT NOT NULL DEFAULT '[]',
  filters_json TEXT NOT NULL DEFAULT '{}',
  openalex_query_json TEXT NOT NULL DEFAULT '{}',
  query_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS works (
  openalex_id TEXT PRIMARY KEY,
  doi TEXT,
  pmid TEXT,
  pmcid TEXT,
  title TEXT NOT NULL,
  abstract TEXT,
  publication_date TEXT,
  publication_year INTEGER,
  work_type TEXT,
  source_name TEXT,
  cited_by_count INTEGER NOT NULL DEFAULT 0,
  counts_by_year_json TEXT NOT NULL DEFAULT '[]',
  topics_json TEXT NOT NULL DEFAULT '[]',
  authorships_json TEXT NOT NULL DEFAULT '[]',
  is_retracted INTEGER NOT NULL DEFAULT 0,
  update_status_json TEXT,
  raw_hash TEXT,
  fetched_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS replay_works (
  replay_id TEXT NOT NULL REFERENCES replays(id) ON DELETE CASCADE,
  work_id TEXT NOT NULL REFERENCES works(openalex_id) ON DELETE CASCADE,
  relevance_score REAL NOT NULL DEFAULT 0,
  turning_point_score REAL NOT NULL DEFAULT 0,
  branch_id TEXT,
  is_key_work INTEGER NOT NULL DEFAULT 0,
  selection_reasons_json TEXT NOT NULL DEFAULT '[]',
  PRIMARY KEY (replay_id, work_id)
);

CREATE TABLE IF NOT EXISTS work_relations (
  source_work_id TEXT NOT NULL,
  target_work_id TEXT NOT NULL,
  relation_type TEXT NOT NULL,
  replay_id TEXT NOT NULL REFERENCES replays(id) ON DELETE CASCADE,
  PRIMARY KEY (replay_id, source_work_id, target_work_id, relation_type)
);

CREATE TABLE IF NOT EXISTS branches (
  id TEXT PRIMARY KEY,
  replay_id TEXT NOT NULL REFERENCES replays(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  description TEXT,
  color_token TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  source_work_ids_json TEXT NOT NULL DEFAULT '[]',
  ai_generated INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  replay_id TEXT NOT NULL REFERENCES replays(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  event_date TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  selection_reason TEXT,
  confidence REAL,
  requires_review INTEGER NOT NULL DEFAULT 0,
  source_work_ids_json TEXT NOT NULL DEFAULT '[]',
  metrics_json TEXT NOT NULL DEFAULT '{}',
  sort_order INTEGER NOT NULL DEFAULT 0,
  ai_generated INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  replay_id TEXT NOT NULL REFERENCES replays(id) ON DELETE CASCADE,
  job_type TEXT NOT NULL,
  status TEXT NOT NULL,
  progress_current INTEGER NOT NULL DEFAULT 0,
  progress_total INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0,
  error_code TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_runs (
  id TEXT PRIMARY KEY,
  replay_id TEXT NOT NULL REFERENCES replays(id) ON DELETE CASCADE,
  task_type TEXT NOT NULL,
  model TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  output_json TEXT,
  status TEXT NOT NULL,
  validation_errors_json TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS feedback (
  id TEXT PRIMARY KEY,
  replay_id TEXT REFERENCES replays(id) ON DELETE SET NULL,
  event_id TEXT,
  feedback_type TEXT NOT NULL,
  message TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_replays_slug ON replays(slug);
CREATE INDEX IF NOT EXISTS idx_replays_status_created ON replays(status, created_at);
CREATE INDEX IF NOT EXISTS idx_works_doi ON works(doi);
CREATE INDEX IF NOT EXISTS idx_works_pmid ON works(pmid);
CREATE INDEX IF NOT EXISTS idx_works_year ON works(publication_year);
CREATE INDEX IF NOT EXISTS idx_replay_works_turning ON replay_works(replay_id, turning_point_score DESC);
CREATE INDEX IF NOT EXISTS idx_events_date ON events(replay_id, event_date);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(replay_id, status);
CREATE INDEX IF NOT EXISTS idx_ai_runs_hash ON ai_runs(input_hash, task_type);
