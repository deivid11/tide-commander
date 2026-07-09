-- Fast (channel_id, ts) point lookups for the Slack socket-mode reconciler
-- dedup check: the reconciler re-fetches recent history every cycle and must
-- cheaply skip messages Socket Mode already dispatched, including across
-- process restarts (where the in-memory dedup set is empty).
CREATE INDEX IF NOT EXISTS idx_slack_messages_chan_ts ON slack_messages(channel_id, ts);
