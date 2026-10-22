import { beforeEach, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App.tsx';
import { api, ApiError } from './services/api.js';

vi.mock('./services/api.js', () => ({
  ApiError: class ApiError extends Error {
    constructor(message, values = {}) { super(message); Object.assign(this, values); }
  },
  api: { alerts: vi.fn(), alert: vi.fn(), resolve: vi.fn(), monitor: vi.fn(), health: vi.fn() }
}));

const makeAlert = (changes = {}) => ({
  id: 'alert-1', observation_id: 'observation-1', severity: 'critical', status: 'active',
  findings: [{ code: 'SERVER_FAILURE', severity: 'critical', description: 'HTTP 500 is a server failure.', observed: 500, expected: 'HTTP status below 500' }],
  fallback_message: 'PatientDataAPI: HTTP 500 is a server failure.', ai_summary: 'HTTP 500 was observed.',
  suggested_checks: ['Check service logs.'], explanation_status: 'generated', provider: 'openrouter', model: 'test-model',
  created_at: '2026-10-22T05:00:00.000Z', resolved_at: null,
  observation: { id: 'observation-1', api_name: 'PatientDataAPI', response_time_ms: 4200, status_code: 500,
    records_returned: 0, effective_policy: { responseTimeThresholdMs: 3000, expectRecords: true } },
  ...changes
});

beforeEach(() => {
  vi.clearAllMocks();
  api.health.mockResolvedValue({ status: 'ok', database: 'available' });
  api.alerts.mockResolvedValue({ total: 0, limit: 20, offset: 0, items: [] });
  api.alert.mockImplementation(id => Promise.resolve(makeAlert({ id })));
  api.resolve.mockImplementation(id => Promise.resolve(makeAlert({ id, status: 'resolved', resolved_at: '2026-10-22T06:00:00.000Z' })));
});

test('loads alerts, labels explanation sources, and distinguishes missing records from zero', async () => {
  const generated = makeAlert();
  const missing = makeAlert({ id: 'alert-2', explanation_status: 'fallback', ai_summary: null, provider: null, model: null,
    observation: { ...generated.observation, api_name: 'MissingCountAPI', records_returned: null } });
  api.alerts.mockResolvedValue({ total: 2, limit: 20, offset: 0, items: [generated, missing] });
  api.alert.mockImplementation(id => Promise.resolve(id === generated.id ? generated : missing));
  render(<App />);
  expect(screen.getByText('Loading alerts…')).toBeInTheDocument();
  await screen.findByText('MissingCountAPI');
  expect(screen.getByText('AI-generated explanation')).toBeInTheDocument();
  expect(screen.getByText('Rule-based explanation')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'View details for MissingCountAPI' }));
  const dialog = screen.getByRole('dialog', { name: 'Alert details' });
  await waitFor(() => expect(within(dialog).getByText('Records returned').parentElement).toHaveTextContent('Not provided'));
  await userEvent.click(within(dialog).getByRole('button', { name: 'Close panel' }));
  await userEvent.click(screen.getByRole('button', { name: 'View details for PatientDataAPI' }));
  expect(within(screen.getByRole('dialog')).getByText('Records returned').parentElement).toHaveTextContent('0');
});

test('shows distinct empty and backend failure states', async () => {
  const view = render(<App />);
  expect(await screen.findByText('No active alerts')).toBeInTheDocument();
  view.unmount();
  api.alerts.mockRejectedValue(new ApiError('Could not reach the backend.'));
  render(<App />);
  expect(await screen.findByText('Alerts are unavailable')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
});

test('filter changes reset pagination to the first page', async () => {
  api.alerts.mockImplementation(({ offset }) => Promise.resolve({ total: 25, limit: 20, offset, items: [makeAlert()] }));
  render(<App />);
  await screen.findByText('PatientDataAPI');
  await userEvent.click(screen.getByRole('button', { name: 'Next' }));
  await waitFor(() => expect(api.alerts).toHaveBeenCalledWith(expect.objectContaining({ offset: 20 }), expect.anything()));
  fireEvent.change(screen.getByLabelText('Severity'), { target: { value: 'critical' } });
  await waitFor(() => expect(api.alerts).toHaveBeenLastCalledWith(expect.objectContaining({ severity: 'critical', offset: 0 }), expect.anything()));
  expect(screen.getByText('Page 1 of 2')).toBeInTheDocument();
});

test('resolution succeeds only after the server confirms it and moves to Resolved', async () => {
  let resolved = false;
  const alert = makeAlert();
  api.alerts.mockImplementation(({ status }) => Promise.resolve({
    total: status === 'active' ? Number(!resolved) : status === 'resolved' ? Number(resolved) : 1,
    limit: 20, offset: 0, items: status === 'active' && resolved || status === 'resolved' && !resolved ? [] : [resolved ? { ...alert, status: 'resolved', resolved_at: '2026-10-22T06:00:00.000Z' } : alert]
  }));
  api.resolve.mockImplementation(async () => { resolved = true; return { ...alert, status: 'resolved', resolved_at: '2026-10-22T06:00:00.000Z' }; });
  render(<App />);
  await screen.findByText('PatientDataAPI');
  await userEvent.click(screen.getByRole('button', { name: 'Resolve' }));
  expect(await screen.findByText('No active alerts')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'resolved' } });
  expect(await screen.findByText('PatientDataAPI')).toBeInTheDocument();
  expect(screen.getByText('resolved')).toBeInTheDocument();
});

test('resolution failure leaves the alert available and shows the error', async () => {
  api.alerts.mockResolvedValue({ total: 1, limit: 20, offset: 0, items: [makeAlert()] });
  api.resolve.mockRejectedValue(new ApiError('Database is unavailable', { requestId: 'req-123' }));
  render(<App />);
  await screen.findByText('PatientDataAPI');
  await userEvent.click(screen.getByRole('button', { name: 'Resolve' }));
  expect(await screen.findByText('Database is unavailable')).toBeInTheDocument();
  expect(screen.getByText('PatientDataAPI')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Resolve' })).toBeEnabled();
  expect(screen.getByText('req-123')).toBeInTheDocument();
});

test('invalid JSON stays in the editor and never reaches POST', async () => {
  render(<App />);
  await userEvent.click(screen.getByRole('button', { name: 'Submit observations' }));
  fireEvent.change(screen.getByLabelText('Observations JSON'), { target: { value: '{bad' } });
  await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Submit observations' }));
  expect(screen.getByText('Enter valid JSON before submitting.')).toBeInTheDocument();
  expect(api.monitor).not.toHaveBeenCalled();
  expect(screen.getByLabelText('Observations JSON')).toHaveValue('{bad');
});

test('mixed-validity feedback shows accepted items, original indexes, and validation errors', async () => {
  api.monitor.mockResolvedValue({
    batch_id: 'batch-1', counts: { received: 4, accepted: 2, rejected: 2, healthy: 1, alerts: 1,
      explanations: { generated: 0, fallback: 1, mock: 0 } },
    results: [{ index: 0, status: 'healthy' }, { index: 1, status: 'alert', explanation_status: 'fallback', findings: [{ code: 'SLOW_RESPONSE' }] },
      { index: 2, status: 'rejected', errors: [{ field: 'response_time_ms', message: 'Expected number' }] },
      { index: 3, status: 'rejected', errors: [{ field: 'patient_payload', message: 'Unknown key' }] }]
  });
  render(<App />);
  await userEvent.click(screen.getByRole('button', { name: 'Submit observations' }));
  await userEvent.click(screen.getByRole('button', { name: 'Load mixed-validity sample' }));
  expect(api.monitor).not.toHaveBeenCalled();
  await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Submit observations' }));
  expect(await screen.findByText('Batch processed')).toBeInTheDocument();
  expect(screen.getByText(/Item 1: healthy/)).toBeInTheDocument();
  expect(screen.getByText(/Item 2: alert/)).toBeInTheDocument();
  expect(screen.getByText(/Item 3: rejected/)).toBeInTheDocument();
  expect(screen.getByText(/Item 4: rejected/)).toBeInTheDocument();
  expect(screen.getByText(/Original index 3/)).toBeInTheDocument();
  expect(screen.getByText('Explanation: Rule-based explanation')).toBeInTheDocument();
  expect(within(screen.getByRole('region', { name: 'Batch result' })).getByText('patient_payload')).toBeInTheDocument();
  expect(api.monitor).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ response_time_ms: '3500' })]));
});

test('pending batch feedback updates when the saved explanation finishes', async () => {
  const alert = makeAlert();
  api.monitor.mockResolvedValue({
    batch_id: 'batch-1', counts: { received: 1, accepted: 1, rejected: 0, healthy: 0, alerts: 1,
      explanations: { pending: 1, generated: 0, fallback: 0, mock: 0 } },
    results: [{ index: 0, status: 'alert', alert_id: alert.id, explanation_status: 'pending', findings: alert.findings }]
  });
  api.alerts.mockImplementation(({ batchId }) => Promise.resolve(batchId
    ? { total: 1, limit: 100, offset: 0, items: [alert] }
    : { total: 0, limit: 20, offset: 0, items: [] }));
  render(<App />);
  await userEvent.click(screen.getByRole('button', { name: 'Submit observations' }));
  await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Submit observations' }));
  expect(await screen.findByText('Explanation: Explanation pending')).toBeInTheDocument();
  expect(await screen.findByText('Explanation: AI-generated explanation', {}, { timeout: 5000 })).toBeInTheDocument();
  expect(api.alerts).toHaveBeenCalledWith(expect.objectContaining({ batchId: 'batch-1', status: 'all' }), expect.anything());
}, 7000);

test('failed explanation status check keeps pending feedback and offers a retry', async () => {
  api.monitor.mockResolvedValue({
    batch_id: 'batch-2', counts: { received: 1, accepted: 1, rejected: 0, healthy: 0, alerts: 1,
      explanations: { pending: 1, generated: 0, fallback: 0, mock: 0 } },
    results: [{ index: 0, status: 'alert', alert_id: 'alert-2', explanation_status: 'pending' }]
  });
  api.alerts.mockImplementation(({ batchId }) => batchId
    ? Promise.reject(new ApiError('Could not reach the backend.'))
    : Promise.resolve({ total: 0, limit: 20, offset: 0, items: [] }));
  render(<App />);
  await userEvent.click(screen.getByRole('button', { name: 'Submit observations' }));
  await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Submit observations' }));
  expect(await screen.findByText('Explanation: Explanation pending')).toBeInTheDocument();
  expect(await screen.findByRole('button', { name: 'Check explanation status again' }, { timeout: 5000 })).toBeInTheDocument();
  expect(screen.getByText('Could not reach the backend.')).toBeInTheDocument();
  expect(screen.getByText('Explanation: Explanation pending')).toBeInTheDocument();
}, 7000);

test('fully invalid HTTP 422 still displays indexed batch feedback', async () => {
  api.monitor.mockRejectedValue(new ApiError('Invalid items', { status: 422, data: {
    batch_id: 'batch-2', counts: { received: 1, accepted: 0, rejected: 1, healthy: 0, alerts: 0,
      explanations: { generated: 0, fallback: 0, mock: 0 } },
    results: [{ index: 0, status: 'rejected', errors: [{ field: 'status_code', message: 'Too small' }] }]
  } }));
  render(<App />);
  await userEvent.click(screen.getByRole('button', { name: 'Submit observations' }));
  await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Submit observations' }));
  expect(await screen.findByText(/Item 1: rejected/)).toBeInTheDocument();
  expect(screen.getByText('status_code')).toBeInTheDocument();
});

test('Escape closes details and returns keyboard focus to the invoking button', async () => {
  api.alerts.mockResolvedValue({ total: 1, limit: 20, offset: 0, items: [makeAlert()] });
  render(<App />);
  const opener = await screen.findByRole('button', { name: 'View details for PatientDataAPI' });
  await userEvent.click(opener);
  expect(screen.getByRole('dialog', { name: 'Alert details' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Close panel' })).toHaveFocus();
  await userEvent.keyboard('{Escape}');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(opener).toHaveFocus();
});

test('dialog contains keyboard focus while it is open', async () => {
  render(<App />);
  const opener = screen.getByRole('button', { name: 'Submit observations' });
  await userEvent.click(opener);
  const dialog = screen.getByRole('dialog', { name: 'Submit observations' });
  const close = within(dialog).getByRole('button', { name: 'Close panel' });
  expect(close).toHaveFocus();
  await userEvent.keyboard('{Shift>}{Tab}{/Shift}');
  expect(within(dialog).getByRole('button', { name: 'Submit observations' })).toHaveFocus();
  await userEvent.tab();
  expect(close).toHaveFocus();
  await userEvent.keyboard('{Escape}');
  expect(opener).toHaveFocus();
});

test('refresh failure keeps existing alerts visible and reports backend unavailability', async () => {
  api.alerts.mockResolvedValueOnce({ total: 1, limit: 20, offset: 0, items: [makeAlert()] })
    .mockRejectedValue(new ApiError('Could not reach the backend.'));
  api.health.mockResolvedValueOnce({ status: 'ok', database: 'available' })
    .mockRejectedValue(new ApiError('Could not reach the backend.'));
  render(<App />);
  await screen.findByText('PatientDataAPI');
  await userEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  expect(await screen.findByText('Backend unavailable')).toBeInTheDocument();
  expect(screen.getByText('Could not reach the backend.')).toBeInTheDocument();
  expect(screen.getByText('PatientDataAPI')).toBeInTheDocument();
});

test('pending and mock explanations keep their source labels', async () => {
  const pending = makeAlert({ id: 'pending', explanation_status: 'pending', ai_summary: null,
    observation: { ...makeAlert().observation, api_name: 'PendingAPI' } });
  const mock = makeAlert({ id: 'mock', explanation_status: 'mock', ai_summary: 'MOCK EXPLANATION: server failure.',
    observation: { ...makeAlert().observation, api_name: 'DemoAPI' } });
  api.alerts.mockResolvedValue({ total: 2, limit: 20, offset: 0, items: [pending, mock] });
  render(<App />);
  await screen.findByText('PendingAPI');
  expect(screen.getByText('Explanation pending')).toBeInTheDocument();
  expect(screen.getByText('Demo explanation')).toBeInTheDocument();
  expect(screen.getByText('MOCK EXPLANATION: server failure.')).toBeInTheDocument();
});

test('uncertain POST failure offers refresh and never retries automatically', async () => {
  api.monitor.mockRejectedValue(new ApiError('Request timed out.', { uncertain: true }));
  render(<App />);
  await userEvent.click(screen.getByRole('button', { name: 'Submit observations' }));
  await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Submit observations' }));
  expect(await screen.findByText(/may already have persisted observations/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Refresh alerts' })).toBeInTheDocument();
  expect(api.monitor).toHaveBeenCalledTimes(1);
});
