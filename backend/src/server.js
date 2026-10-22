import pino from 'pino';
import { loadConfig } from './config.js';
import { openDatabase } from './models/monitorModel.js';
import { createApp } from './app.js';

let config, db;
try {
  config = loadConfig();
  db = openDatabase(config.databasePath);
} catch (error) {
  console.error(`Startup failed: ${error.name}`);
  process.exit(1);
}
const logger = pino({ level: config.logLevel });
const server = createApp({ db, config, logger }).listen(config.port, config.host, () => {
  logger.info({ host: config.host, port: config.port, llm_mode: config.llmMode === 'openrouter' && !config.openrouterKey ? 'fallback' : config.llmMode }, 'server listening');
});
server.on('error', error => {
  logger.fatal({ error_type: error.name, error_code: 'code' in error ? error.code : undefined }, 'server listen failed');
  db.close();
  process.exitCode = 1;
});
let stopping = false;
function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  logger.info({ signal }, 'shutdown started');
  const timer = setTimeout(() => { server.closeAllConnections(); db.close(); process.exit(1); }, config.shutdownGraceMs);
  timer.unref();
  server.close(() => { clearTimeout(timer); db.close(); logger.info('shutdown complete'); });
  server.closeIdleConnections();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
