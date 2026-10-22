# Intelligent API Monitoring & Alert System

Local assessment backend for batched API observations. Node.js 24 LTS, JavaScript, Express 5, SQLite, Zod, and Pino. Anomalies are deterministic; the OpenAI SDK uses OpenRouter only to explain findings already stored.

## Setup and commands

Requires Node.js 24 and npm. Copy `.env.example` to `.env` and set values. Node 24 can load the file with `--env-file=.env`; the app also works with ordinary environment variables.

```sh
npm install
node --env-file=.env src/migrate.js
npm run typecheck
npm test
npm run build
node --env-file=.env dist/src/server.js
```

For development: `node --env-file=.env --watch src/server.js` (or `npm run dev` with variables already set). For a production run, set `NODE_ENV=production`, `LLM_MODE=openrouter`, and `OPENROUTER_API_KEY` in the server environment, then run `npm run build && npm start`. `npm run migrate` and `npm start` use ordinary environment variables; both also apply any unapplied migrations on startup. The build copies JavaScript and SQL into `dist`; it does not transpile JavaScript. The default SQLite file is `./data/monitor.db` relative to the process working directory.

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT`, `HOST` | `3000`, `127.0.0.1` | Local listener |
| `DATABASE_PATH` | `./data/monitor.db` | SQLite database |
| `CORS_ORIGINS` | empty | Comma separated exact allowed origins |
| `API_POLICIES_JSON` | `{}` | Map of API names to policy overrides |
| `LLM_MODE` | `fallback` | `openrouter`, `mock`, or `fallback` |
| `OPENROUTER_API_KEY` | empty | Server side credential; absent key forces fallback even in `openrouter` mode |
| `OPENROUTER_MODEL` | `openai/gpt-4o-mini` | OpenRouter model ID supporting structured outputs |
| `LLM_TIMEOUT_MS` | `8000` | Per call and queue wait timeout, 100–60000 |
| `LLM_CONCURRENCY` | `3` | Maximum concurrent provider calls, 1–20 |
| `SHUTDOWN_GRACE_MS` | `15000` | Grace for in flight requests before forced close |
| `LOG_LEVEL` | `info` | Pino log level |

For `minimax/minimax-m3.1-flash:free`, set `LLM_TIMEOUT_MS=30000` for the slower live endpoint. Its [OpenRouter model page](https://openrouter.ai/minimax/minimax-m3.1-flash%3Afree) documents JSON output without JSON-schema enforcement, so the adapter requests JSON object mode and still validates every returned field locally. Other configured models use JSON-schema mode. Set `LLM_MODE=openrouter` to make real calls; `fallback` never calls the provider. Free model availability can change.

Example override: `API_POLICIES_JSON={"AppointmentAPI":{"responseTimeThresholdMs":5000},"SearchAPI":{"expectRecords":false}}`. Exact, case sensitive API names are matched after trimming. Default policy is `responseTimeThresholdMs=3000` and `expectRecords=true`; zero or absent counts are therefore anomalous by default. A status in 500–599 is critical; 400–499, slow response, zero records, and absent records count are warnings. Each anomalous observation creates exactly one alert containing all findings. No grouping or deduplication occurs.

## HTTP examples

```sh
curl -sS -H 'Content-Type: application/json' --data-binary @samples/assessment.json http://127.0.0.1:3000/monitor
curl -sS 'http://127.0.0.1:3000/alerts?status=active&limit=20&offset=0'
curl -sS http://127.0.0.1:3000/alerts/ALERT_ID
curl -sS -X PATCH http://127.0.0.1:3000/alerts/ALERT_ID/resolve
curl -sS http://127.0.0.1:3000/health
```

PowerShell:

```powershell
$body = Get-Content .\samples\assessment.json -Raw
$result = Invoke-RestMethod -Uri http://127.0.0.1:3000/monitor -Method Post -ContentType application/json -Body $body
$id = $result.results[1].alert_id
Invoke-RestMethod -Uri "http://127.0.0.1:3000/alerts/$id"
Invoke-RestMethod -Uri "http://127.0.0.1:3000/alerts/$id/resolve" -Method Patch
```

## API contract

`POST /monitor` takes a JSON array of 1–100 observations, up to 64 KB. Each item allows only `api_name` (trimmed, 1–100 characters), finite nonnegative numeric `response_time_ms`, integer `status_code` (100–599), and optional nonnegative integer `records_returned`. Numeric strings and extra fields are rejected. Structural errors return 422, malformed JSON 400, and an oversized body 413. Valid items still process when neighbors are invalid. A fully invalid batch returns 422 with indexed errors and a stored batch record. A completed mixed batch returns 200. Example response (UUIDs shortened here for readability):

```json
{
  "batch_id": "uuid",
  "counts": { "received": 2, "accepted": 2, "rejected": 0, "healthy": 1, "alerts": 1, "explanations": { "generated": 0, "fallback": 1, "mock": 0 } },
  "results": [
    { "index": 0, "observation_id": "uuid", "status": "healthy" },
    { "index": 1, "observation_id": "uuid", "alert_id": "uuid", "status": "alert", "severity": "critical", "findings": [ { "code": "SERVER_FAILURE", "severity": "critical", "description": "HTTP 500 is a server failure.", "observed": 500, "expected": "HTTP status below 500" } ], "explanation_status": "fallback" }
  ]
}
```

`GET /alerts` defaults to active alerts. Filters: `status=active|resolved|all`, exact `api_name`, `severity=warning|critical`, `limit=1..100` (default 20), and `offset=0..1000000` (default 0). Returns `{total,limit,offset,items}` ordered by creation time and ID descending. Each item includes the complete alert and observation. `GET /alerts/:id` returns one alert or 404. `PATCH /alerts/:id/resolve` returns the resolved alert and preserves `resolved_at` on repeated calls. `GET /health` checks SQLite only and returns 503 when unavailable. Errors use `{ "error": { "code": "...", "message": "...", "request_id": "uuid" } }`; the response header also carries `X-Request-ID`.

## Architecture and operations

The Express app maps routes to controllers. Controllers validate HTTP input and shape JSON responses; services apply monitoring rules and generate explanations; the model owns SQLite queries and transactions. See [the developer end-to-end walkthrough](docs/developer-e2e.md) for the file map and a request trace. `migrations/001_initial.sql` is versioned with SQLite `user_version`. The transaction stores the batch, valid observations, and pending alerts before any LLM call. Every pending alert already has a factual fallback message. On startup, leftover pending alerts become fallback; there is no durable background retry. LLM errors affect only explanation status. In `mock` mode, output is explicitly labeled `MOCK EXPLANATION` and stored with `mock` status. In `fallback` mode or with no key, no provider call occurs and no output is labeled AI generated. Generated responses are schema validated and length bounded. Only metadata and findings are sent to OpenRouter through the OpenAI SDK; no observation body or patient payload is logged. POST waits for all explanations, so latency grows with the number of anomalous observations and the configured concurrency/timeout.

To verify a live explanation, set `LLM_MODE=openrouter`, `OPENROUTER_API_KEY`, and optionally `OPENROUTER_MODEL` in the ignored `.env` file. Start the backend, POST an anomalous observation, then GET its `alert_id`. A successful response has `explanation_status: "generated"`, `provider: "openrouter"`, and a factual `ai_summary`. Do not add `.env` to Git.

The React dashboard is in [`../frontend`](../frontend/README.md). During development, Vite proxies `/monitor`, `/alerts`, and `/health` to this backend at port 3000, so no CORS change is needed. Set `CORS_ORIGINS` only when the browser calls the backend directly from another origin.

This is a local assessment demo. Authentication, TLS, rate limits, and deployment controls are required before public exposure. SQLite is appropriate for a single local application process; multi instance operation needs a different persistence design. API names are identifiers, not instructions, but callers should render them as text. No email reporting, incident grouping, or model based anomaly decisions are included.

Official references used for compatibility: [Node 24 LTS](https://nodejs.org/en/blog/release/v24.22.1/), [Express 5 error handling](https://expressjs.com/en/5x/guide/error-handling/), [SQLite library](https://github.com/WiseLibs/better-sqlite3), [Zod safe parsing](https://zod.dev/basics), [OpenAI JavaScript SDK](https://developers.openai.com/api/docs/libraries), [OpenRouter SDK setup](https://openrouter.ai/docs/guides/community/openai-sdk), and [OpenRouter structured outputs](https://openrouter.ai/docs/guides/features/structured-outputs).
