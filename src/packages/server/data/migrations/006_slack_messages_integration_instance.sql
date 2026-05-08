-- Multi-instance Slack support
-- Adds an instance id column to slack_messages so two side-by-side Slack
-- integrations (e.g. xoxb- bot + xoxp- personal token) keep their inbound
-- messages distinguishable. Existing rows are tagged 'default' to match the
-- pre-multi-instance singleton.

ALTER TABLE slack_messages ADD COLUMN integration_instance_id TEXT NOT NULL DEFAULT 'default';

CREATE INDEX IF NOT EXISTS idx_slack_messages_instance ON slack_messages(integration_instance_id);
