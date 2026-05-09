from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv


ROOT_DIR = Path(__file__).resolve().parents[1]
load_dotenv(ROOT_DIR / ".env")


def _bool_env(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "y", "on"}


def _int_env(name: str, default: int) -> int:
    value = os.getenv(name)
    if not value:
        return default
    try:
        return int(value)
    except ValueError:
        return default


@dataclass(frozen=True)
class Settings:
    feishu_app_id: str
    feishu_app_secret: str
    feishu_verification_token: str
    feishu_encrypt_key: str
    feishu_domain: str
    openai_api_key: str
    openai_model: str
    openai_reasoning_effort: str
    openai_max_output_tokens: int
    agent_backend: str
    codex_command: str
    codex_workdir: Path
    codex_model: str
    codex_timeout_seconds: int
    bot_name: str
    send_typing_ack: bool


def load_settings() -> Settings:
    return Settings(
        feishu_app_id=os.getenv("FEISHU_APP_ID", "").strip(),
        feishu_app_secret=os.getenv("FEISHU_APP_SECRET", "").strip(),
        feishu_verification_token=os.getenv("FEISHU_VERIFICATION_TOKEN", "").strip(),
        feishu_encrypt_key=os.getenv("FEISHU_ENCRYPT_KEY", "").strip(),
        feishu_domain=os.getenv("FEISHU_DOMAIN", "feishu").strip().lower(),
        openai_api_key=os.getenv("OPENAI_API_KEY", "").strip(),
        openai_model=os.getenv("OPENAI_MODEL", "gpt-5.3-codex").strip(),
        openai_reasoning_effort=os.getenv("OPENAI_REASONING_EFFORT", "medium").strip(),
        openai_max_output_tokens=_int_env("OPENAI_MAX_OUTPUT_TOKENS", 4096),
        agent_backend=os.getenv("AGENT_BACKEND", "openai_responses").strip().lower(),
        codex_command=os.getenv("CODEX_COMMAND", "codex.cmd").strip(),
        codex_workdir=Path(os.getenv("CODEX_WORKDIR", str(ROOT_DIR))).expanduser(),
        codex_model=os.getenv("CODEX_MODEL", os.getenv("OPENAI_MODEL", "gpt-5.3-codex")).strip(),
        codex_timeout_seconds=_int_env("CODEX_TIMEOUT_SECONDS", 900),
        bot_name=os.getenv("BOT_NAME", "Codex").strip() or "Codex",
        send_typing_ack=_bool_env("SEND_TYPING_ACK", True),
    )


def validate_settings(settings: Settings) -> list[str]:
    missing: list[str] = []
    if not settings.feishu_app_id:
        missing.append("FEISHU_APP_ID")
    if not settings.feishu_app_secret:
        missing.append("FEISHU_APP_SECRET")

    if settings.agent_backend == "openai_responses" and not settings.openai_api_key:
        missing.append("OPENAI_API_KEY")
    if settings.agent_backend not in {"openai_responses", "codex_cli"}:
        missing.append("AGENT_BACKEND=openai_responses|codex_cli")
    return missing
