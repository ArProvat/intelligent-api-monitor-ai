export const assessmentSample = [
  { api_name: 'PatientDataAPI', response_time_ms: 1200, status_code: 200, records_returned: 50 },
  { api_name: 'AppointmentAPI', response_time_ms: 5500, status_code: 500, records_returned: 0 }
];

export const healthySample = [
  { api_name: 'PatientDataAPI', response_time_ms: 180, status_code: 200, records_returned: 25 }
];

export const mixedSample = [
  { api_name: 'HealthyAPI', response_time_ms: 120, status_code: 200, records_returned: 5 },
  { api_name: 'SlowAPI', response_time_ms: 3500, status_code: 200, records_returned: 2 },
  { api_name: 'BadAPI', response_time_ms: '3500', status_code: 200, records_returned: 2 },
  { api_name: 'PatientDataAPI', response_time_ms: 90, status_code: 200, patient_payload: { name: 'must be rejected' } }
];

export const formatSample = sample => JSON.stringify(sample, null, 2);
