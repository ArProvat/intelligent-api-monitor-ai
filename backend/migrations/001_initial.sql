CREATE TABLE batches (
  id TEXT PRIMARY KEY,
  received_at TEXT NOT NULL,
  received_count INTEGER NOT NULL,
  accepted_count INTEGER NOT NULL,
  rejected_count INTEGER NOT NULL
);

CREATE TABLE observations (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL REFERENCES batches(id),
  batch_index INTEGER NOT NULL,
  api_name TEXT NOT NULL,
  response_time_ms REAL NOT NULL,
  status_code INTEGER NOT NULL,
  records_returned INTEGER,
  response_time_threshold_ms REAL NOT NULL,
  expect_records INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(batch_id, batch_index)
);

CREATE TABLE alerts (
  id TEXT PRIMARY KEY,
  observation_id TEXT NOT NULL UNIQUE REFERENCES observations(id),
  findings_json TEXT NOT NULL,
  severity TEXT NOT NULL CHECK(severity IN ('warning', 'critical')),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'resolved')),
  fallback_message TEXT NOT NULL,
  ai_summary TEXT,
  suggested_checks_json TEXT,
  explanation_status TEXT NOT NULL DEFAULT 'pending' CHECK(explanation_status IN ('pending', 'generated', 'fallback', 'mock')),
  provider TEXT,
  model TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  resolved_at TEXT
);

CREATE INDEX alerts_status_created_idx ON alerts(status, created_at DESC, id DESC);
CREATE INDEX alerts_severity_created_idx ON alerts(severity, created_at DESC, id DESC);
CREATE INDEX observations_api_name_idx ON observations(api_name);
CREATE INDEX observations_batch_idx ON observations(batch_id, batch_index);
