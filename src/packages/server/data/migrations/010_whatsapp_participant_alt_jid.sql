-- Migration 010: Preserve Baileys' alternate group-participant identity.
-- With LID addressing, participant_jid may be opaque while participant_alt_jid
-- contains the corresponding phone JID (`participantAlt` / bridge `authorAlt`).

ALTER TABLE whatsapp_messages ADD COLUMN participant_alt_jid TEXT;

CREATE INDEX idx_whatsapp_messages_participant_alt
  ON whatsapp_messages(participant_alt_jid, timestamp DESC)
  WHERE participant_alt_jid IS NOT NULL;
