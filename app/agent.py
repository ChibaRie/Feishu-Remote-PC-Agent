from __future__ import annotations

import subprocess
import threading
from dataclasses import dataclass, field
from pathlib import Path

from openai import OpenAI

from app.config import Settings


SYSTEM_PROMPT = """你是部署在飞书里的 Codex Agent。
你帮助团队把需求澄清、代码分析、修复建议、脚本片段和部署步骤变成清晰可执行的结果。
默认用中文回复，除非用户明确要求其他语言。回答要短而有用，涉及代码或命令时给出可直接执行的版本。
如果用户要求你真实修改代码，而当前后端只是 OpenAI Responses API，请说明你可以给方案和补丁思路；
如果后端是 codex_cli，则可以把任务交给本机 Codex CLI 在配置的工作区里执行。
"""


@dataclass
class ConversationStore:
    _lock: threading.Lock = field(default_factory=threading.Lock)
    _previous_response_ids: dict[str, str] = field(default_factory=dict)

    def get(self, key: str) -> str | None:
        with self._lock:
            return self._previous_response_ids.get(key)

    def set(self, key: str, response_id: str) -> None:
        with self._lock:
            self._previous_response_ids[key] = response_id

    def reset(self, key: str) -> None:
        with self._lock:
            self._previous_response_ids.pop(key, None)


class AgentBackend:
    def run(self, prompt: str, conversation_key: str) -> str:
        raise NotImplementedError

    def reset(self, conversation_key: str) -> None:
        return None


class OpenAIResponsesBackend(AgentBackend):
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.client = OpenAI(api_key=settings.openai_api_key)
        self.store = ConversationStore()

    def run(self, prompt: str, conversation_key: str) -> str:
        previous_response_id = self.store.get(conversation_key)
        kwargs = {
            "model": self.settings.openai_model,
            "instructions": SYSTEM_PROMPT,
            "input": prompt,
            "max_output_tokens": self.settings.openai_max_output_tokens,
        }
        if previous_response_id:
            kwargs["previous_response_id"] = previous_response_id
        if self.settings.openai_reasoning_effort:
            kwargs["reasoning"] = {"effort": self.settings.openai_reasoning_effort}

        response = self.client.responses.create(**kwargs)
        if response.id:
            self.store.set(conversation_key, response.id)
        return response.output_text.strip() or "我没有生成可发送的文本结果。"

    def reset(self, conversation_key: str) -> None:
        self.store.reset(conversation_key)


class CodexCliBackend(AgentBackend):
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._lock = threading.Lock()

    def run(self, prompt: str, conversation_key: str) -> str:
        with self._lock:
            command = [
                self.settings.codex_command,
                "exec",
                "--cd",
                str(Path(self.settings.codex_workdir)),
                "--model",
                self.settings.codex_model,
                "--ask-for-approval",
                "never",
                prompt,
            ]
            completed = subprocess.run(
                command,
                cwd=str(self.settings.codex_workdir),
                capture_output=True,
                text=True,
                timeout=self.settings.codex_timeout_seconds,
                check=False,
            )

        output = "\n".join(part.strip() for part in (completed.stdout, completed.stderr) if part.strip())
        if completed.returncode != 0:
            return f"Codex CLI 执行失败，退出码 {completed.returncode}。\n\n{output or '没有输出。'}"
        return output or "Codex CLI 已执行完成，但没有返回文本输出。"


def build_agent(settings: Settings) -> AgentBackend:
    if settings.agent_backend == "codex_cli":
        return CodexCliBackend(settings)
    return OpenAIResponsesBackend(settings)
