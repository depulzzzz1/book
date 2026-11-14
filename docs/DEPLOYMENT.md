# PROJECT LITERA — Deployment & Operations Guide

## 1. AI Studio / Cloud SQL Live Runtime (Port 3000)
1. Configure environment variables (`SQL_HOST`, `SQL_USER`, `SQL_PASSWORD`, `SQL_DB_NAME`, `SQL_ADMIN_USER`, `SQL_ADMIN_PASSWORD`, optional `LITERA_BOOTSTRAP_ADMIN_EMAIL`).
2. Push PostgreSQL schema via Drizzle Kit (`src/db/drizzle.config.ts`).
3. Install dependencies and start server:
   - `npm install`
   - `npm run build`
   - `npm start` (serves Port 3000 with Express API, Vite build, Python 3.10 domain engine, and background publication scheduler).

## 2. Containerized Production Stack (Docker Compose)
Run the full multi-service infrastructure (PostgreSQL 16, Redis 7, RabbitMQ 3, FastAPI + Uvicorn, Celery worker):
```bash
export POSTGRES_PASSWORD="your_strong_secret"
docker compose up --build -d
```

## 3. Verification Commands
- TypeScript strict check: `npm run lint`
- Vitest security, RBAC & API integration tests: `npm test`
- Python domain unit tests: `python3 -m unittest discover -s tests -p "test_*.py"`
- Production bundle build: `npm run build`
