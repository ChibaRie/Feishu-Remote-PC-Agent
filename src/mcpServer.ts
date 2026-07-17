import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { FeishuGateway } from "./feishuGateway.js";
import type { AppConfig, GatewayMessage, MessageStatus } from "./types.js";
import { MessageQueue } from "./messageQueue.js";
import { asJsonText } from "./text.js";

const ResponseFormatSchema = z.enum(["markdown", "json"]).default("markdown");
const MessageStatusSchema = z.enum(["pending", "processing", "replied", "ignored", "error"]);

function messageSummary(message: GatewayMessage): Record<string, unknown> {
  return {
    message_id: message.messageId,
    chat_id: message.chatId,
    chat_type: message.chatType,
    sender_id: message.senderId,
    sender_name: message.senderName,
    text: message.text,
    status: message.status,
    received_at: message.receivedAt,
    create_time: message.createTime,
    mentioned_bot: message.mentionedBot,
    resources: message.resources,
    thread_id: message.threadId,
    reply_to_message_id: message.replyToMessageId,
    note: message.note,
  };
}

function formatMessages(messages: GatewayMessage[], total: number, hasMore: boolean): string {
  if (messages.length === 0) return "No matching Feishu/Lark messages.";
  const lines = [
    `# Feishu/Lark messages`,
    "",
    `Showing ${messages.length} of ${total}${hasMore ? " (more available)" : ""}.`,
    "",
  ];

  for (const message of messages) {
    lines.push(`## ${message.messageId}`);
    lines.push(`- Chat: ${message.chatId} (${message.chatType})`);
    lines.push(`- Sender: ${message.senderName ?? message.senderId}`);
    lines.push(`- Status: ${message.status}`);
    lines.push(`- Received: ${message.receivedAt}`);
    lines.push("");
    lines.push(message.text);
    lines.push("");
  }

  return lines.join("\n");
}

export function createMcpServer(
  config: AppConfig,
  queue: MessageQueue,
  gateway: FeishuGateway,
): McpServer {
  const server = new McpServer({
    name: "claudecode-lark-mcp-server",
    version: "1.0.0",
  });

  server.registerTool(
    "lark_fetch_messages",
    {
      title: "Fetch Feishu/Lark Messages",
      description:
        "Fetch messages received from the configured Feishu/Lark bot. Use this when Claude Code needs to read pending user requests from Feishu. By default, fetched pending messages are marked as processing.",
      inputSchema: z
        .object({
          limit: z.number().int().min(1).max(50).default(5).describe("Maximum messages to return."),
          offset: z.number().int().min(0).default(0).describe("Pagination offset."),
          statuses: z
            .array(MessageStatusSchema)
            .default(["pending"])
            .describe("Message statuses to include."),
          mark_as_processing: z
            .boolean()
            .default(true)
            .describe("Mark fetched pending messages as processing."),
          response_format: ResponseFormatSchema.describe("Output format."),
        })
        .strict(),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (params) => {
      const result = queue.list({
        limit: params.limit,
        offset: params.offset,
        statuses: params.statuses as MessageStatus[],
      });

      if (params.mark_as_processing) {
        for (const item of result.items) {
          if (item.status === "pending") queue.mark(item.messageId, "processing");
        }
      }

      const output = {
        total: result.total,
        count: result.items.length,
        offset: params.offset,
        has_more: result.hasMore,
        next_offset: result.nextOffset,
        messages: result.items.map(messageSummary),
      };

      return {
        content: [
          {
            type: "text",
            text:
              params.response_format === "json"
                ? asJsonText(output)
                : formatMessages(result.items, result.total, result.hasMore),
          },
        ],
        structuredContent: output,
      };
    },
  );

  server.registerTool(
    "lark_reply_message",
    {
      title: "Reply To Feishu/Lark Message",
      description:
        "Reply to a Feishu/Lark message that was previously received by this MCP gateway. Use message_id from lark_fetch_messages. Long replies are split automatically.",
      inputSchema: z
        .object({
          message_id: z.string().min(1).describe("The Feishu/Lark message ID to reply to."),
          text: z.string().min(1).max(50000).describe("Reply text to send."),
          mark_done: z.boolean().default(true).describe("Mark the source message as replied after sending."),
        })
        .strict(),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (params) => {
      try {
        const results = await gateway.reply(params.message_id, params.text);
        if (params.mark_done) queue.mark(params.message_id, "replied");
        const output = {
          message_id: params.message_id,
          chunks_sent: results.length,
          sent_message_ids: results.map((result) => result.messageId),
        };
        return {
          content: [{ type: "text", text: asJsonText(output) }],
          structuredContent: output,
        };
      } catch (error) {
        if (queue.get(params.message_id)) {
          queue.mark(params.message_id, "error", error instanceof Error ? error.message : String(error));
        }
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Failed to reply to Feishu/Lark message: ${
                error instanceof Error ? error.message : String(error)
              }`,
            },
          ],
        };
      }
    },
  );

  server.registerTool(
    "lark_send_message",
    {
      title: "Send Feishu/Lark Message",
      description:
        "Send a new text message to a Feishu/Lark chat by chat_id. Prefer lark_reply_message when answering a received message.",
      inputSchema: z
        .object({
          chat_id: z.string().min(1).describe("Feishu/Lark chat ID."),
          text: z.string().min(1).max(50000).describe("Text to send."),
        })
        .strict(),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (params) => {
      const results = await gateway.send(params.chat_id, params.text);
      const output = {
        chat_id: params.chat_id,
        chunks_sent: results.length,
        sent_message_ids: results.map((result) => result.messageId),
      };
      return {
        content: [{ type: "text", text: asJsonText(output) }],
        structuredContent: output,
      };
    },
  );

  server.registerTool(
    "lark_mark_message",
    {
      title: "Mark Feishu/Lark Message",
      description:
        "Update local processing status for a Feishu/Lark message in the gateway queue. This does not modify the original Feishu/Lark message.",
      inputSchema: z
        .object({
          message_id: z.string().min(1).describe("Message ID to update."),
          status: MessageStatusSchema.describe("New local processing status."),
          note: z.string().max(1000).optional().describe("Optional note for local diagnostics."),
        })
        .strict(),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params) => {
      const item = queue.mark(params.message_id, params.status as MessageStatus, params.note);
      const output = messageSummary(item);
      return {
        content: [{ type: "text", text: asJsonText(output) }],
        structuredContent: output,
      };
    },
  );

  server.registerTool(
    "lark_get_status",
    {
      title: "Get Feishu/Lark Gateway Status",
      description:
        "Get current Feishu/Lark WebSocket connection status and local message queue counts.",
      inputSchema: z.object({ response_format: ResponseFormatSchema.describe("Output format.") }).strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params) => {
      const output = {
        project: "claudecode_lark_mcp",
        bot_name: config.botName,
        feishu_domain: config.feishuDomain,
        claude_channel_notifications: config.enableClaudeChannelNotifications,
        gateway: gateway.getStatus(),
        queue: queue.snapshot(),
      };
      const markdown = [
        "# claudecode_lark_mcp status",
        "",
        `- Connected: ${output.gateway.connected}`,
        `- Domain: ${output.feishu_domain}`,
        `- Bot name: ${output.bot_name}`,
        `- Claude channel notifications: ${output.claude_channel_notifications}`,
        `- Queue: ${output.queue.pending} pending, ${output.queue.processing} processing, ${output.queue.replied} replied, ${output.queue.error} error`,
        output.gateway.lastError ? `- Last error: ${output.gateway.lastError}` : "",
      ]
        .filter(Boolean)
        .join("\n");

      return {
        content: [{ type: "text", text: params.response_format === "json" ? asJsonText(output) : markdown }],
        structuredContent: output,
      };
    },
  );

  return server;
}
