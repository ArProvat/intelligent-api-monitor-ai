# API Monitor frontend

React, Vite, native fetch, and plain CSS. The dashboard uses the real backend: submitted observations create alerts; it does not poll monitored APIs.

## Source map

| Path | Purpose |
| --- | --- |
| `src/App.tsx`, `src/main.tsx` | Dashboard entry and React mount |
| `src/pages/DashboardPage.jsx` | Full dashboard layout and alert interactions |
| `src/components/` | Alert and submission panels, dialog, and request error display |
| `src/hooks/useBackendHealth.js` | Backend availability check on load and refresh |
| `src/services/api.js` | All HTTP requests, errors, and timeouts |
| `src/utils/` | Alert display helpers and editable sample batches |
| `src/assets/` | Product mark |

The entry files use TSX extensions to match the requested layout. The implementation remains JavaScript/JSX, as specified for Day 2; there is no TypeScript type-checking step. `App.test.jsx` exercises the dashboard with a stubbed API client.

## Local development

Start the backend first from `../backend` with `node --env-file=.env src/server.js`. Use `LLM_MODE=fallback` or `mock` for routine UI work and set `DATABASE_PATH=./data/ui-demo.db` to keep test data separate. Then:

```powershell
cd frontend
npm install
npm run dev
```

Open `http://127.0.0.1:5173`. Vite proxies API paths to `http://127.0.0.1:3000`. If the backend runs elsewhere, set `DEV_BACKEND_URL` in the frontend terminal before `npm run dev`. For example, `$env:DEV_BACKEND_URL='http://127.0.0.1:31417'`. No backend CORS change is needed when using this proxy.

Alternatively set `VITE_API_BASE_URL` to a full backend URL before starting Vite or building. For a cross-origin URL, add the exact frontend origin to the backend `CORS_ORIGINS` allowlist. The frontend `.env.example` lists public configuration only. Never put `OPENROUTER_API_KEY` or other secrets in any `VITE_*` variable.

## Build and test

```powershell
npm test
npm run build
npm run preview
```

The production files are in `dist/`. The development proxy does not ship with the build. Serve the API under the same origin or build with `VITE_API_BASE_URL` set. The Vite scripts use its native config loader, which also avoids a Windows sandbox process-spawn issue in this assessment environment.

## Demo walkthrough

1. Confirm the header says **Backend connected**. This checks application and SQLite availability only.
2. Select **Submit observations**, load the assessment sample, and submit. The editor keeps its JSON while the backend processes explanations.
3. Open the AppointmentAPI alert. Review metrics, every finding, effective policy, explanation source, and suggested checks.
4. Resolve the alert. It leaves Active after server confirmation and appears under Resolved.
5. Submit the healthy sample and verify it creates no alert.
6. Submit the mixed-validity sample and review Item 3 and Item 4 validation errors. Item numbers are one-based; original zero-based indexes appear beside them.

The API-name filter is an exact name match. The matching total comes from the backend, and pages contain up to 20 alerts. List and detail requests are cancelled when obsolete. A failed or timed-out POST is not automatically retried because observations may already have been stored; use Refresh to inspect alerts first.

The [browser QA record](docs/day2-browser-qa.md) lists the visual and keyboard checks still needed before Day 2 can be marked complete.

## Known limits

Manual refresh only; no live external API polling or realtime stream. The frontend has no authentication because this is a local assessment demo. The default POST timeout is calculated from batch size and the expected LLM concurrency and per-call timeout; set `VITE_EXPECTED_LLM_CONCURRENCY` and `VITE_EXPECTED_LLM_TIMEOUT_MS` to match backend settings if they differ. A successful health check does not mean monitored external APIs are healthy.
