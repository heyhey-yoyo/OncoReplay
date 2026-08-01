ALTER TABLE replays ADD COLUMN subtitle TEXT;
ALTER TABLE replays ADD COLUMN locale TEXT NOT NULL DEFAULT 'zh';
ALTER TABLE replays ADD COLUMN data_status TEXT NOT NULL DEFAULT 'source-grounded';
ALTER TABLE replays ADD COLUMN open_questions_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE replay_works ADD COLUMN analysis_json TEXT NOT NULL DEFAULT '{}';
