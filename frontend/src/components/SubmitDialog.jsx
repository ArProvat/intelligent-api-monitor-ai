import { useState } from 'react';
import { api, ApiError } from '../services/api.js';
import { assessmentSample, formatSample, healthySample, mixedSample } from '../utils/samples.js';
import { Dialog, RequestError } from './ui.jsx';
import { findingNames } from '../utils/alerts.js';

const maxBytes = 64 * 1024;

export default function SubmitDialog({ onClose, onProcessed, onRefresh, returnFocus }) {
  const [editor, setEditor] = useState(formatSample(assessmentSample));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  function loadSample(sample) { setEditor(formatSample(sample)); setError(null); setResult(null); }

  async function loadFile(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > maxBytes) { setError(new ApiError('The JSON file exceeds the backend’s 64 KB body limit.')); return; }
    try { setEditor(await file.text()); setError(null); setResult(null); }
    catch { setError(new ApiError('Could not read the selected file.')); }
  }

  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    setError(null); setResult(null);
    if (new TextEncoder().encode(editor).length > maxBytes) { setError(new ApiError('The JSON body exceeds 64 KB.')); return; }
    let items;
    try { items = JSON.parse(editor); }
    catch { setError(new ApiError('Enter valid JSON before submitting.')); return; }
    if (!Array.isArray(items)) { setError(new ApiError('The JSON must be an array of observations.')); return; }
    if (items.length < 1 || items.length > 100) { setError(new ApiError('Submit between 1 and 100 observations.')); return; }
    setBusy(true);
    try {
      const response = await api.monitor(items);
      setResult(response);
      onProcessed();
    } catch (failure) {
      if (failure.status === 422 && failure.data?.results) {
        setResult(failure.data);
        onProcessed();
      } else setError(failure);
    } finally { setBusy(false); }
  }

  return <Dialog title="Submit observations" onClose={onClose} returnFocus={returnFocus} className="submit-panel">
    <div className="dialog-content">
      <p className="muted">Paste a JSON batch or load a sample. Samples fill the editor; only Submit sends data. Anomalies may take longer while explanations are generated.</p>
      <div className="sample-actions" aria-label="Load a sample batch">
        <button type="button" className="button button-small" disabled={busy} onClick={() => loadSample(assessmentSample)}>Load assessment sample</button>
        <button type="button" className="button button-small" disabled={busy} onClick={() => loadSample(healthySample)}>Load healthy sample</button>
        <button type="button" className="button button-small" disabled={busy} onClick={() => loadSample(mixedSample)}>Load mixed-validity sample</button>
      </div>
      <form id="observation-form" onSubmit={submit}>
        <label className="field-label" htmlFor="observation-json">Observations JSON</label>
        <textarea id="observation-json" value={editor} onChange={event => setEditor(event.target.value)} spellCheck="false" rows="12" disabled={busy} />
        <label className="file-label" htmlFor="observation-file">Load a local .json file</label>
        <input id="observation-file" type="file" accept=".json,application/json" onChange={loadFile} disabled={busy} />
      </form>
      {busy && <p className="notice notice-info" role="status">Processing observations… Explanation generation can take time for batches with several alerts.</p>}
      <RequestError error={error} />
      {error?.uncertain && <div className="notice notice-info">The request may already have persisted observations. Refresh alerts before deciding whether to submit again. <button className="text-button" type="button" onClick={onRefresh}>Refresh alerts</button></div>}
      {result && <section className="batch-result" aria-label="Batch result">
        <h3>Batch processed</h3><p className="id-text">Batch ID: <code>{result.batch_id}</code></p>
        <div className="result-stats"><span><strong>{result.counts.accepted}</strong> accepted</span><span><strong>{result.counts.rejected}</strong> rejected</span><span><strong>{result.counts.healthy}</strong> healthy</span><span><strong>{result.counts.alerts}</strong> alerts</span></div>
        <p className="muted">Explanations: {result.counts.explanations.generated} generated · {result.counts.explanations.fallback} fallback · {result.counts.explanations.mock} demo</p>
        <ul className="batch-items">{result.results.map(item => <li key={item.index}>
          <strong>Item {item.index + 1}: {item.status}</strong><span className="muted">Original index {item.index}</span>
          {item.findings?.length > 0 && <p>{item.findings.map(f => findingNames[f.code] || f.code).join(' · ')}</p>}
          {item.explanation_status && <p>Explanation: {item.explanation_status}</p>}
          {item.errors?.length > 0 && <ul>{item.errors.map((issue, index) => <li key={index}><strong>{issue.field}</strong>: {issue.message}</li>)}</ul>}
        </li>)}</ul>
      </section>}
    </div>
    <div className="dialog-actions"><button className="button button-secondary" type="button" onClick={onClose}>Close</button><button className="button button-primary" type="submit" form="observation-form" disabled={busy}>{busy ? 'Processing observations…' : 'Submit observations'}</button></div>
  </Dialog>;
}
