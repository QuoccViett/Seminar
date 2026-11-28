CREATE TABLE notification_outbox (
  id uuid PRIMARY KEY,
  dedupe_key varchar(255) NOT NULL UNIQUE,
  payload jsonb NOT NULL,
  created_at timestamp(6) NOT NULL,
  processed_at timestamp(6)
);
CREATE INDEX notification_outbox_pending_idx ON notification_outbox (created_at, id) WHERE processed_at IS NULL;
CREATE INDEX notification_outbox_processed_at_created_at_idx ON notification_outbox (processed_at, created_at);
