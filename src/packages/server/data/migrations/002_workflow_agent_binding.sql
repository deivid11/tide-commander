-- Migration 002: Workflow-as-Agent Architecture
-- Adds agent binding, trigger correlation, and agent summary fields

-- ─── workflow_instances: add agent_id and trigger correlation ───

ALTER TABLE workflow_instances ADD COLUMN agent_id TEXT;
ALTER TABLE workflow_instances ADD COLUMN trigger_id TEXT;
ALTER TABLE workflow_instances ADD COLUMN trigger_data_json TEXT;

CREATE INDEX idx_workflow_instances_agent ON workflow_instances(agent_id);

-- ─── workflow_step_log: add agent_summary ───

ALTER TABLE workflow_step_log ADD COLUMN agent_summary TEXT;
