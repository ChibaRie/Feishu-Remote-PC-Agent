import {
  createLarkChannel,
  Domain,
  LoggerLevel,
  type LarkChannel,
  type NormalizedMessage,
  type SendResult,
} from "@larksuiteoapi/node-sdk";
import type { AppConfig, GatewayMessage, GatewayStatus } from "./types.js";
import { MessageQueue } from "./messageQueue.js";
import { splitText } from "./text.js";

export type ClaudeChannelNotifier = (message: GatewayMessage) => Promise<void>;

export class FeishuGateway {
  private readonly channel: LarkChannel;
  private readonly status: GatewayStatus = { connected: false };

  constructor(
    private readonly config: AppConfig,
    private readonly queue: MessageQueue,
    private readonly notifyClaude: ClaudeChannelNotifier,
  ) {
    this.channel = createLarkChannel({
      appId: config.feishuAppId,
      appSecret: config.feishuAppSecret,
      transport: "websocket",
      domain: config.feishuDomain === "lark" ? Domain.Lark : Domain.Feishu,
      loggerLevel: LoggerLevel.warn,
      logger: {
        error: (...message: unknown[]) => console.error("[lark:error]", ...message),
        warn: (...message: unknown[]) => console.error("[lark:warn]", ...message),
        info: (...message: unknown[]) => console.error("[lark:info]", ...message),
        debug: (...message: unknown[]) => console.error("[lark:debug]", ...message),
        trace: (...message: unknown[]) => console.error("[lark:trace]", ...message),
      },
      safety: {
        dedup: { ttl: 3600 },
        chatQueue: { enabled: true },
      },
    });
  }

  async start(): Promise<void> {
    this.channel.on("message", (message) => {
      void this.handleMessage(message).catch((error: unknown) => {
        this.recordError(error);
      });
    });
    this.channel.on("error", (error) => {
      this.recordError(error);
    });
    this.channel.on("reconnecting", () => {
      this.status.connected = false;
      console.error("[lark] reconnecting");
    });
    this.channel.on("reconnected", () => {
      this.status.connected = true;
      console.error("[lark] reconnected");
    });

    await this.channel.connect();
    this.status.connected = true;
    this.status.startedAt = new Date().toISOString();
    console.error("[lark] connected and waiting for messages");
  }

  getStatus(): GatewayStatus {
    return { ...this.status };
  }

  async reply(messageId: string, text: string): Promise<SendResult[]> {
    const original = this.queue.get(messageId);
    if (!original) throw new Error(`Message not found: ${messageId}`);

    const results: SendResult[] = [];
    for (const chunk of splitText(text, this.config.textChunkLimit)) {
      results.push(
        await this.channel.send(
          original.chatId,
          { text: chunk },
          { replyTo: original.messageId },
        ),
      );
    }
    return results;
  }

  async send(chatId: string, text: string): Promise<SendResult[]> {
    const results: SendResult[] = [];
    for (const chunk of splitText(text, this.config.textChunkLimit)) {
      results.push(await this.channel.send(chatId, { text: chunk }));
    }
    return results;
  }

  private async handleMessage(message: NormalizedMessage): Promise<void> {
    this.status.lastMessageAt = new Date().toISOString();

    if (!this.shouldAccept(message)) return;

    if (message.rawContentType !== "text") {
      await this.channel.send(
        message.chatId,
        { text: "目前只支持文本消息。请把任务或问题用文字发送给我。" },
        { replyTo: message.messageId },
      );
      return;
    }

    const text = message.content.trim();
    if (!text) return;

    const queued = this.queue.enqueue({
      messageId: message.messageId,
      chatId: message.chatId,
      chatType: message.chatType,
      senderId: message.senderId,
      senderName: message.senderName,
      text,
      rawContentType: message.rawContentType,
      mentionedBot: message.mentionedBot,
      mentionAll: message.mentionAll,
      createTime: message.createTime,
      resources: message.resources,
      replyToMessageId: message.replyToMessageId,
      threadId: message.threadId,
    });

    if (!queued) return;

    if (this.config.sendTypingAck) {
      await this.channel.send(
        queued.chatId,
        { text: `${this.config.botName} 已收到，正在交给 Claude Code。` },
        { replyTo: queued.messageId },
      );
    }

    await this.notifyClaude(queued);
  }

  private shouldAccept(message: NormalizedMessage): boolean {
    if (
      this.config.allowedUserIds.length > 0 &&
      !this.config.allowedUserIds.includes(message.senderId)
    ) {
      return false;
    }

    if (
      message.chatType === "group" &&
      this.config.requireMentionInGroup &&
      !message.mentionedBot
    ) {
      return false;
    }

    return true;
  }

  private recordError(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.status.lastError = message;
    this.status.connected = false;
    console.error("[lark] error:", message);
  }
}
