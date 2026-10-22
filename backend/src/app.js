import express from 'express';
import { randomUUID } from 'node:crypto';
import pino from 'pino';
import { createExplainer } from './services/explanation.js';
import { registerRoutes } from './routes.js';

export function createApp({ db, config, provider = null, logger = pino({ level: 'info' }) }) {
  const app = express();
  const explain = createExplainer(config, provider, logger);
  app.disable('x-powered-by');

  app.use((req, res, next) => {
    req.id = randomUUID();
    res.setHeader('X-Request-ID', req.id);
    const started = Date.now();
    res.on('finish', () => {
      logger.info({
        request_id: req.id,
        method: req.method,
        path: req.path,
        status: res.statusCode,
        duration_ms: Date.now() - started
      }, 'request');
    });
    next();
  });

  app.use((req, res, next) => {
    const origin = req.get('Origin');
    if (origin && !config.corsOrigins.includes(origin)) {
      return res.status(403).json({
        error: { code: 'ORIGIN_NOT_ALLOWED', message: 'Origin is not allowed', request_id: req.id }
      });
    }
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  app.use(express.json({ limit: '64kb', strict: true }));
  registerRoutes(app, { db, policies: config.policies, explain });

  app.use((req, res) => res.status(404).json({
    error: { code: 'NOT_FOUND', message: 'Route not found', request_id: req.id }
  }));

  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);

    let status = 500;
    let code = 'INTERNAL_ERROR';
    let message = 'Internal server error';
    if (error.type === 'entity.too.large') {
      status = 413;
      code = 'BODY_TOO_LARGE';
      message = 'JSON body exceeds 64 KB';
    } else if (error.type === 'entity.parse.failed') {
      status = 400;
      code = 'MALFORMED_JSON';
      message = 'Malformed JSON body';
    }

    logger.error({ request_id: req.id, error_type: error.name, error_code: error.code }, 'request failed');
    res.status(status).json({ error: { code, message, request_id: req.id } });
  });

  return app;
}
