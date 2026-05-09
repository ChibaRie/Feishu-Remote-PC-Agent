from __future__ import annotations

import json
import re
from typing import Any


AT_TAG_RE = re.compile(r"<at\b[^>]*>.*?</at>", re.IGNORECASE)


def extract_text_content(content: str | None) -> str:
    if not content:
        return ""
    try:
        payload = json.loads(content)
    except json.JSONDecodeError:
        return content.strip()

    text = payload.get("text") if isinstance(payload, dict) else None
    if not isinstance(text, str):
        return ""

    text = AT_TAG_RE.sub("", text)
    text = text.replace("\u200b", "")
    return text.strip()


def to_feishu_text(text: str) -> str:
    return json.dumps({"text": text}, ensure_ascii=False)


def get_nested(obj: Any, *names: str) -> Any:
    current = obj
    for name in names:
        if current is None:
            return None
        if isinstance(current, dict):
            current = current.get(name)
        else:
            current = getattr(current, name, None)
    return current


def split_message(text: str, limit: int = 3800) -> list[str]:
    if len(text) <= limit:
        return [text]

    chunks: list[str] = []
    remaining = text
    while remaining:
        if len(remaining) <= limit:
            chunks.append(remaining)
            break

        cut = remaining.rfind("\n", 0, limit)
        if cut < limit // 2:
            cut = limit
        chunks.append(remaining[:cut].strip())
        remaining = remaining[cut:].strip()
    return chunks
