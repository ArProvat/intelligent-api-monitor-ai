import { Dialog, RequestError } from './ui.jsx';
import { dateText, explanationNames, explanationText, findingNames, observedText } from '../utils/alerts.js';

export default function AlertDialog({ alert, loading, error, resolving, resolveError, onResolve, onClose, returnFocus }) {
  return <Dialog title="Alert details" onClose={onClose} returnFocus={returnFocus}>
    <div className="dialog-content">
      {loading && <p className="muted" role="status">Updating alert details…</p>}
      <RequestError error={error} />
      {alert && <>
        <div className="detail-heading">
          <div><h3>{alert.observation.api_name}</h3><p className="id-text">Alert ID: <code>{alert.id}</code></p></div>
          <div className="pill-group"><span className={`badge badge-${alert.severity}`}>{alert.severity}</span><span className={`badge badge-${alert.status}`}>{alert.status}</span></div>
        </div>
        <div className="detail-grid">
          <div><span>Created</span><strong>{dateText(alert.created_at)}</strong></div>
          <div><span>Resolved</span><strong>{dateText(alert.resolved_at)}</strong></div>
          <div><span>HTTP status</span><strong>{alert.observation.status_code}</strong></div>
          <div><span>Response time</span><strong>{alert.observation.response_time_ms} ms</strong></div>
          <div><span>Records returned</span><strong>{observedText(alert.observation.records_returned)}</strong></div>
          <div><span>Response threshold</span><strong>{alert.observation.effective_policy?.responseTimeThresholdMs ?? '—'} ms</strong></div>
          <div><span>Records expected</span><strong>{alert.observation.effective_policy?.expectRecords ? 'Yes' : 'No'}</strong></div>
        </div>
        <section className="detail-section"><h4>Detected findings</h4>
          <ul className="finding-list">{alert.findings.map(finding => <li key={finding.code}>
            <div className="finding-title"><strong>{findingNames[finding.code] || finding.code}</strong><span className={`badge badge-${finding.severity}`}>{finding.severity}</span></div>
            <p>{finding.description}</p><dl><div><dt>Observed</dt><dd>{observedText(finding.observed)}</dd></div><div><dt>Expected</dt><dd>{finding.expected}</dd></div></dl>
          </li>)}</ul>
        </section>
        <section className="detail-section"><div className="section-heading"><h4>Explanation</h4><span className="source-tag">{explanationNames[alert.explanation_status] || alert.explanation_status}</span></div>
          <p className="explanation-body">{explanationText(alert)}</p>
          {alert.explanation_status === 'pending' && <p className="muted">Showing the factual rule-based message while generation is pending.</p>}
          {alert.suggested_checks?.length > 0 && <><h5>Suggested checks</h5><ul className="check-list">{alert.suggested_checks.map((check, index) => <li key={index}>{check}</li>)}</ul></>}
          {alert.provider && <p className="provider-line">Provider: {alert.provider}{alert.model && <> · Model: {alert.model}</>}</p>}
        </section>
        <RequestError error={resolveError} />
      </>}
    </div>
    <div className="dialog-actions">
      <button className="button button-secondary" type="button" onClick={onClose}>Close</button>
      {alert?.status === 'active' && <button className="button button-primary" type="button" disabled={resolving} onClick={() => onResolve(alert.id)}>{resolving ? 'Resolving…' : 'Resolve alert'}</button>}
    </div>
  </Dialog>;
}
