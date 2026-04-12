Production Docker Deployment

Prerequisites
- Docker Desktop (or Docker Engine + Compose plugin)
- service-account.json present at repository root (or set GOOGLE_CREDENTIALS_FILE to another path)

Quick Start
1. Copy .env.example to .env if needed and set your real values.
2. Start everything:
   docker compose up -d
3. Open services:
   - Frontend: http://localhost:8080
   - Backend health: http://localhost:5000/healthz
   - n8n: http://localhost:5678

Stop
- docker compose down

Persistent Data
- backend-session volume: WhatsApp Baileys auth/session
- backend-uploads volume: uploaded image temp files
- backend-logs volume: backend Winston logs (combined + error + access)
- n8n-data volume: n8n database/workflows/credentials
- redis-data volume: Redis append-only queue persistence

Environment Management
- Compose loads environment from `.env` (see `.env.example`).
- Keep `.env` and service-account.json out of version control.
- Important toggles:
   - `QUEUE_ENABLED=false` keeps current direct-send behavior (default).
   - `QUEUE_ENABLED=true` prepares queue-first mode (requires BullMQ worker rollout).
   - `LOG_LEVEL`, `LOG_MAX_SIZE_MB`, `LOG_MAX_FILES` control backend logging.

Networking Model
- Frontend calls /api/* and nginx proxies to backend:5000 on Docker network.
- n8n calls backend using http://backend:5000 (never localhost inside container).

n8n HTTP Node Settings
- URL:
  {{$env.BACKEND_BASE_URL}}/send-message
- Method: POST
- Body Content-Type: JSON
- Required fields: groupId, message (or formattedMessage), optional imageUrl, donationDate, id

Operational Checks
- docker compose ps
- docker compose logs -f backend
- docker compose logs -f n8n
- docker compose logs -f redis

Security Notes
- Keep service-account.json and .env out of version control.
- Rotate credentials if previously exposed.

BullMQ + Redis Rollout Suggestion (safe staged plan)
1. Keep `QUEUE_ENABLED=false` and deploy this stack first.
2. Add BullMQ producer/worker in backend as a separate release.
3. Run worker as its own service and verify idempotency before enabling queue-first mode.
4. Turn `QUEUE_ENABLED=true` only after worker health checks and alerting are in place.
5. See `backend/src/queue/README.md` for producer/worker examples.
