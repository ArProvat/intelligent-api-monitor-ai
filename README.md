# Intelligent API Monitoring & Alert System

The backend accepts batches of API observations and stores deterministic anomaly alerts. The React dashboard lets you submit batches, inspect evidence, filter alerts, and resolve them. It evaluates submitted observations; it does not poll external APIs.

## Run locally

Requires Node.js 24 and npm. In two terminals from the repository root:

```powershell
cd backend
npm install
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
$env:LLM_MODE = 'fallback'
$env:DATABASE_PATH = './data/ui-demo.db'
node --env-file=.env src/server.js
```

```powershell
cd frontend
npm install
npm run dev
```

Open `http://127.0.0.1:5173`. The backend listens at `http://127.0.0.1:3000` by default. The Vite server proxies `/monitor`, `/alerts`, and `/health` to the backend. To use another backend port, set `PORT` before starting the backend and `DEV_BACKEND_URL` before starting Vite, for example `http://127.0.0.1:31417`.

The backend `.env.example` allows both `http://127.0.0.1:5173` and `http://localhost:5173`. Keep the exact URL used in your browser in `CORS_ORIGINS`; the Vite proxy forwards its `Origin` header. Restart the backend after changing `.env`.

The demo workflow: submit the assessment sample, inspect the AppointmentAPI alert, resolve it, switch to Resolved, then submit the healthy and mixed-validity samples. Loading a sample only fills the editor. Use fallback mode for routine UI checks; it never calls OpenRouter. With `LLM_MODE=openrouter` and a server-side key, POST returns after saving alerts; the dashboard shows factual fallback text while it checks pending explanations.

## Checks and builds

```powershell
cd backend
npm run typecheck
npm test
npm run build

cd ../frontend
npm test
npm run build
```

The frontend build is in `frontend/dist`. For a production frontend, serve those static files with an API reverse proxy on the same origin or set `VITE_API_BASE_URL` before building. `VITE_*` values are public browser configuration: never put an OpenRouter key there. The backend remains a local assessment demo and needs authentication and deployment controls before public exposure.

See [backend setup and API contract](backend/README.md), [frontend setup and limitations](frontend/README.md), and the [developer request walkthrough](backend/docs/developer-e2e.md).
