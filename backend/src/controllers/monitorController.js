import { observationSchema, itemErrors } from '../validation.js';
import { processBatch } from '../services/monitorService.js';

export function createMonitorController({ db, policies, explain }) {
  return async function postMonitor(req, res) {
    const observations = req.body;
    if (!Array.isArray(observations) || observations.length === 0 || observations.length > 100) {
      return res.status(422).json({
        error: {
          code: 'INVALID_BATCH',
          message: 'Body must be a nonempty JSON array of at most 100 observations',
          request_id: req.id
        }
      });
    }

    const accepted = [];
    const rejected = [];
    observations.forEach((value, index) => {
      const parsed = observationSchema.safeParse(value);
      if (parsed.success) {
        accepted.push({ index, observation: parsed.data });
      } else {
        rejected.push({ index, status: 'rejected', errors: itemErrors(parsed.error) });
      }
    });

    const batch = await processBatch(db, accepted, observations.length, policies, explain);
    const explanationByAlert = new Map(batch.explanations.map(({ id, status }) => [id, status]));
    const results = batch.results.map(result => {
      if (!result.alert_id) return result;
      return { ...result, explanation_status: explanationByAlert.get(result.alert_id) };
    });
    results.push(...rejected);
    results.sort((a, b) => a.index - b.index);

    const explanationCounts = { generated: 0, fallback: 0, mock: 0 };
    for (const { status } of batch.explanations) explanationCounts[status]++;

    return res.status(accepted.length ? 200 : 422).json({
      batch_id: batch.batchId,
      counts: {
        received: observations.length,
        accepted: accepted.length,
        rejected: rejected.length,
        healthy: accepted.length - batch.alerts.length,
        alerts: batch.alerts.length,
        explanations: explanationCounts
      },
      results
    });
  };
}
