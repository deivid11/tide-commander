-- Migration 007: WhatsApp Messages
-- Mirrors slack_messages: every inbound and outbound WhatsApp message captured
-- by the upstream WS bridge is persisted here so chat history is queryable from
-- SQLite. message_id + session_id together are unique so redelivered echoes
-- (server restart, upstream replay) don't double-insert.

CREATE TABLE whatsapp_messages (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id           TEXT NOT NULL,
  message_id           TEXT,
  chat_id              TEXT NOT NULL,
  is_group             INTEGER NOT NULL DEFAULT 0,
  group_name           TEXT,
  from_jid             TEXT NOT NULL,
  from_name            TEXT,
  direction            TEXT NOT NULL,
  body                 TEXT NOT NULL,
  message_type         TEXT NOT NULL,
  media_mimetype       TEXT,
  media_size           INTEGER,
  media_filename       TEXT,
  media_path           TEXT,
  audio_transcription  TEXT,
  agent_id             TEXT,
  workflow_instance_id TEXT,
  raw_event            TEXT,
  timestamp            INTEGER NOT NULL,
  received_at          INTEGER NOT NULL
);

CREATE UNIQUE INDEX idx_whatsapp_messages_unique
  ON whatsapp_messages(session_id, message_id)
  WHERE message_id IS NOT NULL;

CREATE INDEX idx_whatsapp_messages_chat
  ON whatsapp_messages(session_id, chat_id, timestamp DESC);

CREATE INDEX idx_whatsapp_messages_timestamp
  ON whatsapp_messages(timestamp);

CREATE INDEX idx_whatsapp_messages_direction
  ON whatsapp_messages(direction);

CREATE INDEX idx_whatsapp_messages_workflow
  ON whatsapp_messages(workflow_instance_id);

CREATE INDEX idx_whatsapp_messages_agent
  ON whatsapp_messages(agent_id);
