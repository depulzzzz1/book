#!/usr/bin/env python3
"""
PROJECT LITERA — PYTHON COMPUTATIONAL & EDITORIAL DOMAIN ENGINE
Python 3.10+ zero-dependency standard library runtime for:
1. Editorial Rich-Text HTML Sanitization & Security Verification
2. Literary Readability, Lexical Diversity & Word-Count Telemetry
3. Deterministic Unified Revision Diffing (chapter_versions)
4. Content-Based & Popularity-Weighted Novel Recommendation Scoring
"""

from __future__ import annotations

import difflib
import hashlib
import html
import html.parser
import json
import math
import re
import sys
from typing import Any, Dict, List, Set, Tuple


ALLOWED_TAGS: Set[str] = {
    "p",
    "br",
    "em",
    "i",
    "strong",
    "b",
    "blockquote",
    "h2",
    "h3",
    "ul",
    "ol",
    "li",
    "hr",
    "sup",
    "sub",
}
VOID_TAGS: Set[str] = {"br", "hr"}
STRIP_CONTENT_TAGS: Set[str] = {"script", "style", "iframe", "object", "embed", "svg"}


class EditorialHtmlSanitizer(html.parser.HTMLParser):
    """Strict allowlist HTML sanitizer preventing XSS while preserving literary markup."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=False)
        self.output: List[str] = []
        self.skip_depth: int = 0
        self.stripped_elements: List[str] = []

    def handle_starttag(self, tag: str, attrs: List[Tuple[str, str | None]]) -> None:
        tag_l = tag.lower()
        if tag_l in STRIP_CONTENT_TAGS:
            self.skip_depth += 1
            self.stripped_elements.append(tag_l)
            return
        if self.skip_depth > 0:
            return
        if tag_l in ALLOWED_TAGS:
            if tag_l in VOID_TAGS:
                self.output.append(f"<{tag_l} />")
            else:
                self.output.append(f"<{tag_l}>")
        else:
            self.stripped_elements.append(tag_l)

    def handle_endtag(self, tag: str) -> None:
        tag_l = tag.lower()
        if tag_l in STRIP_CONTENT_TAGS:
            if self.skip_depth > 0:
                self.skip_depth -= 1
            return
        if self.skip_depth > 0:
            return
        if tag_l in ALLOWED_TAGS and tag_l not in VOID_TAGS:
            self.output.append(f"</{tag_l}>")

    def handle_data(self, data: str) -> None:
        if self.skip_depth == 0:
            self.output.append(html.escape(data, quote=False))

    def handle_entityref(self, name: str) -> None:
        if self.skip_depth == 0:
            self.output.append(f"&{name};")

    def handle_charref(self, name: str) -> None:
        if self.skip_depth == 0:
            self.output.append(f"&#{name};")


def sanitize_editorial_html(raw_html: str) -> Dict[str, Any]:
    parser = EditorialHtmlSanitizer()
    parser.feed(raw_html or "")
    parser.close()
    sanitized = "".join(parser.output).strip()
    if not sanitized and raw_html and raw_html.strip():
        plain = re.sub(r"<[^>]+>", " ", raw_html).strip()
        if plain:
            sanitized = f"<p>{html.escape(plain)}</p>"
    plain_text = html.unescape(re.sub(r"<[^>]+>", " ", sanitized))
    plain_text = re.sub(r"\s+", " ", plain_text).strip()
    words = [w for w in re.split(r"\s+", plain_text) if w]
    word_count = len(words)
    reading_minutes = max(1, math.ceil(word_count / 225))
    excerpt = plain_text[:220] + ("..." if len(plain_text) > 220 else "")
    checksum = hashlib.sha256(sanitized.encode("utf-8")).hexdigest()
    return {
        "sanitized_html": sanitized,
        "plain_excerpt": excerpt,
        "word_count": word_count,
        "reading_minutes": reading_minutes,
        "checksum_sha256": checksum,
        "stripped_tags": sorted(set(parser.stripped_elements)),
    }


def analyze_readability(text_or_html: str) -> Dict[str, Any]:
    plain = html.unescape(re.sub(r"<[^>]+>", " ", text_or_html or ""))
    plain = re.sub(r"\s+", " ", plain).strip()
    words = [w for w in re.findall(r"[A-Za-z0-9'\-]+", plain)]
    sentences = [s for s in re.split(r"[.!?]+", plain) if s.strip()]
    word_count = len(words)
    sentence_count = max(1, len(sentences))
    unique_words = len({w.lower() for w in words})
    lexical_diversity = round(unique_words / max(1, word_count), 3)
    avg_sentence_len = round(word_count / sentence_count, 1)
    syllables = sum(max(1, len(re.findall(r"[aeiouy]+", w.lower()))) for w in words)
    flesch_kincaid = 0.0
    if word_count > 0:
        flesch_kincaid = round(
            206.835 - 1.015 * (word_count / sentence_count) - 84.6 * (syllables / word_count),
            1,
        )
    return {
        "word_count": word_count,
        "sentence_count": sentence_count,
        "avg_sentence_length": avg_sentence_len,
        "lexical_diversity": lexical_diversity,
        "reading_ease_score": max(0.0, min(100.0, flesch_kincaid)),
        "estimated_minutes": max(1, math.ceil(word_count / 225)),
    }


def compute_revision_diff(old_html: str, new_html: str) -> Dict[str, Any]:
    def to_lines(content: str) -> List[str]:
        text = re.sub(r"</(p|h2|h3|blockquote|li)>", "\n", content or "")
        text = re.sub(r"<br\s*/?>", "\n", text)
        text = html.unescape(re.sub(r"<[^>]+>", "", text))
        return [line.strip() for line in text.splitlines() if line.strip()]

    old_lines = to_lines(old_html)
    new_lines = to_lines(new_html)
    diff_lines = list(
        difflib.unified_diff(old_lines, new_lines, fromfile="previous_revision", tofile="current_revision", lineterm="")
    )
    added = sum(1 for ln in diff_lines if ln.startswith("+") and not ln.startswith("+++"))
    removed = sum(1 for ln in diff_lines if ln.startswith("-") and not ln.startswith("---"))
    return {
        "added_paragraphs": added,
        "removed_paragraphs": removed,
        "unified_diff": diff_lines,
        "changed": len(diff_lines) > 0,
    }


def recommend_novels(payload: Dict[str, Any]) -> Dict[str, Any]:
    target_genres = set(payload.get("target_genres", []))
    target_id = str(payload.get("target_novel_id", ""))
    candidates: List[Dict[str, Any]] = payload.get("candidates", [])
    scored: List[Tuple[float, Dict[str, Any]]] = []

    for item in candidates:
        if str(item.get("id", "")) == target_id:
            continue
        item_genres = set(item.get("genres", []))
        overlap = len(target_genres & item_genres)
        union = max(1, len(target_genres | item_genres))
        jaccard = overlap / union
        rating_score = float(item.get("avg_rating", 0)) / 5.0
        popularity_score = min(1.0, math.log1p(float(item.get("view_count", 0))) / 10.0)
        composite = round(0.55 * jaccard + 0.30 * rating_score + 0.15 * popularity_score, 4)
        scored.append((composite, {**item, "recommendation_score": composite}))

    scored.sort(key=lambda pair: pair[0], reverse=True)
    limit = int(payload.get("limit", 4))
    return {"recommendations": [pair[1] for pair in scored[:limit]]}


def main() -> None:
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Missing command"}))
        sys.exit(1)

    cmd = sys.argv[1]
    raw_input = sys.stdin.read() if len(sys.argv) < 3 else sys.argv[2]
    try:
        payload = json.loads(raw_input) if raw_input.strip() else {}
    except Exception:
        payload = {}

    if cmd == "sanitize_html":
        print(json.dumps(sanitize_editorial_html(str(payload.get("html", "")))))
    elif cmd == "analyze_readability":
        print(json.dumps(analyze_readability(str(payload.get("content", "")))))
    elif cmd == "diff_revisions":
        print(json.dumps(compute_revision_diff(str(payload.get("old_html", "")), str(payload.get("new_html", "")))))
    elif cmd == "recommend_novels":
        print(json.dumps(recommend_novels(payload)))
    else:
        print(json.dumps({"error": f"Unknown command: {cmd}"}))
        sys.exit(1)


if __name__ == "__main__":
    main()
