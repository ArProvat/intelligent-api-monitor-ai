const base = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
const listTimeoutMs = 15000;
const positive = (value, fallback) => Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : fallback;

export class ApiError extends Error {
  constructor(message, { status = 0, requestId = null, data = null, uncertain = false } = {}) {
    super(message);
    this.name = 'ApiError';
    Object.assign(this, { status, requestId, data, uncertain });
  }
}

async function request(path, { method = 'GET', body, signal, timeoutMs = listTimeoutMs, uncertainOnFailure = false } = {}) {
  const timeout = AbortSignal.timeout(timeoutMs);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let response;
  try {
    response = await fetch(`${base}${path}`, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: combined
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new ApiError(timeout.aborted ? 'Request timed out.' : 'Could not reach the backend.', { uncertain: uncertainOnFailure });
  }
  const requestId = response.headers.get('X-Request-ID');
  let data;
  try { data = await response.json(); }
  catch {
    const unavailable = [502, 503, 504].includes(response.status);
    throw new ApiError(unavailable ? 'Backend unavailable. Check that the server is running and try Refresh.' : 'The backend returned an unreadable response.', {
      status: response.status, requestId, uncertain: uncertainOnFailure
    });
  }
  if (!response.ok) throw new ApiError(data?.error?.message || `Request failed (HTTP ${response.status}).`, {
    status: response.status, requestId: data?.error?.request_id || requestId, data
  });
  return data;
}

export const api = {
  health: options => request('/health', options),
  alerts: ({ status, severity, apiName, limit, offset }, options) => {
    const query = new URLSearchParams({ status, limit: String(limit), offset: String(offset) });
    if (severity) query.set('severity', severity);
    if (apiName.trim()) query.set('api_name', apiName.trim());
    return request(`/alerts?${query}`, options);
  },
  alert: (id, options) => request(`/alerts/${encodeURIComponent(id)}`, options),
  resolve: id => request(`/alerts/${encodeURIComponent(id)}/resolve`, { method: 'PATCH' }),
  monitor: (items, options) => request('/monitor', {
    method: 'POST', body: items, uncertainOnFailure: true,
    timeoutMs: Math.max(60000, Math.ceil(items.length / positive(import.meta.env.VITE_EXPECTED_LLM_CONCURRENCY, 3)) * positive(import.meta.env.VITE_EXPECTED_LLM_TIMEOUT_MS, 60000) + 30000),
    ...options
  })
};
