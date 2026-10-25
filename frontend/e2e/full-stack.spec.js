import { expect, test } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

const frontendRoot = resolve(import.meta.dirname, '..');
const backendRoot = resolve(frontendRoot, '..', 'backend');
const healthyFixture = join(import.meta.dirname, 'fixtures', 'healthy.json');
const artifactRoot = join(frontendRoot, 'test-artifacts', 'browser-e2e');
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const run = promisify(execFile);

async function unusedPort() {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function waitForHttp(url) {
  const deadline = Date.now() + 10000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) { lastError = error; }
    await wait(100);
  }
  throw lastError ?? new Error(`Timed out waiting for ${url}`);
}

function jsonCompletion(summary = 'Local provider explanation.', suggestedChecks = ['Inspect the local provider result.']) {
  return JSON.stringify({
    id: 'local-provider-response', object: 'chat.completion', created: 1, model: 'local-model',
    choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify({ summary, suggested_checks: suggestedChecks }) } }]
  });
}

async function startProviderStub() {
  const plans = [];
  const held = [];
  let defaultPlan = { type: 'success' };
  let calls = 0;
  const server = createServer(async (req, res) => {
    const body = [];
    for await (const chunk of req) body.push(chunk);
    const request = JSON.parse(Buffer.concat(body).toString());
    expect(req.method).toBe('POST');
    expect(req.url).toBe('/v1/chat/completions');
    expect(request.messages).toHaveLength(2);
    expect(request.response_format.type).toMatch(/json_schema|json_object/);
    calls++;
    const plan = plans.shift() ?? defaultPlan;
    if (plan.type === 'hold') { held.push(res); return; }
    if (plan.type === 'error') {
      res.writeHead(plan.status ?? 500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Local provider failure' } }));
      return;
    }
    const content = plan.type === 'invalid' ? JSON.stringify({ summary: '', suggested_checks: [] }) : jsonCompletion(plan.summary, plan.suggestedChecks);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(content);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}/v1`,
    enqueue: plan => plans.push(plan),
    setDefault: plan => { defaultPlan = plan; },
    release: plan => {
      const res = held.shift();
      if (!res) throw new Error('No provider request is being held');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(jsonCompletion(plan?.summary, plan?.suggestedChecks));
    },
    get calls() { return calls; },
    close: () => {
      server.closeAllConnections();
      return new Promise(resolve => server.close(resolve));
    }
  };
}

let tempDir;
let backendPort;
let frontendPort;
let frontendUrl;
let backendUrl;
let backend;
let vite;
let provider;
let artifactDir;

function startBackend() {
  backend = spawn(process.execPath, ['src/server.js'], {
    cwd: backendRoot,
    env: {
      ...process.env,
      PORT: String(backendPort), HOST: '127.0.0.1', DATABASE_PATH: join(tempDir, 'monitor.db'),
      CORS_ORIGINS: frontendUrl, LLM_MODE: 'openrouter', OPENROUTER_API_KEY: 'local-test-key',
      OPENROUTER_BASE_URL: provider.url, LLM_TIMEOUT_MS: '5000', LLM_CONCURRENCY: '2', LOG_LEVEL: 'silent'
    },
    stdio: 'ignore'
  });
  backend.unref();
  return waitForHttp(`${backendUrl}/health`);
}

async function stop(child) {
  if (!child || child.exitCode !== null) return;
  const exited = new Promise(resolve => child.once('exit', resolve));
  child.kill('SIGKILL');
  await Promise.race([exited, wait(3000)]);
  if (child.exitCode === null) await run('taskkill.exe', ['/PID', String(child.pid), '/T', '/F']).catch(() => {});
  child.stdout?.destroy();
  child.stderr?.destroy();
  child.unref();
}

test.beforeAll(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'api-monitor-browser-'));
  artifactDir = join(artifactRoot, new Date().toISOString().replace(/[:.]/g, '-'));
  mkdirSync(artifactDir, { recursive: true });
  provider = await startProviderStub();
  backendPort = await unusedPort();
  frontendPort = await unusedPort();
  backendUrl = `http://127.0.0.1:${backendPort}`;
  frontendUrl = `http://127.0.0.1:${frontendPort}`;
  await startBackend();
  vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--configLoader', 'native', '--host', '127.0.0.1', '--port', String(frontendPort), '--strictPort'], {
    cwd: frontendRoot, env: { ...process.env, DEV_BACKEND_URL: backendUrl }, stdio: 'ignore'
  });
  vite.unref();
  await waitForHttp(frontendUrl);
});

test.afterAll(async () => {
  await stop(vite);
  await stop(backend);
  await provider?.close();
  rmSync(tempDir, { recursive: true, force: true });
});

test('real browser uses the Vite proxy, SQLite backend, and local OpenAI-compatible stub', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(frontendUrl);
  await expect(page.getByRole('status').filter({ hasText: 'Backend connected' })).toBeVisible();
  await expect(page.getByText('No active alerts')).toBeVisible();
  await page.screenshot({ path: join(artifactDir, 'dashboard-desktop.png'), fullPage: true });

  const monitorRequests = [];
  page.on('request', request => { if (request.url().endsWith('/monitor')) monitorRequests.push(request); });
  await page.getByRole('button', { name: 'Submit observations' }).click();
  const submit = page.getByRole('dialog', { name: 'Submit observations' });
  await expect(submit.getByLabel('Observations JSON')).toHaveValue(/AppointmentAPI/);
  await expect.poll(() => provider.calls).toBe(0);
  provider.enqueue({ type: 'hold' });
  await submit.getByRole('button', { name: 'Submit observations' }).click();
  await expect(submit.getByRole('region', { name: 'Batch result' })).toContainText('2 accepted');
  await expect(submit.getByText('Explanation: Explanation pending')).toBeVisible();
  await expect.poll(() => provider.calls).toBe(1);
  await page.screenshot({ path: join(artifactDir, 'submission-pending.png'), fullPage: true });

  await submit.getByRole('button', { name: 'Close panel' }).click();
  await expect(page.getByText('AppointmentAPI', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'View details for AppointmentAPI' }).click();
  const details = page.getByRole('dialog', { name: 'Alert details' });
  await expect(details).toContainText('HTTP 500');
  await expect(details).toContainText('5500 ms');
  await expect(details).toContainText('0');
  await expect(details).toContainText('Server failure');
  await expect(details).toContainText('Slow response');
  await expect(details).toContainText('Unexpected empty result');
  await page.screenshot({ path: join(artifactDir, 'alert-details.png'), fullPage: true });
  await details.getByRole('button', { name: 'Close panel' }).click();

  await page.getByRole('button', { name: 'Resolve' }).click();
  await expect(page.getByText('No active alerts')).toBeVisible();
  await page.getByLabel('Status').selectOption('resolved');
  await expect(page.getByText('AppointmentAPI', { exact: true })).toBeVisible();
  provider.release({ summary: 'Local AI summary for HTTP 500.', suggestedChecks: ['Inspect the API logs.'] });
  await expect(page.getByText('AI-generated explanation')).toBeVisible({ timeout: 8000 });

  await page.getByRole('button', { name: 'Submit observations' }).click();
  await page.getByRole('button', { name: 'Load healthy sample' }).click();
  await submit.getByRole('button', { name: 'Submit observations' }).click();
  await expect(submit.getByRole('region', { name: 'Batch result' })).toContainText('1 healthy');
  await expect(submit.getByRole('region', { name: 'Batch result' })).toContainText('0 alerts');
  await expect.poll(() => provider.calls).toBe(1);

  await submit.getByLabel('Load a local .json file').setInputFiles(healthyFixture);
  await expect(submit.getByLabel('Observations JSON')).toHaveValue(/FixtureHealthyAPI/);
  await submit.getByRole('button', { name: 'Submit observations' }).click();
  await expect(submit.getByRole('region', { name: 'Batch result' })).toContainText('1 healthy');
  await expect(submit.getByRole('region', { name: 'Batch result' })).toContainText('0 alerts');

  provider.enqueue({ type: 'error', status: 500 });
  await page.getByRole('button', { name: 'Load mixed-validity sample' }).click();
  await submit.getByRole('button', { name: 'Submit observations' }).click();
  await expect(submit.getByText(/Item 3: rejected/)).toBeVisible();
  await expect(submit.getByText(/Item 4: rejected/)).toBeVisible();
  await expect(submit.getByText(/Unrecognized key: "patient_payload"/)).toBeVisible();
  await expect(submit.getByText('Explanation: Rule-based explanation')).toBeVisible({ timeout: 8000 });

  const beforeInvalid = monitorRequests.length;
  await submit.getByLabel('Observations JSON').fill('{bad');
  await submit.getByRole('button', { name: 'Submit observations' }).click();
  await expect(submit.getByText('Enter valid JSON before submitting.')).toBeVisible();
  await expect.poll(() => monitorRequests.length).toBe(beforeInvalid);
  await submit.getByRole('button', { name: 'Close panel' }).click();

  provider.setDefault({ type: 'success' });
  const pageSeed = Array.from({ length: 21 }, (_, index) => ({
    api_name: `PagedAPI-${index}`, response_time_ms: 50, status_code: 500, records_returned: 1
  }));
  const seeded = await fetch(`${backendUrl}/monitor`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(pageSeed) });
  expect(seeded.status).toBe(200);
  await page.getByLabel('Status').selectOption('active');
  await expect(page.getByText('PagedAPI-20', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByText('Page 2 of 2')).toBeVisible();
  await page.getByLabel('API name').fill('PagedAPI-0');
  await expect(page.getByText('PagedAPI-0', { exact: true })).toBeVisible();
  await expect(page.getByText('Page 1 of 1')).toBeVisible();

  const zeroAndMissing = [
    { api_name: 'ZeroRecordsUI', response_time_ms: 20, status_code: 200, records_returned: 0 },
    { api_name: 'MissingRecordsUI', response_time_ms: 20, status_code: 200 }
  ];
  expect((await fetch(`${backendUrl}/monitor`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(zeroAndMissing) })).status).toBe(200);
  await page.getByLabel('API name').fill('ZeroRecordsUI');
  await expect(page.getByText('ZeroRecordsUI', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'View details for ZeroRecordsUI' }).click();
  await expect(details).toContainText('Records returned');
  await expect(details).toContainText('0');
  await details.getByRole('button', { name: 'Close panel' }).click();
  await page.getByLabel('API name').fill('MissingRecordsUI');
  await expect(page.getByText('MissingRecordsUI', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'View details for MissingRecordsUI' }).click();
  await expect(details).toContainText('Not provided');
  await details.getByRole('button', { name: 'Close panel' }).click();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByLabel('API name').fill('');
  await expect(page.getByText('PagedAPI-20', { exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.screenshot({ path: join(artifactDir, 'dashboard-mobile.png'), fullPage: true });
  const opener = page.getByRole('button', { name: 'Submit observations' });
  await opener.click();
  await expect(page.getByRole('button', { name: 'Close panel' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(opener).toBeFocused();

  await stop(backend);
  await page.getByRole('button', { name: 'Refresh' }).click();
  await expect(page.getByText('Backend unavailable')).toBeVisible();
  await startBackend();
  await page.getByRole('button', { name: 'Refresh' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Backend connected' })).toBeVisible();
});
