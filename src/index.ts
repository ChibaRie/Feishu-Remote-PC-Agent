#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig, validateConfig } from "./config.js";
import { FeishuGateway } from "./feishuGateway.js";
import { createMcpServer } from "./mcpServer.js";
import { MessageQueue } from "./messageQueue.js";
import type { GatewayMessage } from "./types.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const missing = validateConfig(config);
  if (missing.length > 0) {
    console.error(`Missing required configuration: ${missing.join(", ")}`);
    console.error("Copy .env.example to .env and fill in your Feishu/Lark app credentials.");
    process.exit(2);
  }

  const queue = new MessageQueue(config.maxQueueSize);
  let mcpServer: ReturnType<typeof createMcpServer>;

  const gateway = new FeishuGateway(config, queue, async (message) => {
    await notifyClaudeChannel(config.enableClaudeChannelNotifications, mcpServer, message);
  });
  mcpServer = createMcpServer(config, queue, gateway);

  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);
  console.error("[mcp] claudecode_lark_mcp running on stdio");

  await gateway.start();
}

async function notifyClaudeChannel(
  enabled: boolean,
  mcpServer: ReturnType<typeof createMcpServer>,
  message: GatewayMessage,
): Promise<void> {
  if (!enabled) return;

  const content = [
    `<channel source="feishu" message_id="${escapeXml(message.messageId)}" chat_id="${escapeXml(message.chatId)}">`,
    message.text,
    "</channel>",
  ].join("\n");

  try {
    await mcpServer.server.notification({
      method: "notifications/claude/channel",
      params: {
        content,
        meta: {
          source: "feishu",
          message_id: message.messageId,
          chat_id: message.chatId,
          chat_type: message.chatType,
          sender_id: message.senderId,
          sender_name: message.senderName,
          received_at: message.receivedAt,
        },
      },
    } as never);
  } catch (error) {
    console.error(
      "[mcp] failed to send Claude channel notification:",
      error instanceof Error ? error.message : String(error),
    );
  }
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

main().catch((error: unknown) => {
  console.error("[fatal]", error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
