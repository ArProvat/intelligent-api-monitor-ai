import { claimPendingExplanation, updateExplanation } from '../models/monitorModel.js';

export function createExplanationWorker({ db, explain, concurrency, logger, pollMs = 1000 }) {
  const active = new Set();
  let timer = null;
  let stopped = false;

  function schedule(delay) {
    if (stopped) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(run, delay);
    timer.unref();
  }

  function run() {
    timer = null;
    if (stopped) return;
    try {
      while (active.size < concurrency) {
        const alert = claimPendingExplanation(db);
        if (!alert) break;
        const task = Promise.resolve()
          .then(() => explain(alert))
          .catch(error => {
            logger.warn({ alert_id: alert.id, error_type: error?.name ?? 'Error' }, 'Explanation failed');
            return { status: 'fallback' };
          })
          .then(result => updateExplanation(db, alert.id, result))
          .catch(error => {
            logger.error({ alert_id: alert.id, error_type: error?.name ?? 'Error' }, 'Could not save explanation');
          })
          .finally(() => { active.delete(task); if (!stopped) schedule(0); });
        active.add(task);
      }
    } catch (error) {
      logger.error({ error_type: error?.name ?? 'Error' }, 'Could not claim explanation');
    }
    schedule(pollMs);
  }

  return {
    wake: () => schedule(0),
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      return Promise.allSettled([...active]);
    }
  };
}
