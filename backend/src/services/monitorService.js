import { defaultPolicy, detect, fallbackMessage } from './detection.js';
import { saveBatch, updateExplanation } from '../models/monitorModel.js';

export function prepareObservations(items, policies) {
  return items.map(({ index, observation }) => {
    const policy = { ...defaultPolicy, ...policies[observation.api_name] };
    const detection = detect(observation, policy);
    return {
      index,
      observation,
      policy,
      detection,
      fallback: detection.findings.length ? fallbackMessage(observation, detection.findings) : null
    };
  });
}

export async function processBatch(db, items, receivedCount, policies, explain) {
  const prepared = prepareObservations(items, policies);
  const saved = saveBatch(db, prepared, receivedCount);

  // Each pending alert and its factual fallback already exist before this starts.
  const settled = await Promise.allSettled(saved.alerts.map(async alert => {
    const explanation = await explain(alert);
    updateExplanation(db, alert.id, explanation);
    return { id: alert.id, status: explanation.status };
  }));

  const failed = settled.find(result => result.status === 'rejected');
  if (failed) throw failed.reason;

  return {
    ...saved,
    explanations: settled.filter(result => result.status === 'fulfilled').map(result => result.value)
  };
}
