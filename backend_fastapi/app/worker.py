"""Celery Distributed Worker for LITERA Scheduled Publishing & Notifications."""

from __future__ import annotations

import os
from celery import Celery

BROKER_URL = os.getenv("CELERY_BROKER_URL", "amqp://guest:guest@rabbitmq:5672//")
RESULT_BACKEND = os.getenv("REDIS_URL", "redis://redis:6379/0")

celery_app = Celery("litera_worker", broker=BROKER_URL, backend=RESULT_BACKEND)
celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone="UTC",
    enable_utc=True,
    beat_schedule={
        "publish-due-chapters-every-minute": {
            "task": "app.worker.dispatch_due_publications",
            "schedule": 60.0,
        }
    },
)


@celery_app.task(name="app.worker.dispatch_due_publications", bind=True, max_retries=3)
def dispatch_due_publications(self) -> dict[str, str]:
    return {"status": "checked", "worker": self.request.id or "local"}
