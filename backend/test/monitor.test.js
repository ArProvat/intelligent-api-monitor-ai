import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import OpenAI from 'openai';
import { detect } from '../src/services/detection.js';
import { loadConfig } from '../src/config.js';
import { openDatabase, saveBatch, getAlert, claimPendingExplanation, recoverPendingExplanations } from '../src/models/monitorModel.js';
import { prepareObservations } from '../src/services/monitorService.js';
import { createApp } from '../src/app.js';
import { createExplainer, createOpenRouterProvider } from '../src/services/explanation.js';

const base = { api_name: 'PatientDataAPI', response_time_ms: 1200, status_code: 200, records_returned: 50 };
const logger = { info() {}, warn() {}, error() {} };

async function fixture(overrides = {}, provider = null) {
  const dir = mkdtempSync(join(tmpdir(), 'monitor-test-'));
  const path = join(dir, 'monitor.db');
  let db = openDatabase(path);
  const config = { ...loadConfig({}), ...overrides };
  const app = createApp({ db, config, provider, logger });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  return {
    url, path, get db() { return db; },
    request: async (route, method = 'GET', body) => {
      const res = await fetch(url + route, { method, headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: res.status, body: await res.json(), requestId: res.headers.get('x-request-id') };
    },
    closeDb: () => db.close(),
    reopenDb: () => { db = openDatabase(path); return db; },
    cleanup: async () => { await new Promise(resolve => server.close(resolve)); await app.locals.explanationWorker?.stop(); if (db.open) db.close(); rmSync(dir, { recursive: true, force: true }); }
  };
}

async function waitForAlert(f, id, status) {
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    const alert = await f.request(`/alerts/${id}`);
    if (alert.body.explanation_status === status) return alert.body;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.fail(`Alert ${id} did not reach ${status}`);
}

test('pure detection obeys thresholds, classifications and record policy', () => {
  assert.equal(detect(base).findings.length, 0);
  for (const ms of [2999, 3000]) assert.equal(detect({ ...base, response_time_ms: ms }).findings.length, 0);
  assert.deepEqual(detect({ ...base, response_time_ms: 3001 }).findings.map(f => f.code), ['SLOW_RESPONSE']);
  assert.deepEqual(detect({ ...base, status_code: 404 }).findings.map(f => f.code), ['CLIENT_ERROR']);
  assert.deepEqual(detect({ ...base, status_code: 500 }).findings.map(f => f.code), ['SERVER_FAILURE']);
  assert.deepEqual(detect({ ...base, records_returned: 0 }).findings.map(f => f.code), ['UNEXPECTED_EMPTY_RESULT']);
  const { records_returned, ...missing } = base;
  assert.deepEqual(detect(missing).findings.map(f => f.code), ['MISSING_RECORDS_COUNT']);
  assert.equal(detect({ ...base, records_returned: 0 }, { responseTimeThresholdMs: 3000, expectRecords: false }).findings.length, 0);
  assert.equal(detect(missing, { responseTimeThresholdMs: 3000, expectRecords: false }).findings.length, 0);
  assert.equal(detect({ ...base, response_time_ms: 250 }, { responseTimeThresholdMs: 200, expectRecords: true }).findings[0].code, 'SLOW_RESPONSE');
  const multiple = detect({ ...base, status_code: 500, response_time_ms: 4000, records_returned: 0 });
  assert.equal(multiple.findings.length, 3);
  assert.equal(multiple.severity, 'critical');
});

test('batch validation, alerts, filtering, resolution and persistence', async () => {
  const f = await fixture({ llmMode: 'mock', policies: { EmptyAPI: { expectRecords: false }, PatientDataAPI: { responseTimeThresholdMs: 1000 } } });
  try {
    const healthy = await f.request('/monitor', 'POST', [{ ...base, response_time_ms: 999 }, { ...base, api_name: 'EmptyAPI', records_returned: 0 }]);
    assert.equal(healthy.status, 200);
    assert.equal(healthy.body.counts.healthy, 2);
    const mixed = await f.request('/monitor', 'POST', [
      { ...base, response_time_ms: 1200, status_code: 500, records_returned: 0 },
      { ...base, response_time_ms: -1 },
      { ...base, response_time_ms: '3000' },
      { ...base, status_code: 600 },
      { ...base, patient_payload: { secret: 'x' } }
    ]);
    assert.equal(mixed.status, 200);
    assert.deepEqual(mixed.body.counts, { received: 5, accepted: 1, rejected: 4, healthy: 0, alerts: 1, explanations: { pending: 0, generated: 0, fallback: 0, mock: 1 } });
    assert.deepEqual(mixed.body.results.map(x => x.index), [0, 1, 2, 3, 4]);
    const id = mixed.body.results[0].alert_id;
    const alert = await f.request(`/alerts/${id}`);
    assert.equal(alert.body.findings.length, 3);
    assert.equal(alert.body.severity, 'critical');
    assert.equal(alert.body.explanation_status, 'mock');
    assert.match(alert.body.ai_summary, /^MOCK EXPLANATION:/);
    assert.equal(alert.body.observation.effective_policy.responseTimeThresholdMs, 1000);
    const active = await f.request('/alerts?status=active&severity=critical&api_name=PatientDataAPI&limit=1&offset=0');
    assert.equal(active.body.total, 1);
    assert.equal(active.body.items.length, 1);
    assert.equal((await f.request('/alerts?offset=1')).body.items.length, 0);
    assert.equal((await f.request('/alerts/unknown')).status, 404);
    const resolved = await f.request(`/alerts/${id}/resolve`, 'PATCH');
    const again = await f.request(`/alerts/${id}/resolve`, 'PATCH');
    assert.equal(resolved.body.resolved_at, again.body.resolved_at);
    assert.equal((await f.request('/alerts')).body.total, 0);
    assert.equal((await f.request('/alerts?status=resolved')).body.total, 1);
    f.closeDb();
    const reopened = f.reopenDb();
    assert.equal(reopened.prepare('SELECT count(*) AS n FROM observations').get().n, 3);
    assert.equal(reopened.prepare('SELECT status FROM alerts WHERE id = ?').get(id).status, 'resolved');
  } finally { await f.cleanup(); }
});

test('all invalid and structural errors have indexed or clear errors', async () => {
  const f = await fixture();
  try {
    const invalid = await f.request('/monitor', 'POST', [{ ...base, status_code: 99 }]);
    assert.equal(invalid.status, 422);
    assert.equal(invalid.body.results[0].index, 0);
    assert.equal((await f.request('/monitor', 'POST', [])).status, 422);
    assert.equal((await f.request('/monitor', 'POST', {})).status, 422);
    assert.equal((await f.request('/monitor', 'POST', Array(101).fill(base))).status, 422);
    const malformed = await fetch(f.url + '/monitor', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad' });
    assert.equal(malformed.status, 400);
    assert.equal((await malformed.json()).error.code, 'MALFORMED_JSON');
    const huge = await fetch(f.url + '/monitor', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify([{ ...base, api_name: 'x'.repeat(66000) }]) });
    assert.equal(huge.status, 413);
  } finally { await f.cleanup(); }
});

test('local frontend origin is allowed and other origins are rejected', async () => {
  const f = await fixture({ corsOrigins: ['http://127.0.0.1:5173', 'http://localhost:5173'] });
  try {
    for (const origin of ['http://127.0.0.1:5173', 'http://localhost:5173']) {
      const response = await fetch(f.url + '/health', { headers: { Origin: origin } });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('access-control-allow-origin'), origin);
    }
    const rejected = await fetch(f.url + '/monitor', {
      method: 'POST',
      headers: { Origin: 'http://example.test', 'Content-Type': 'application/json' },
      body: JSON.stringify([base])
    });
    assert.equal(rejected.status, 403);
    assert.equal((await rejected.json()).error.code, 'ORIGIN_NOT_ALLOWED');
  } finally { await f.cleanup(); }
});

test('provider failure and missing credentials preserve factual fallback', async () => {
  for (const provider of [async () => { throw new Error('rate limit'); }, async () => ({ summary: '', suggested_checks: [] }), async (_, signal) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))))]) {
    const f = await fixture({ llmMode: 'openrouter', openrouterKey: 'test-key', llmTimeoutMs: 100 }, provider);
    try {
      const sent = await f.request('/monitor', 'POST', [{ ...base, status_code: 500 }]);
      assert.equal(sent.body.results[0].explanation_status, 'pending');
      const alert = await waitForAlert(f, sent.body.results[0].alert_id, 'fallback');
      assert.equal(alert.ai_summary, null);
      assert.match(alert.fallback_message, /server failure/);
    } finally { await f.cleanup(); }
  }
  const f = await fixture({ llmMode: 'openrouter', openrouterKey: '' });
  try {
    const sent = await f.request('/monitor', 'POST', [{ ...base, status_code: 500 }]);
    assert.equal(sent.body.results[0].explanation_status, 'fallback');
  } finally { await f.cleanup(); }
});

test('rule-based fallback never calls an LLM provider', async () => {
  let calls = 0;
  const provider = async () => { calls++; throw new Error('Provider should not be called'); };
  const f = await fixture({ llmMode: 'fallback', openrouterKey: 'unused-test-key' }, provider);
  try {
    const sent = await f.request('/monitor', 'POST', [{ ...base, status_code: 500 }]);
    const alert = await f.request(`/alerts/${sent.body.results[0].alert_id}`);
    assert.equal(calls, 0);
    assert.equal(alert.body.explanation_status, 'fallback');
    assert.equal(alert.body.ai_summary, null);
    assert.equal(alert.body.provider, null);
    assert.equal(alert.body.model, null);
    assert.match(alert.body.fallback_message, /HTTP 500 is a server failure/);
  } finally { await f.cleanup(); }
});

test('OpenRouter SDK adapter validates structured output and rejects failures', async () => {
  const input = { api_name: 'X' };
  const good = createOpenRouterProvider({ key: 'test', model: 'openai/gpt-4o-mini', client: {
    chat: { completions: { create: async (request, options) => {
      assert.equal(request.model, 'openai/gpt-4o-mini');
      assert.equal(request.response_format.type, 'json_schema');
      assert.equal(JSON.parse(request.messages[1].content).api_name, 'X');
      assert.ok(options.signal);
      return { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ summary: 'HTTP 500 observed.', suggested_checks: ['Check server logs.'] }) } }] };
    } } }
  } });
  const signal = new AbortController().signal;
  assert.equal((await good(input, signal)).summary, 'HTTP 500 observed.');
  const jsonMode = createOpenRouterProvider({ key: 'test', model: 'minimax/minimax-m3.1-flash:free', client: {
    chat: { completions: { create: async request => {
      assert.equal(request.response_format.type, 'json_object');
      return { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({
        summary: 'HTTP 500 observed.', suggested_checks: ['Check server logs.']
      }) } }] };
    } } }
  } });
  assert.equal((await jsonMode(input, signal)).summary, 'HTTP 500 observed.');
  const bad = createOpenRouterProvider({ key: 'test', model: 'test', client: {
    chat: { completions: { create: async () => { throw new Error('HTTP 429'); } } }
  } });
  await assert.rejects(bad(input, signal), /HTTP 429/);
  const empty = createOpenRouterProvider({ key: 'test', model: 'test', client: {
    chat: { completions: { create: async () => ({ choices: [] }) } }
  } });
  await assert.rejects(empty(input, signal), /empty/);
});

test('official OpenAI SDK sends an OpenRouter-compatible structured request', async () => {
  let requestBody;
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    requestBody = JSON.parse(Buffer.concat(chunks).toString());
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      id: 'local-test', object: 'chat.completion', created: 1, model: 'openai/gpt-4o-mini',
      choices: [{ index: 0, finish_reason: 'stop', message: {
        role: 'assistant', content: JSON.stringify({
          summary: 'HTTP 500 was observed.', suggested_checks: ['Inspect API logs.']
        })
      } }]
    }));
  }).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const client = new OpenAI({
      apiKey: 'local-test-key',
      baseURL: `http://127.0.0.1:${server.address().port}`,
      maxRetries: 0
    });
    const provider = createOpenRouterProvider({ key: 'local-test-key', model: 'openai/gpt-4o-mini', client });
    assert.equal((await provider({ api_name: 'X' }, undefined)).summary, 'HTTP 500 was observed.');
    assert.equal(requestBody.model, 'openai/gpt-4o-mini');
    assert.equal(requestBody.response_format.type, 'json_schema');
    assert.equal(requestBody.response_format.json_schema.name, 'monitor_explanation');
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('a valid provider response is stored as generated with provider metadata', async () => {
  const provider = async () => ({ summary: 'HTTP 500 was observed.', suggested_checks: ['Inspect API logs.'] });
  const f = await fixture({ llmMode: 'openrouter', openrouterKey: 'test-key' }, provider);
  try {
    const sent = await f.request('/monitor', 'POST', [{ ...base, status_code: 500 }]);
    assert.equal(sent.body.results[0].explanation_status, 'pending');
    const alert = await waitForAlert(f, sent.body.results[0].alert_id, 'generated');
    assert.equal(alert.ai_summary, 'HTTP 500 was observed.');
    assert.deepEqual(alert.suggested_checks, ['Inspect API logs.']);
    assert.equal(alert.provider, 'openrouter');
    assert.equal(alert.model, 'openai/gpt-4o-mini');
    assert.deepEqual(alert.findings.map(finding => finding.code), ['SERVER_FAILURE']);
  } finally { await f.cleanup(); }
});

test('POST returns pending before provider completes; resolution survives explanation update', async () => {
  const releases = [];
  let providerCalls = 0;
  const provider = async () => {
    providerCalls++;
    return new Promise(resolve => { releases.push(() => resolve({
      summary: 'HTTP 500 was observed.', suggested_checks: ['Inspect API logs.']
    })); });
  };
  const f = await fixture({ llmMode: 'openrouter', openrouterKey: 'test-key' }, provider);
  try {
    const sent = await f.request('/monitor', 'POST', [base, { ...base, api_name: 'WarningAPI', response_time_ms: 3500 }, { ...base, status_code: 500 }]);
    assert.equal(sent.status, 200);
    assert.deepEqual(sent.body.counts.explanations, { pending: 2, generated: 0, fallback: 0, mock: 0 });
    assert.equal(sent.body.counts.healthy, 1);
    const warningId = sent.body.results[1].alert_id;
    const criticalId = sent.body.results[2].alert_id;
    assert.equal((await f.request(`/alerts/${warningId}`)).body.severity, 'warning');
    assert.equal((await f.request(`/alerts/${criticalId}`)).body.explanation_status, 'pending');
    assert.equal((await f.request(`/alerts?status=all&batch_id=${sent.body.batch_id}`)).body.total, 2);
    assert.equal((await f.request(`/alerts?status=all&batch_id=00000000-0000-4000-8000-000000000000`)).body.total, 0);
    assert.equal((await f.request('/alerts?batch_id=invalid')).status, 400);
    const resolved = await f.request(`/alerts/${criticalId}/resolve`, 'PATCH');
    assert.equal(resolved.body.status, 'resolved');
    const deadline = Date.now() + 1000;
    while (providerCalls < 2 && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(providerCalls, 2);
    releases.forEach(release => release());
    const warning = await waitForAlert(f, warningId, 'generated');
    assert.equal(warning.severity, 'warning');
    const critical = await waitForAlert(f, criticalId, 'generated');
    assert.equal(critical.status, 'resolved');
    assert.equal(critical.resolved_at, resolved.body.resolved_at);
    assert.equal(providerCalls, 2);
  } finally { releases.forEach(release => release()); await f.cleanup(); }
});

test('worker bounds provider calls across concurrent batches', async () => {
  let active = 0, peak = 0, calls = 0;
  const provider = async () => {
    calls++;
    peak = Math.max(peak, ++active);
    await new Promise(resolve => setTimeout(resolve, 25));
    active--;
    return { summary: 'An anomaly was observed.', suggested_checks: ['Check API logs.'] };
  };
  const f = await fixture({ llmMode: 'openrouter', openrouterKey: 'test-key', llmConcurrency: 2 }, provider);
  try {
    const requests = Array.from({ length: 3 }, (_, batch) => {
      const items = Array.from({ length: 3 }, (_, item) => ({
        ...base, api_name: `API-${batch}-${item}`, status_code: 500
      }));
      return f.request('/monitor', 'POST', items);
    });
    const batches = await Promise.all(requests);
    assert.ok(batches.every(batch => batch.status === 200 && batch.body.counts.explanations.pending === 3));
    await Promise.all(batches.flatMap(batch => batch.body.results.map(item => waitForAlert(f, item.alert_id, 'generated'))));
    assert.equal(calls, 9);
    assert.equal(peak, 2);
  } finally { await f.cleanup(); }
});

test('startup retries one interrupted explanation, then uses factual fallback', () => {
  const dir = mkdtempSync(join(tmpdir(), 'monitor-pending-'));
  const path = join(dir, 'pending.db');
  let db;
  try {
    db = openDatabase(path);
    const prepared = prepareObservations([{ index: 0, observation: { ...base, status_code: 500 } }], {});
    const saved = saveBatch(db, prepared, 1);
    const id = saved.alerts[0].id;
    assert.equal(getAlert(db, id).explanation_status, 'pending');
    assert.match(getAlert(db, id).fallback_message, /server failure/);
    assert.equal(claimPendingExplanation(db).id, id);
    db.close();
    db = openDatabase(path);
    recoverPendingExplanations(db, true);
    assert.equal(getAlert(db, id).explanation_status, 'pending');
    assert.equal(claimPendingExplanation(db).id, id);
    db.close();
    db = openDatabase(path);
    recoverPendingExplanations(db, true);
    assert.equal(getAlert(db, id).explanation_status, 'fallback');
    assert.equal(getAlert(db, id).ai_summary, null);
  } finally { if (db?.open) db.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('LLM concurrency stays bounded across requests', async () => {
  let active = 0, peak = 0;
  const config = { ...loadConfig({}), llmMode: 'openrouter', openrouterKey: 'test', llmConcurrency: 2, llmTimeoutMs: 1000 };
  const explain = createExplainer(config, async () => {
    peak = Math.max(peak, ++active);
    await new Promise(resolve => setTimeout(resolve, 20));
    active--;
    return { summary: 'Observed anomaly.', suggested_checks: ['Check logs.'] };
  });
  const alert = { observation: base, policy: { responseTimeThresholdMs: 3000, expectRecords: true }, findings: detect({ ...base, status_code: 500 }).findings };
  await Promise.all(Array.from({ length: 8 }, () => explain(alert)));
  assert.equal(peak, 2);
});

test('closed database gives error and health failure', async () => {
  const f = await fixture();
  try {
    f.closeDb();
    const response = await f.request('/monitor', 'POST', [base]);
    assert.equal(response.status, 500);
    assert.equal(response.body.error.code, 'INTERNAL_ERROR');
    assert.ok(response.requestId);
    assert.equal((await f.request('/health')).status, 503);
  } finally { await f.cleanup(); }
});
