ALTER TABLE alerts ADD COLUMN explanation_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE alerts ADD COLUMN explanation_claimed_at TEXT;

CREATE INDEX alerts_pending_created_idx
  ON alerts(explanation_status, explanation_claimed_at, created_at, id);
