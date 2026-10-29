#!/usr/bin/env sh
set -eu

echo "[EquiBudget] Applying PostgreSQL Alembic database migrations..."
alembic upgrade head

echo "[EquiBudget] Starting FastAPI Uvicorn server on 0.0.0.0:8000..."
exec uvicorn app.main:app \
  --host 0.0.0.0 \
  --port 8000 \
  --workers "${EQUIBUDGET_WEB_CONCURRENCY:-2}" \
  --proxy-headers \
  --forwarded-allow-ips="*"
