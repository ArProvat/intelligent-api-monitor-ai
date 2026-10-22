# Day 2 browser verification

Status: **open**. The local sandbox rejected launching Chrome (`sandbox_approval` is disabled), so desktop/mobile visuals and live keyboard behavior have not been inspected in a browser. The ignored `.chrome-smoke` directory does not affect this work.

## Checks completed on 2026-10-22

- Vite served `http://127.0.0.1:5173/` with HTTP 200. A separate fallback-mode backend and SQLite database handled requests through the Vite proxy.
- Submitting `backend/samples/assessment.json` accepted two observations and created one `AppointmentAPI` alert with three findings. Its explanation status was `fallback`.
- Fetching alert detail, resolving it, and querying Active and Resolved succeeded. Active contained zero alerts after resolution; Resolved contained one.
- Stopping that backend produced an empty HTTP 502 from Vite. The API client now reports “Backend unavailable. Check that the server is running and try Refresh.”
- Frontend tests cover dialog focus containment, Escape and focus return, filters, submission, resolution, and the visible backend failure state. Tests run in jsdom and cannot establish visual layout or actual browser interaction.
- The integrated `npm run test:e2e` test mounts the real React dashboard against a real Express server and temporary SQLite database. It covers submit, pending-to-generated explanation, detail evidence, resolution, healthy and mixed-validity batches, and provider-failure fallback with a stub. It still does not establish visual layout or actual browser interaction.
- A browser report exposed `Origin is not allowed` when Vite forwarded `http://127.0.0.1:5173` to a backend configured only for `localhost:5173`. Both exact local origins are now in the backend `.env.example` and local `.env`. The reported mixed-validity batch then passed through the Vite proxy: two accepted, two rejected, one healthy, and one alert. This confirms the CORS and validation path, not the browser visuals.

## Browser checks to finish

Start the backend and frontend using the commands in `frontend/README.md`, then open `http://127.0.0.1:5173/`.

1. At desktop width and about 320–390 px mobile width, inspect the header, filters, alert cards, and detail/submit panels. Confirm text is readable, controls are usable, and the page has no horizontal scrollbar or clipped content.
2. Use Tab and Shift+Tab to verify visible focus. Open each panel with the keyboard, confirm focus stays inside, close with Escape, and confirm focus returns to the opener.
3. Submit the assessment sample, inspect the new alert and every finding, resolve it, then switch between Active, Resolved, and All filters.
4. Stop the backend and select Refresh. Confirm the header says “Backend unavailable,” the error explains what happened, and previously loaded alerts remain visible.

Record the browser, viewport sizes, findings, and screenshots or video timestamps before marking Day 2 complete.
