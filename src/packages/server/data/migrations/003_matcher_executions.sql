-- Migration 003: Matcher Executions
-- Debugging layer for trigger matcher pipeline visibility

CREATE TABLE matcher_executions (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  trigger_event_id  INTEGER,
  trigger_id        TEXT NOT NULL,
  matcher_type      TEXT NOT NULL,
  matcher_name      TEXT NOT NULL,
  executed_at       INTEGER NOT NULL,
  matched           INTEGER NOT NULL DEFAULT 0,
  confidence        REAL,
  reason            TEXT,
  result_json       TEXT,
  FOREIGN KEY (trigger_event_id) REFERENCES trigger_events(id)
);

CREATE INDEX idx_matcher_executions_event ON matcher_executions(trigger_event_id);
CREATE INDEX idx_matcher_executions_trigger ON matcher_executions(trigger_id);
