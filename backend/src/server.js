import pino from 'pino';
import { loadConfig } from './config.js';
import { openDatabase } from './models/monitorModel.js';
import { createApp } from './app.js';

let config, db, app, logger;
try {
  config = loadConfig();
  db = openDatabase(config.databasePath);
  logger = pino({ level: config.logLevel });
  app = createApp({ db, config, logger });
} catch (error) {
  if (db?.open) db.close();
  console.error(`Startup failed: ${error.name}`);
  process.exit(1);
}
const server = app.listen(config.port, config.host, () => {
  logger.info({ host: config.host, port: config.port, llm_mode: config.llmMode === 'openrouter' && !config.openrouterKey ? 'fallback' : config.llmMode }, 'server listening');
});
server.on('error', error => {
  logger.fatal({ error_type: error.name, error_code: 'code' in error ? error.code : undefined }, 'server listen failed');
  Promise.resolve(app.locals.explanationWorker?.stop()).finally(() => db.close());
  process.exitCode = 1;
});
let stopping = false;
function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  logger.info({ signal }, 'shutdown started');
  const timer = setTimeout(() => { server.closeAllConnections(); db.close(); process.exit(1); }, config.shutdownGraceMs);
  timer.unref();
  const closed = new Promise(resolve => server.close(resolve));
  server.closeIdleConnections();
  Promise.all([closed, app.locals.explanationWorker?.stop() ?? Promise.resolve()])
    .then(() => { clearTimeout(timer); db.close(); logger.info('shutdown complete'); })
    .catch(error => { logger.error({ error_type: error.name }, 'shutdown failed'); process.exit(1); });
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
