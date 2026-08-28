-- Migration 009: Preserve the actual participant who authored a group message.
-- In group webhooks chat_id/from may identify the @g.us conversation, while
-- participant_jid identifies the person inside that group.

ALTER TABLE whatsapp_messages ADD COLUMN participant_jid TEXT;

CREATE INDEX idx_whatsapp_messages_participant
  ON whatsapp_messages(participant_jid, timestamp DESC)
  WHERE participant_jid IS NOT NULL;
