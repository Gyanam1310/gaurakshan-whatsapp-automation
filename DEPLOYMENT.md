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
- backend-logs volume: backend access logs
- n8n-data volume: n8n database/workflows/credentials

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

Security Notes
- Keep service-account.json and .env out of version control.
- Rotate credentials if previously exposed.
