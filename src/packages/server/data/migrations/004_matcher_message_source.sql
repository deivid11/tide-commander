-- Migration 004: Matcher Message Source
-- Adds source tracking to matcher_executions for per-message visibility

ALTER TABLE matcher_executions ADD COLUMN source_type TEXT;
ALTER TABLE matcher_executions ADD COLUMN source_id TEXT;
ALTER TABLE matcher_executions ADD COLUMN source_timestamp INTEGER;

CREATE INDEX idx_matcher_executions_source ON matcher_executions(source_type, source_id);
