export const defaultPolicy = Object.freeze({ responseTimeThresholdMs: 3000, expectRecords: true });

export function detect(observation, policy = defaultPolicy) {
  const findings = [];
  const add = (code, severity, description, observed, expected) => {
    findings.push({ code, severity, description, observed, expected });
  };

  if (observation.status_code >= 500) {
    add('SERVER_FAILURE', 'critical', `HTTP ${observation.status_code} is a server failure.`,
      observation.status_code, 'HTTP status below 500');
  } else if (observation.status_code >= 400) {
    add('CLIENT_ERROR', 'warning', `HTTP ${observation.status_code} is a client error.`,
      observation.status_code, 'HTTP status below 400');
  }

  if (observation.response_time_ms > policy.responseTimeThresholdMs) {
    add('SLOW_RESPONSE', 'warning',
      `Response time ${observation.response_time_ms} ms exceeds ${policy.responseTimeThresholdMs} ms.`,
      observation.response_time_ms, `<= ${policy.responseTimeThresholdMs} ms`);
  }

  if (policy.expectRecords && observation.records_returned === 0) {
    add('UNEXPECTED_EMPTY_RESULT', 'warning',
      'No records were returned although records are expected.', 0, 'At least 1 record');
  }

  if (policy.expectRecords && observation.records_returned === undefined) {
    add('MISSING_RECORDS_COUNT', 'warning',
      'Records count was not supplied although records are expected.', null, 'A nonnegative records count');
  }

  let severity = null;
  if (findings.some(finding => finding.severity === 'critical')) severity = 'critical';
  else if (findings.length) severity = 'warning';
  return { findings, severity };
}

export function fallbackMessage(observation, findings) {
  return `${observation.api_name}: ${findings.map(f => f.description).join(' ')}`;
}
