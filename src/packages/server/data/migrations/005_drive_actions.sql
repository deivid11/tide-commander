-- ═══════════════════════════════════════════════════════════════
-- DRIVE ACTION LOGS
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS drive_action_logs (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  file_id              TEXT NOT NULL,
  action               TEXT NOT NULL,
  file_name            TEXT NOT NULL,
  mime_type            TEXT NOT NULL,
  folder_id            TEXT,
  agent_id             TEXT,
  workflow_instance_id TEXT,
  recorded_at          INTEGER NOT NULL
);

CREATE INDEX idx_drive_logs_file ON drive_action_logs(file_id);
CREATE INDEX idx_drive_logs_workflow ON drive_action_logs(workflow_instance_id);
CREATE INDEX idx_drive_logs_recorded ON drive_action_logs(recorded_at);
