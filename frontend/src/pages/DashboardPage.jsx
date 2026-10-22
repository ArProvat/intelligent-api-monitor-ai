import { useEffect, useRef, useState } from 'react';
import { api } from '../services/api.js';
import AlertDialog from '../components/AlertDialog.jsx';
import SubmitDialog from '../components/SubmitDialog.jsx';
import { RequestError } from '../components/ui.jsx';
import { dateText, explanationNames, explanationText, findingNames } from '../utils/alerts.js';
import { useBackendHealth } from '../hooks/useBackendHealth.js';
import pulseIcon from '../assets/pulse.svg';

const pageSize = 20;

export default function DashboardPage() {
  const [filters, setFilters] = useState({ status: 'active', severity: '', apiName: '' });
  const [page, setPage] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const [listing, setListing] = useState({ data: null, loading: true, refreshing: false, error: null });
  const health = useBackendHealth(refresh);
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState({ data: null, loading: false, error: null });
  const [submitOpen, setSubmitOpen] = useState(false);
  const [resolvingId, setResolvingId] = useState(null);
  const [resolveError, setResolveError] = useState(null);
  const listVersion = useRef(0);
  const detailVersion = useRef(0);
  const resolving = useRef(false);
  const listHeading = useRef(null);

  useEffect(() => {
    const controller = new AbortController();
    const version = ++listVersion.current;
    setListing(previous => ({ ...previous, loading: !previous.data, refreshing: !!previous.data, error: null }));
    api.alerts({ ...filters, limit: pageSize, offset: page * pageSize }, { signal: controller.signal })
      .then(data => {
        if (controller.signal.aborted || version !== listVersion.current) return;
        if (data.total > 0 && page * pageSize >= data.total) {
          setPage(Math.max(0, Math.ceil(data.total / pageSize) - 1));
          return;
        }
        setListing({ data, loading: false, refreshing: false, error: null });
      })
      .catch(error => {
        if (!controller.signal.aborted && version === listVersion.current) setListing(previous => ({ ...previous, loading: false, refreshing: false, error }));
      });
    return () => controller.abort();
  }, [filters.status, filters.severity, filters.apiName, page, refresh]);

  useEffect(() => {
    if (!selectedId) return;
    const controller = new AbortController();
    const version = ++detailVersion.current;
    setDetail(previous => ({ ...previous, loading: true, error: null }));
    api.alert(selectedId, { signal: controller.signal })
      .then(data => { if (!controller.signal.aborted && version === detailVersion.current) setDetail({ data, loading: false, error: null }); })
      .catch(error => { if (!controller.signal.aborted && version === detailVersion.current) setDetail(previous => ({ ...previous, loading: false, error })); });
    return () => controller.abort();
  }, [selectedId]);

  function changeFilter(field, value) {
    setPage(0);
    setFilters(previous => ({ ...previous, [field]: value }));
  }

  function refreshAll() { setRefresh(value => value + 1); }
  function afterProcessed() { setPage(0); refreshAll(); }

  function openDetail(alert) {
    setSubmitOpen(false);
    setResolveError(null);
    setDetail({ data: alert, loading: true, error: null });
    setSelectedId(alert.id);
  }

  async function resolve(id) {
    if (resolving.current) return;
    resolving.current = true;
    setResolvingId(id);
    setResolveError(null);
    try {
      const updated = await api.resolve(id);
      if (selectedId === id) setDetail({ data: updated, loading: false, error: null });
      ++listVersion.current;
      setListing(previous => {
        if (!previous.data) return previous;
        const active = filters.status === 'active';
        return { ...previous, data: {
          ...previous.data,
          total: active ? Math.max(0, previous.data.total - 1) : previous.data.total,
          items: active ? previous.data.items.filter(item => item.id !== id) : previous.data.items.map(item => item.id === id ? updated : item)
        } };
      });
      setRefresh(value => value + 1);
    } catch (error) { setResolveError(error); }
    finally { resolving.current = false; setResolvingId(null); }
  }

  const data = listing.data;
  const currentPage = page + 1;
  const totalPages = Math.max(1, Math.ceil((data?.total || 0) / pageSize));
  const defaultActive = filters.status === 'active' && !filters.severity && !filters.apiName.trim();

  return <>
    <div id="app-shell">
      <header className="topbar"><div className="topbar-inner">
        <div className="brand"><div className="brand-mark" aria-hidden="true"><img src={pulseIcon} alt="" /></div><div><strong>API Monitor</strong><span>API observations and anomaly alerts</span></div></div>
        <div className="header-actions">
          <span className={`connection connection-${health}`} role="status"><span className="connection-dot" />{health === 'connected' ? 'Backend connected' : health === 'unavailable' ? 'Backend unavailable' : 'Checking backend…'}</span>
          <button className="button button-secondary" type="button" onClick={refreshAll}>Refresh</button>
          <button className="button button-primary" type="button" onClick={() => { setSelectedId(null); setSubmitOpen(true); }}>Submit observations</button>
        </div>
      </div></header>
      <main className="main-content">
        <div className="page-heading"><div><p className="eyebrow">MONITORING WORKSPACE</p><h1 ref={listHeading} tabIndex={-1}>Anomaly alerts</h1><p>Review findings from submitted API observations and resolve alerts after investigation.</p></div>
          <div className="count-card"><strong>{data?.total ?? '—'}</strong><span>matching alerts</span></div>
        </div>
        <section className="surface filters" aria-label="Alert filters">
          <div className="filter-field"><label htmlFor="status-filter">Status</label><select id="status-filter" value={filters.status} onChange={event => changeFilter('status', event.target.value)}><option value="active">Active</option><option value="resolved">Resolved</option><option value="all">All</option></select></div>
          <div className="filter-field"><label htmlFor="severity-filter">Severity</label><select id="severity-filter" value={filters.severity} onChange={event => changeFilter('severity', event.target.value)}><option value="">All severities</option><option value="critical">Critical</option><option value="warning">Warning</option></select></div>
          <div className="filter-field filter-search"><label htmlFor="api-filter">API name</label><input id="api-filter" type="search" placeholder="Exact API name" maxLength="100" value={filters.apiName} onChange={event => changeFilter('apiName', event.target.value)} /></div>
        </section>
        <section className="surface alert-section" aria-labelledby="alert-list-title">
          <div className="section-bar"><div><p className="eyebrow">RESULTS</p><h2 id="alert-list-title">Alerts</h2></div><span className="muted" aria-live="polite">{listing.refreshing ? 'Refreshing results…' : data ? `${data.total} matching results` : ''}</span></div>
          <RequestError error={listing.error} />
          <RequestError error={resolveError} />
          {listing.loading && !data ? <div className="state-box" role="status"><span className="loading-line" />Loading alerts…</div>
            : !data && listing.error ? <div className="state-box"><strong>Alerts are unavailable</strong><p>Check the backend and try again.</p><button className="button button-secondary" type="button" onClick={refreshAll}>Try again</button></div>
              : data?.items.length === 0 ? <div className="state-box"><span className="empty-icon" aria-hidden="true">✓</span><strong>{defaultActive ? 'No active alerts' : 'No matches for these filters'}</strong><p>{defaultActive ? 'Submitted observations have no unresolved anomalies.' : 'Try another status, severity, or exact API name.'}</p></div>
                : <div className="alert-list" role="list">
                  <div className="list-head" aria-hidden="true"><span>Alert</span><span>Severity</span><span>Created</span><span>Status</span><span>Actions</span></div>
                  {data.items.map(alert => <article className="alert-row" role="listitem" key={alert.id}>
                    <div className="alert-main"><strong>{alert.observation.api_name}</strong><p>{explanationText(alert)}</p><div className="tag-row">{alert.findings.map(finding => <span className="finding-tag" key={finding.code}>{findingNames[finding.code] || finding.code}</span>)}</div><span className="source-tag">{explanationNames[alert.explanation_status] || alert.explanation_status}</span></div>
                    <div className="row-cell"><span className="mobile-label">Severity</span><span className={`badge badge-${alert.severity}`}>{alert.severity}</span></div>
                    <div className="row-cell"><span className="mobile-label">Created</span><time dateTime={alert.created_at}>{dateText(alert.created_at)}</time></div>
                    <div className="row-cell"><span className="mobile-label">Status</span><span className={`badge badge-${alert.status}`}>{alert.status}</span></div>
                    <div className="row-actions"><button className="text-button" type="button" onClick={() => openDetail(alert)} aria-label={`View details for ${alert.observation.api_name}`}>View details</button>{alert.status === 'active' && <button className="text-button" type="button" disabled={resolvingId === alert.id} onClick={() => resolve(alert.id)}>{resolvingId === alert.id ? 'Resolving…' : 'Resolve'}</button>}</div>
                  </article>)}
                </div>}
          {data && <div className="pagination"><span>Page {currentPage} of {totalPages}</span><div><button className="button button-small" type="button" disabled={page === 0 || listing.refreshing} onClick={() => setPage(value => value - 1)}>Previous</button><button className="button button-small" type="button" disabled={currentPage >= totalPages || listing.refreshing} onClick={() => setPage(value => value + 1)}>Next</button></div></div>}
        </section>
        <p className="footer-note">Backend connection reports application and database availability. It does not measure the health of monitored APIs.</p>
      </main>
    </div>
    {selectedId && <AlertDialog alert={detail.data?.id === selectedId ? detail.data : null} loading={detail.loading} error={detail.error} resolving={resolvingId === selectedId} resolveError={resolveError} onResolve={resolve} onClose={() => setSelectedId(null)} returnFocus={listHeading} />}
    {submitOpen && <SubmitDialog onClose={() => setSubmitOpen(false)} onProcessed={afterProcessed} onRefresh={refreshAll} returnFocus={listHeading} />}
  </>;
}
