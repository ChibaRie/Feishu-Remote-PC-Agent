from __future__ import annotations

import logging
import threading
import time
import traceback
from dataclasses import dataclass, field

import lark_oapi as lark
from lark_oapi.api.im.v1 import CreateMessageRequest, CreateMessageRequestBody

from app.agent import AgentBackend
from app.config import Settings
from app.message_utils import extract_text_content, get_nested, split_message, to_feishu_text


LOGGER = logging.getLogger(__name__)


@dataclass
class SeenMessages:
    ttl_seconds: int = 3600
    _lock: threading.Lock = field(default_factory=threading.Lock)
    _items: dict[str, float] = field(default_factory=dict)

    def add_once(self, message_id: str) -> bool:
        now = time.time()
        with self._lock:
            expired = [key for key, ts in self._items.items() if now - ts > self.ttl_seconds]
            for key in expired:
                self._items.pop(key, None)
            if message_id in self._items:
                return False
            self._items[message_id] = now
            return True


class FeishuCodexBot:
    def __init__(self, settings: Settings, agent: AgentBackend) -> None:
        self.settings = settings
        self.agent = agent
        self.seen_messages = SeenMessages()
        self.client = self._build_client()

    def _build_client(self) -> lark.Client:
        builder = (
            lark.Client.builder()
            .app_id(self.settings.feishu_app_id)
            .app_secret(self.settings.feishu_app_secret)
            .log_level(lark.LogLevel.INFO)
        )
        if self.settings.feishu_domain == "lark":
            builder = builder.domain(lark.LARK_DOMAIN)
        else:
            builder = builder.domain(lark.FEISHU_DOMAIN)
        return builder.build()

    def start(self) -> None:
        event_handler = (
            lark.EventDispatcherHandler.builder(
                self.settings.feishu_encrypt_key,
                self.settings.feishu_verification_token,
            )
            .register_p2_im_message_receive_v1(self._on_message)
            .build()
        )
        ws_client = lark.ws.Client(
            self.settings.feishu_app_id,
            self.settings.feishu_app_secret,
            event_handler=event_handler,
            log_level=lark.LogLevel.INFO,
        )
        LOGGER.info("Starting Feishu long-connection bot with backend=%s", self.settings.agent_backend)
        ws_client.start()

    def _on_message(self, data: lark.im.v1.P2ImMessageReceiveV1) -> None:
        event = data.event
        message = event.message
        message_id = getattr(message, "message_id", "")
        if message_id and not self.seen_messages.add_once(message_id):
            LOGGER.info("Skip duplicated message_id=%s", message_id)
            return

        msg_type = getattr(message, "message_type", "")
        chat_id = getattr(message, "chat_id", "")
        sender_open_id = get_nested(event, "sender", "sender_id", "open_id") or "unknown"

        if not chat_id:
            LOGGER.warning("Received message without chat_id: %s", lark.JSON.marshal(data))
            return
        if msg_type != "text":
            self.send_text(chat_id, "我现在先支持文本消息。请把任务或问题用文字发给我。")
            return

        prompt = extract_text_content(getattr(message, "content", ""))
        if not prompt:
            return

        conversation_key = f"{chat_id}:{sender_open_id}"
        if prompt.lower() in {"/reset", "reset", "重置", "清空上下文"}:
            self.agent.reset(conversation_key)
            self.send_text(chat_id, "已清空这段飞书会话里的 Codex 上下文。")
            return

        if self.settings.send_typing_ack:
            self.send_text(chat_id, f"{self.settings.bot_name} 收到，正在处理。")

        worker = threading.Thread(
            target=self._handle_prompt,
            args=(chat_id, conversation_key, prompt),
            daemon=True,
        )
        worker.start()

    def _handle_prompt(self, chat_id: str, conversation_key: str, prompt: str) -> None:
        try:
            answer = self.agent.run(prompt, conversation_key)
        except Exception as exc:  # noqa: BLE001
            LOGGER.error("Agent failed: %s\n%s", exc, traceback.format_exc())
            answer = f"处理失败：{exc}"
        self.send_text(chat_id, answer)

    def send_text(self, chat_id: str, text: str) -> None:
        for chunk in split_message(text):
            request = (
                CreateMessageRequest.builder()
                .receive_id_type("chat_id")
                .request_body(
                    CreateMessageRequestBody.builder()
                    .receive_id(chat_id)
                    .msg_type("text")
                    .content(to_feishu_text(chunk))
                    .build()
                )
                .build()
            )
            response = self.client.im.v1.message.create(request)
            if not response.success():
                LOGGER.error("Send Feishu message failed: code=%s msg=%s", response.code, response.msg)
