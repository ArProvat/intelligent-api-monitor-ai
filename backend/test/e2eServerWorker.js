import { parentPort, workerData } from 'node:worker_threads';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { openDatabase } from '../src/models/monitorModel.js';

const db = openDatabase(workerData.databasePath);
const config = { ...loadConfig({}), llmMode: 'openrouter', openrouterKey: 'test-only',
  llmTimeoutMs: 30000, llmConcurrency: 1 };
const logger = { info() {}, warn() {}, error() {} };
let release;
let calls = 0;
const provider = () => {
  calls++;
  parentPort.postMessage({ type: 'provider-called' });
  if (calls === 2) return Promise.reject(new Error('Test provider failure'));
  return new Promise(resolve => { release = () => resolve({
    summary: 'HTTP 500, a slow response, and zero records were observed.',
    suggested_checks: ['Inspect the API logs for this request.']
  }); });
};
const app = createApp({ db, config, provider, logger });
const server = app.listen(0, '127.0.0.1', () => {
  parentPort.postMessage({ port: server.address().port });
});

parentPort.on('message', async message => {
  if (message.type === 'release') release?.();
  if (message.type !== 'stop') return;
  release?.();
  await new Promise(resolve => server.close(resolve));
  await app.locals.explanationWorker.stop();
  db.close();
  parentPort.close();
});
