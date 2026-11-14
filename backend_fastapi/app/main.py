"""PROJECT LITERA — FastAPI Production Application Entrypoint."""

from __future__ import annotations

import os
from typing import List, Optional
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.models import Novel

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql+asyncpg://litera_app:change_me@localhost:5432/litera",
)

engine = create_async_engine(DATABASE_URL, pool_pre_ping=True, pool_size=10, max_overflow=20)
AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)

app = FastAPI(
    title="LITERA Digital Literature API",
    version="1.0.0",
    description="Enterprise FastAPI backend for LITERA digital library, reading engine, author studio, and moderation.",
)


class NovelResponse(BaseModel):
    id: str
    title: str
    slug: str
    synopsis: str
    status: str
    total_words: int = Field(ge=0)
    avg_rating: float = Field(ge=0.0, le=5.0)

    model_config = {"from_attributes": True}


@app.get("/api/health")
async def health_check() -> dict[str, str]:
    return {"status": "ok", "service": "litera-fastapi"}


@app.get("/api/novels", response_model=List[NovelResponse])
async def list_published_novels(q: Optional[str] = None) -> List[Novel]:
    async with AsyncSessionLocal() as session:
        stmt = select(Novel).where(Novel.status == "PUBLISHED")
        if q:
            stmt = stmt.where(Novel.title.ilike(f"%{q}%"))
        result = await session.execute(stmt)
        return list(result.scalars().all())


@app.get("/api/novels/{slug}", response_model=NovelResponse)
async def get_published_novel(slug: str) -> Novel:
    async with AsyncSessionLocal() as session:
        stmt = select(Novel).where(Novel.slug == slug, Novel.status == "PUBLISHED")
        result = await session.execute(stmt)
        novel = result.scalar_one_or_none()
        if not novel:
            raise HTTPException(status_code=404, detail="Novel not found")
        return novel
