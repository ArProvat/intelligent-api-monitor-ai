import Database from 'better-sqlite3';
import { readFileSync, readdirSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const migrationDir = fileURLToPath(new URL('../../migrations/', import.meta.url));

export function openDatabase(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  migrate(db);
  return db;
}

export function migrate(db) {
  const files = readdirSync(migrationDir).filter(f => /^\d+_.*\.sql$/.test(f)).sort();
  const current = db.pragma('user_version', { simple: true });
  if (current > files.length) throw new Error('Database migration version is newer than this application');
  for (let i = current; i < files.length; i++) {
    const sql = readFileSync(join(migrationDir, files[i]), 'utf8');
    db.transaction(() => {
      db.exec(sql);
      db.pragma(`user_version = ${i + 1}`);
    })();
  }
}

export function saveBatch(db, items, receivedCount) {
  const batchId = randomUUID();
  const now = new Date().toISOString();
  const insertBatch = db.prepare(`INSERT INTO batches
    (id, received_at, received_count, accepted_count, rejected_count)
    VALUES (?, ?, ?, ?, ?)`);
  const insertObservation = db.prepare(`INSERT INTO observations
    (id, batch_id, batch_index, api_name, response_time_ms, status_code,
     records_returned, response_time_threshold_ms, expect_records, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const insertAlert = db.prepare(`INSERT INTO alerts
    (id, observation_id, findings_json, severity, fallback_message, ai_summary,
     suggested_checks_json, explanation_status, provider, model, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

  return db.transaction(() => {
    insertBatch.run(batchId, now, receivedCount, items.length, receivedCount - items.length);
    const results = [];
    const alerts = [];

    for (const { index, observation, policy, detection, fallback, initialExplanation } of items) {
      const observationId = randomUUID();
      insertObservation.run(
        observationId, batchId, index, observation.api_name,
        observation.response_time_ms, observation.status_code, observation.records_returned ?? null,
        policy.responseTimeThresholdMs, Number(policy.expectRecords), now
      );

      if (detection.findings.length) {
        const alertId = randomUUID();
        insertAlert.run(
          alertId, observationId, JSON.stringify(detection.findings),
          detection.severity, fallback, initialExplanation?.summary ?? null,
          initialExplanation?.suggestedChecks ? JSON.stringify(initialExplanation.suggestedChecks) : null,
          initialExplanation?.status ?? 'pending', initialExplanation?.provider ?? null,
          initialExplanation?.model ?? null, now, now
        );
        alerts.push({ id: alertId, status: initialExplanation?.status ?? 'pending' });
        results.push({
          index, observation_id: observationId, alert_id: alertId,
          status: 'alert', severity: detection.severity, findings: detection.findings,
          explanation_status: initialExplanation?.status ?? 'pending'
        });
      } else {
        results.push({ index, observation_id: observationId, status: 'healthy' });
      }
    }
    return { batchId, results, alerts };
  })();
}

const selectAlert = `SELECT a.*, o.batch_id, o.batch_index, o.api_name, o.response_time_ms, o.status_code,
 o.records_returned, o.response_time_threshold_ms, o.expect_records, o.created_at AS observation_created_at
 FROM alerts a JOIN observations o ON o.id = a.observation_id`;

function mapAlert(row) {
  if (!row) return null;
  return {
    id: row.id,
    observation_id: row.observation_id,
    findings: JSON.parse(row.findings_json),
    severity: row.severity,
    status: row.status,
    fallback_message: row.fallback_message,
    ai_summary: row.ai_summary,
    suggested_checks: row.suggested_checks_json ? JSON.parse(row.suggested_checks_json) : null,
    explanation_status: row.explanation_status,
    provider: row.provider,
    model: row.model,
    created_at: row.created_at,
    updated_at: row.updated_at,
    resolved_at: row.resolved_at,
    observation: {
      id: row.observation_id,
      batch_id: row.batch_id,
      batch_index: row.batch_index,
      api_name: row.api_name,
      response_time_ms: row.response_time_ms,
      status_code: row.status_code,
      records_returned: row.records_returned,
      created_at: row.observation_created_at,
      effective_policy: {
        responseTimeThresholdMs: row.response_time_threshold_ms,
        expectRecords: Boolean(row.expect_records)
      }
    }
  };
}

export function getAlert(db, id) {
  return mapAlert(db.prepare(`${selectAlert} WHERE a.id = ?`).get(id));
}

export function listAlerts(db, filters) {
  const where = [];
  const params = [];
  if (filters.status !== 'all') { where.push('a.status = ?'); params.push(filters.status); }
  if (filters.api_name) { where.push('o.api_name = ?'); params.push(filters.api_name); }
  if (filters.severity) { where.push('a.severity = ?'); params.push(filters.severity); }
  if (filters.batch_id) { where.push('o.batch_id = ?'); params.push(filters.batch_id); }
  const clause = where.length ? ` WHERE ${where.join(' AND ')}` : '';
  const total = db.prepare(`SELECT count(*) AS n FROM alerts a
    JOIN observations o ON o.id = a.observation_id${clause}`).get(...params).n;
  const items = db.prepare(`${selectAlert}${clause}
    ORDER BY a.created_at DESC, a.id DESC LIMIT ? OFFSET ?`)
    .all(...params, filters.limit, filters.offset).map(mapAlert);
  return { total, limit: filters.limit, offset: filters.offset, items };
}

export function resolveAlert(db, id) {
  const now = new Date().toISOString();
  db.prepare("UPDATE alerts SET status = 'resolved', resolved_at = ?, updated_at = ? WHERE id = ? AND status = 'active'").run(now, now, id);
  return getAlert(db, id);
}

export function updateExplanation(db, id, result) {
  db.prepare(`UPDATE alerts SET ai_summary = ?, suggested_checks_json = ?,
    explanation_status = ?, provider = ?, model = ?, explanation_claimed_at = NULL,
    updated_at = ? WHERE id = ? AND explanation_status = 'pending'`)
    .run(
      result.summary ?? null,
      result.suggestedChecks ? JSON.stringify(result.suggestedChecks) : null,
      result.status, result.provider ?? null, result.model ?? null,
      new Date().toISOString(), id
    );
}

export function recoverPendingExplanations(db, enabled) {
  const now = new Date().toISOString();
  db.transaction(() => {
    db.prepare(`UPDATE alerts SET explanation_status = 'fallback', explanation_claimed_at = NULL,
      updated_at = ? WHERE explanation_status = 'pending' AND (? = 0 OR explanation_attempts >= 2)`)
      .run(now, Number(enabled));
    if (enabled) db.prepare(`UPDATE alerts SET explanation_claimed_at = NULL
      WHERE explanation_status = 'pending' AND explanation_attempts < 2`).run();
  })();
}

export function claimPendingExplanation(db) {
  return db.transaction(() => {
    const row = db.prepare(`SELECT id FROM alerts
      WHERE explanation_status = 'pending' AND explanation_claimed_at IS NULL
        AND explanation_attempts < 2
      ORDER BY created_at ASC, id ASC LIMIT 1`).get();
    if (!row) return null;
    const now = new Date().toISOString();
    db.prepare(`UPDATE alerts SET explanation_attempts = explanation_attempts + 1,
      explanation_claimed_at = ?, updated_at = ? WHERE id = ?`).run(now, now, row.id);
    const alert = getAlert(db, row.id);
    return {
      id: alert.id,
      observation: alert.observation,
      policy: alert.observation.effective_policy,
      findings: alert.findings
    };
  })();
}
