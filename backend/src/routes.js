import { createMonitorController } from './controllers/monitorController.js';
import { createAlertController } from './controllers/alertController.js';

export function registerRoutes(app, { db, policies, explain }) {
  const alerts = createAlertController(db);
  app.post('/monitor', createMonitorController({ db, policies, explain }));
  app.get('/alerts', alerts.list);
  app.get('/alerts/:id', alerts.get);
  app.patch('/alerts/:id/resolve', alerts.resolve);
  app.get('/health', (req, res) => {
    try {
      db.prepare('SELECT 1').get();
      res.json({ status: 'ok', database: 'available' });
    } catch {
      res.status(503).json({
        status: 'unavailable', database: 'unavailable',
        error: { code: 'DATABASE_UNAVAILABLE', message: 'Database is unavailable', request_id: req.id }
      });
    }
  });
}
