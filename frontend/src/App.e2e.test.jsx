import { expect, test } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { Worker } from 'node:worker_threads';
import App from './App.tsx';

test('real UI, HTTP, detection, worker, and SQLite complete one monitoring workflow', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'monitor-e2e-'));
  const worker = new Worker(join(process.cwd(), '..', 'backend', 'test', 'e2eServerWorker.js'), {
    workerData: { databasePath: join(dir, 'monitor.db') }
  });
  let providerCalls = 0;
  worker.on('message', message => { if (message.type === 'provider-called') providerCalls++; });
  const [{ port }] = await once(worker, 'message');
  const base = `http://127.0.0.1:${port}`;
  const realFetch = globalThis.fetch;
  globalThis.fetch = (path, options) => realFetch(new URL(path, base), options);
  const view = render(<App />);

  try {
    expect(await screen.findByText('Backend connected')).toBeInTheDocument();
    expect(await screen.findByText('No active alerts')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Submit observations' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Submit observations' }));
    const batch = await screen.findByRole('region', { name: 'Batch result' });
    expect(within(batch).getByText('Explanation: Explanation pending')).toBeInTheDocument();
    expect(within(batch).getByText('2')).toBeInTheDocument();
    await waitFor(() => expect(providerCalls).toBe(1));
    expect(within(batch).getByText(/Batch ID:/)).toHaveTextContent(/Batch ID: [0-9a-f-]{36}/);

    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close panel' }));
    expect(await screen.findByText('AppointmentAPI')).toBeInTheDocument();
    expect(screen.getByText('Explanation pending')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'View details for AppointmentAPI' }));
    const details = screen.getByRole('dialog', { name: 'Alert details' });
    expect(within(details).getByText('HTTP 500 is a server failure.')).toBeInTheDocument();
    expect(within(details).getByText('Unexpected empty result')).toBeInTheDocument();
    await userEvent.click(within(details).getByRole('button', { name: 'Close panel' }));

    await userEvent.click(screen.getByRole('button', { name: 'Resolve' }));
    expect(await screen.findByText('No active alerts')).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Status'), 'resolved');
    expect(await screen.findByText('AppointmentAPI')).toBeInTheDocument();
    worker.postMessage({ type: 'release' });
    expect(await screen.findByText('AI-generated explanation', {}, { timeout: 7000 })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'View details for AppointmentAPI' }));
    expect(within(screen.getByRole('dialog', { name: 'Alert details' })).getByText('HTTP 500, a slow response, and zero records were observed.')).toBeInTheDocument();
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close panel' }));

    await userEvent.click(screen.getByRole('button', { name: 'Submit observations' }));
    await userEvent.click(screen.getByRole('button', { name: 'Load healthy sample' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Submit observations' }));
    expect(await screen.findByText('Batch processed')).toBeInTheDocument();
    expect(providerCalls).toBe(1);
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close panel' }));

    await userEvent.click(screen.getByRole('button', { name: 'Submit observations' }));
    await userEvent.click(screen.getByRole('button', { name: 'Load mixed-validity sample' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Submit observations' }));
    const mixed = await screen.findByRole('region', { name: 'Batch result' });
    expect(within(mixed).getByText(/Item 3: rejected/)).toBeInTheDocument();
    expect(within(mixed).getByText(/Item 4: rejected/)).toBeInTheDocument();
    expect(within(mixed).getByText(/Unrecognized key: "patient_payload"/)).toBeInTheDocument();
    expect(await within(mixed).findByText('Explanation: Rule-based explanation', {}, { timeout: 7000 })).toBeInTheDocument();
    expect(providerCalls).toBe(2);
  } finally {
    view.unmount();
    globalThis.fetch = realFetch;
    worker.postMessage({ type: 'stop' });
    await once(worker, 'exit');
    rmSync(dir, { recursive: true, force: true });
  }
}, 20000);
