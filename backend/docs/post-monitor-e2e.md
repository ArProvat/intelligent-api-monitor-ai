# POST /monitor: developer end-to-end flow

The backend evaluates submitted observations. It does not poll external APIs. Detection is deterministic; OpenRouter only explains findings after they have been stored.

```mermaid
sequenceDiagram
    participant Browser
    participant Controller as Express controller
    participant Rules as Detection service
    participant DB as SQLite model
    participant Worker as In-process worker
    participant LLM as OpenRouter
    Browser->>Controller: POST /monitor (JSON array)
    Controller->>Controller: Check structure and validate each item
    Controller->>Rules: Apply API policy and detect findings
    Rules-->>Controller: Healthy or findings + severity + factual message
    Controller->>DB: One transaction: batch, valid observations, alerts
    DB-->>Controller: Batch ID and indexed results
    Controller-->>Browser: 200 or 422 with initial explanation counts
    Controller->>Worker: Wake for pending alerts
    Worker->>DB: Claim oldest pending alert
    Worker->>LLM: Send identifier, metrics, policy, findings
    alt Valid response
        LLM-->>Worker: Summary and suggested checks
        Worker->>DB: Store generated explanation
    else Timeout, malformed response, or provider error
        Worker->>DB: Mark fallback; retain factual message
    end
    Browser->>Controller: GET /alerts?status=all&batch_id=UUID
    Controller->>DB: Read current alerts
    DB-->>Browser: Pending, generated, fallback, or mock
```

## Request and persistence

`src/app.js` sets a request ID, enforces the 64 KB body limit, and applies the CORS allowlist. `src/controllers/monitorController.js` requires an array of 1–100 observations and validates each item with `src/validation.js`. Invalid items return original zero-based indexes. Accepted items are passed to `src/services/monitorService.js`, which applies server-side policy overrides and calls the pure `detect` function in `src/services/detection.js`. A healthy item creates an observation without an alert. Each anomalous item creates one alert containing all findings and the highest severity.

`src/models/monitorModel.js` writes the batch, accepted observations, and alerts in one SQLite transaction. Each alert receives a factual `fallback_message` before any provider call. In real mode its initial `explanation_status` is `pending`; in `fallback` or `mock` mode it is final immediately. A database failure rolls back the transaction and returns an HTTP error. The POST response reflects the committed initial state, so real-mode `explanations.pending` may be greater than zero.

## Explanation work

`src/services/explanationWorker.js` claims pending rows from SQLite across all batches, oldest first. `LLM_CONCURRENCY` bounds active calls. `src/services/explanation.js` uses the OpenAI SDK against OpenRouter, with `OPENROUTER_MODEL` as the only configured model. It requests structured output, validates content and length locally, and never lets model output change findings, severity, or lifecycle status. A timeout, rate limit, empty result, or malformed result marks the alert `fallback`; the stored factual text remains available throughout. No second LLM model is tried.

The browser can fetch `GET /alerts?status=all&batch_id=UUID` to watch a batch. `GET /alerts/:id` returns the complete current alert. Resolving an alert while its explanation is pending changes only its lifecycle state; the worker can finish the explanation afterward.

## Restart and limits

Migration `002_background_explanations.sql` adds claim and attempt fields. On startup, unclaimed pending alerts are processed. An interrupted claim is retried once; a second interruption becomes `fallback`. Starting in fallback or mock mode marks leftover pending work `fallback`. This is a single-process local worker backed by SQLite, not a multi-process queue. Graceful shutdown waits for active calls within `SHUTDOWN_GRACE_MS`; an abrupt exit leaves pending records visible for startup recovery.

Use `backend/samples/assessment.json` to see one healthy item and one critical alert. Use `LLM_MODE=fallback` for a deterministic demo without a provider call; use `LLM_MODE=openrouter` with a server-side key to see `pending` followed by `generated` or `fallback`.
