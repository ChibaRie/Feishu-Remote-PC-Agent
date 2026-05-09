from __future__ import annotations

import logging
import sys

from app.agent import build_agent
from app.bot import FeishuCodexBot
from app.config import load_settings, validate_settings


def main() -> int:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s - %(message)s",
    )
    settings = load_settings()
    missing = validate_settings(settings)
    if missing:
        print("缺少或非法配置：")
        for item in missing:
            print(f"- {item}")
        print("\n请复制 .env.example 为 .env 后填入真实凭据。")
        return 2

    agent = build_agent(settings)
    bot = FeishuCodexBot(settings, agent)
    bot.start()
    return 0


if __name__ == "__main__":
    sys.exit(main())
