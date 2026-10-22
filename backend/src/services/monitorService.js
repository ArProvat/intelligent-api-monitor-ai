import { defaultPolicy, detect, fallbackMessage } from './detection.js';
import { immediateExplanation } from './explanation.js';
import { saveBatch } from '../models/monitorModel.js';

export function prepareObservations(items, policies, mode = 'openrouter') {
  return items.map(({ index, observation }) => {
    const policy = { ...defaultPolicy, ...policies[observation.api_name] };
    const detection = detect(observation, policy);
    return {
      index,
      observation,
      policy,
      detection,
      fallback: detection.findings.length ? fallbackMessage(observation, detection.findings) : null,
      initialExplanation: detection.findings.length
        ? immediateExplanation(mode, observation, detection.findings) : null
    };
  });
}

export function processBatch(db, items, receivedCount, policies, mode) {
  return saveBatch(db, prepareObservations(items, policies, mode), receivedCount);
}
