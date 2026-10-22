export const findingNames = {
  SERVER_FAILURE: 'Server failure', CLIENT_ERROR: 'Client error', SLOW_RESPONSE: 'Slow response',
  UNEXPECTED_EMPTY_RESULT: 'Unexpected empty result', MISSING_RECORDS_COUNT: 'Missing records count'
};

export const explanationNames = {
  generated: 'AI-generated explanation', fallback: 'Rule-based explanation',
  mock: 'Demo explanation', pending: 'Explanation pending'
};

export function explanationText(alert) {
  return alert.explanation_status === 'generated' || alert.explanation_status === 'mock'
    ? alert.ai_summary || alert.fallback_message
    : alert.fallback_message;
}

export function dateText(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium', timeStyle: 'short'
  }).format(date);
}

export function observedText(value) { return value === null || value === undefined ? 'Not provided' : String(value); }
