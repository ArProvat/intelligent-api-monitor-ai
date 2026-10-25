# End-to-end verification

Run from the repository root with Node 24 and installed dependencies:

```powershell
cd backend
npm run typecheck
npm run migrate
npm test
npm run build

cd ../frontend
npm test
npm run test:e2e
npm run test:browser
npm run build
```

`frontend/npm run test:browser` is the repeatable real-browser command. It uses Chrome at `C:/Program Files/Google/Chrome/Application/chrome.exe` by default; set `CHROME_PATH` to override it.

## Isolated environment

The browser suite creates a unique temporary SQLite database, chooses unused loopback ports, starts `backend/src/server.js`, and starts Vite with `DEV_BACKEND_URL` set to that backend. Browser requests therefore travel through the real Vite development proxy; no application API request is intercepted or faked. It removes the temporary database and attempts to stop only its own child processes.

The suite starts a loopback-only OpenAI chat-completions stub and configures the test backend with `OPENROUTER_BASE_URL`. The stub receives the application’s actual chat-completions request and deterministically holds, succeeds, or returns HTTP 500. No real provider or paid API is contacted. `OPENROUTER_BASE_URL` defaults to the normal OpenRouter endpoint and should be left unchanged outside controlled tests.

## Executed scenarios and outcomes

| Area | Outcome | Evidence |
| --- | --- | --- |
| HTTP ingestion, thresholds, status classes, zero/missing records, policies, validation limits, filters, lifecycle, persistence, CORS, request IDs, and health failure | Passed | `backend/test/monitor.test.js` (real loopback HTTP plus temporary SQLite) |
| Background explanations: pending response, generated, factual fallback on provider error/invalid response/timeout, resolution during generation, startup retry, and bounded concurrency | Passed | `backend/test/monitor.test.js` |
| Timed-out held provider no longer stalls the next worker item | Passed | `a timed-out held provider call releases worker capacity for the next alert` |
| React integration in jsdom against real Express and SQLite | Passed | `frontend/src/App.e2e.test.jsx` |
| Actual browser through Vite proxy: dashboard load, assessment submit, pending-to-generated, detail evidence, resolution, healthy sample, local JSON file, mixed validation, invalid JSON without POST, filters/pagination, zero vs missing, mobile width, Escape/focus restore, backend outage and manual refresh | Passed | `frontend/e2e/full-stack.spec.js` |
| Desktop/mobile visual inspection | Passed for no document horizontal overflow at 1440x900 and 390x844; screenshots captured | `frontend/test-artifacts/browser-e2e/<timestamp>/` |

The latest screenshots are written under `frontend/test-artifacts/browser-e2e/` and are ignored by Git. They include `dashboard-desktop.png`, `submission-pending.png`, `alert-details.png`, and `dashboard-mobile.png`.

## Scope and limitations

- The real browser test uses a local provider stub, not OpenRouter. It proves the OpenAI-compatible request format and application state transitions, not a paid-provider integration.
- The current automated suite does not force a SQLite write failure after a provider success; the worker logs that condition and leaves the row recoverable according to the implemented retry policy. This remains a targeted manual fault-injection check.
- The browser harness may require an unrestricted local process-spawn policy on Windows because Playwright launches a worker, Vite, the backend, and Chrome. It does not use pre-existing services.
- This verifies the local assessment implementation only. It is not a production-readiness claim; authentication, TLS, rate limiting, multi-process queueing, and deployed-provider checks remain outside scope.
