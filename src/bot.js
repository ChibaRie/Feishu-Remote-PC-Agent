"use strict";

const { LarkChannel, Domain } = require("@larksuiteoapi/node-sdk");

const MAX_TEXT_LEN = 3800;

const RESET_COMMANDS = new Set(["/reset", "reset", "重置", "清空上下文"]);

class FeishuCodexBot {
  constructor(config, agent) {
    this.config = config;
    this.agent = agent;
    this._locks = new Map();
    this.channel = new LarkChannel({
      appId: config.feishuAppId,
      appSecret: config.feishuAppSecret,
      transport: "websocket",
      domain: config.feishuDomain === "lark" ? Domain.Lark : Domain.Feishu,
      safety: {
        dedup: { ttl: 3600 },
        chatQueue: { enabled: true },
      },
    });
  }

  async start() {
    this.channel.on("message", (msg) => this._onMessage(msg));
    this.channel.on("error", (err) => console.error("[bot] channel error:", err));

    console.log(`[bot] Starting Feishu long-connection bot (model=${this.config.deepseekModel})...`);
    await this.channel.connect();
    console.log("[bot] Connected. Waiting for messages...");
  }

  async _onMessage(msg) {
    const { messageId, chatId, senderId, content, rawContentType } = msg;

    // Only handle text messages
    if (rawContentType !== "text") {
      await this._sendText(chatId, "我现在先支持文本消息。请把任务或问题用文字发给我。");
      return;
    }

    const prompt = (content || "").trim();
    if (!prompt) return;

    const conversationKey = `${chatId}:${senderId}`;

    // Check for reset command
    if (RESET_COMMANDS.has(prompt.toLowerCase())) {
      this.agent.reset(conversationKey);
      await this._sendText(chatId, "已清空这段飞书会话里的 Codex 上下文。");
      return;
    }

    if (this.config.sendTypingAck) {
      await this._sendText(chatId, `${this.config.botName} 收到，正在处理。`);
    }

    // Process in background (not awaiting — fire and respond when ready)
    this._handlePrompt(chatId, conversationKey, prompt);
  }

  async _handlePrompt(chatId, conversationKey, prompt) {
    // Serialize per-conversation to prevent concurrent mutations
    while (this._locks.get(conversationKey)) {
      await this._locks.get(conversationKey);
    }
    let resolveLock;
    const lockPromise = new Promise((r) => (resolveLock = r));
    const prevLock = this._locks.get(conversationKey);
    this._locks.set(conversationKey, (prevLock || Promise.resolve()).then(() => lockPromise));

    try {
      const answer = await this.agent.run(prompt, conversationKey);
      await this._sendText(chatId, answer);
    } catch (err) {
      console.error(`[bot] agent error for chat=${chatId}:`, err.message);
      await this._sendText(chatId, `处理失败：${err.message}`);
    } finally {
      resolveLock();
    }
  }

  async _sendText(chatId, text) {
    for (const chunk of this._splitText(text)) {
      try {
        await this.channel.send(chatId, { text: chunk });
      } catch (err) {
        console.error(`[bot] send error to chat=${chatId}:`, err.message);
      }
    }
  }

  _splitText(text) {
    if (text.length <= MAX_TEXT_LEN) return [text];
    const chunks = [];
    let remaining = text;
    while (remaining) {
      if (remaining.length <= MAX_TEXT_LEN) {
        chunks.push(remaining);
        break;
      }
      let cut = remaining.lastIndexOf("\n", MAX_TEXT_LEN);
      if (cut < MAX_TEXT_LEN / 2) cut = MAX_TEXT_LEN;
      chunks.push(remaining.slice(0, cut).trim());
      remaining = remaining.slice(cut).trim();
    }
    return chunks;
  }
}

module.exports = { FeishuCodexBot };
