FROM python:3.11-slim AS backend-base

WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

RUN pip install --no-cache-dir \
    fastapi==0.115.0 \
    uvicorn[standard]==0.32.0 \
    pydantic==2.9.2 \
    sqlalchemy[asyncio]==2.0.36 \
    asyncpg==0.30.0 \
    alembic==1.14.0 \
    argon2-cffi==23.1.0 \
    celery==5.4.0 \
    redis==5.2.0 \
    boto3==1.35.0 \
    opentelemetry-api==1.28.0 \
    opentelemetry-sdk==1.28.0 \
    pytest==8.3.3

COPY backend_fastapi /app
COPY litera_core /app/litera_core

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
