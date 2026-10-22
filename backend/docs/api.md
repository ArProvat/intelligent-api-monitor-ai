# API contract

The backend listens on `http://127.0.0.1:3000` by default. It evaluates submitted observations; it does not poll external APIs. Responses include an `X-Request-ID` header. Errors include the same ID in `error.request_id`. Findings are deterministic; OpenRouter only explains them.

## `GET /health`

Checks application and SQLite availability without calling an LLM. Returns `200` with `{ "status": "ok", "database": "available" }`, or `503` with `{ "status": "unavailable", "database": "unavailable", "error": { "code": "DATABASE_UNAVAILABLE", "message": "Database is unavailable", "request_id": "uuid" } }`. It does not report the health of monitored APIs.

## `POST /monitor`

Accepts a JSON array of 1–100 observations, with a 64 KB body limit. Each item may contain only:

| Field | Type | Rule |
| --- | --- | --- |
| `api_name` | string | Trimmed, nonempty, at most 100 characters |
| `response_time_ms` | number | Finite and nonnegative |
| `status_code` | integer | 100–599 |
| `records_returned` | optional integer | Nonnegative; missing remains distinct from zero |

Numeric strings and extra fields are rejected. Valid items in a mixed batch still process. Accepted observations and alerts are stored before explanation calls. Healthy observations create no alerts. In real-provider mode, POST returns after the database commit with anomalous explanations `pending`; the worker finishes them after the response. In fallback and mock modes, explanations are final at POST time.

```json
[
  { "api_name": "PatientDataAPI", "response_time_ms": 1200, "status_code": 200, "records_returned": 50 },
  { "api_name": "AppointmentAPI", "response_time_ms": 5500, "status_code": 500, "records_returned": 0 }
]
```

A batch with at least one accepted item returns `200`. A fully invalid batch returns `422` with the same batch feedback shape. IDs and findings below are shortened for readability:

```json
{
  "batch_id": "uuid",
  "counts": {
    "received": 2, "accepted": 2, "rejected": 0, "healthy": 1, "alerts": 1,
    "explanations": { "pending": 1, "generated": 0, "fallback": 0, "mock": 0 }
  },
  "results": [
    { "index": 0, "observation_id": "uuid", "status": "healthy" },
    {
      "index": 1, "observation_id": "uuid", "alert_id": "uuid", "status": "alert",
      "severity": "critical", "explanation_status": "pending",
      "findings": [{ "code": "SERVER_FAILURE", "severity": "critical", "description": "HTTP 500 is a server failure.", "observed": 500, "expected": "HTTP status below 500" }]
    }
  ]
}
```

Rejected items appear as `{ "index": 2, "status": "rejected", "errors": [{ "field": "response_time_ms", "message": "..." }] }`. Indexes are zero-based and refer to the original array. Malformed JSON returns `400 MALFORMED_JSON`; an oversized body returns `413 BODY_TOO_LARGE`; a non-array, empty, or over-100-item batch returns `422 INVALID_BATCH`.

## `GET /alerts`

Defaults to active alerts. Supports `status=active|resolved|all`, `severity=warning|critical`, exact case-sensitive `api_name`, optional `batch_id` UUID, `limit=1..100` (default 20), and `offset=0..1000000` (default 0). Returns `{ "total": 1, "limit": 20, "offset": 0, "items": [alert] }`. `total` is the full matching count. Items are ordered by creation time and ID, newest first. Poll `status=all&batch_id=UUID` to see all explanations for one submitted batch, including resolved alerts. Invalid filters return `400 INVALID_QUERY`.

An alert item and the `GET /alerts/:id` response include:

```json
{
  "id": "uuid", "observation_id": "uuid", "severity": "critical", "status": "active",
  "findings": [{ "code": "SERVER_FAILURE", "severity": "critical", "description": "HTTP 500 is a server failure.", "observed": 500, "expected": "HTTP status below 500" }],
  "fallback_message": "AppointmentAPI: HTTP 500 is a server failure.",
  "ai_summary": null, "suggested_checks": null, "explanation_status": "pending",
  "provider": null, "model": null,
  "created_at": "2026-10-22T00:00:00.000Z", "updated_at": "2026-10-22T00:00:00.000Z", "resolved_at": null,
  "observation": {
    "id": "uuid", "batch_id": "uuid", "batch_index": 1, "api_name": "AppointmentAPI",
    "response_time_ms": 5500, "status_code": 500, "records_returned": 0,
    "created_at": "2026-10-22T00:00:00.000Z",
    "effective_policy": { "responseTimeThresholdMs": 3000, "expectRecords": true }
  }
}
```

The example shows one finding for brevity. The assessment observation actually triggers three: server failure, slow response, and unexpected empty result. Explanation status is `pending`, `generated`, `fallback`, or `mock`. A generated alert has a validated `ai_summary`, `suggested_checks`, and provider/model metadata. A pending or fallback alert has a factual `fallback_message`; mock content is explicitly demo output. Alert lifecycle status (`active` or `resolved`) is independent of explanation status.

## `GET /alerts/:id`

Returns the complete alert or `404 NOT_FOUND`.

## `PATCH /alerts/:id/resolve`

Returns the complete alert with `status: "resolved"` and `resolved_at`. Repeated resolution preserves the first `resolved_at`. Unknown IDs return `404 NOT_FOUND`. No request body is needed.

## Errors

Errors use `{ "error": { "code": "INVALID_QUERY", "message": "Invalid alert filters", "details": [], "request_id": "uuid" } }`. `details` is present for validation errors when available. Internal errors return `500 INTERNAL_ERROR` without a stack trace. Render API and model strings as plain text.
