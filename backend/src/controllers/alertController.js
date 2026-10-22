import { listSchema, itemErrors } from '../validation.js';
import { getAlert, listAlerts, resolveAlert } from '../models/monitorModel.js';

function alertNotFound(req, res) {
  return res.status(404).json({
    error: { code: 'NOT_FOUND', message: 'Alert not found', request_id: req.id }
  });
}

export function createAlertController(db) {
  return {
    list(req, res) {
      const parsed = listSchema.safeParse(req.query);
      if (!parsed.success) {
        return res.status(400).json({
          error: {
            code: 'INVALID_QUERY', message: 'Invalid alert filters',
            details: itemErrors(parsed.error), request_id: req.id
          }
        });
      }
      return res.json(listAlerts(db, parsed.data));
    },

    get(req, res) {
      const alert = getAlert(db, req.params.id);
      return alert ? res.json(alert) : alertNotFound(req, res);
    },

    resolve(req, res) {
      const alert = resolveAlert(db, req.params.id);
      return alert ? res.json(alert) : alertNotFound(req, res);
    }
  };
}
