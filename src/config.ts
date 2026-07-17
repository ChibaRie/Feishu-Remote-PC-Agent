import path from "node:path";
import { homedir } from "node:os";
import dotenv from "dotenv";
import type { AppConfig } from "./types.js";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

function readBoolean(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  return !["0", "false", "no", "off"].includes(raw.trim().toLowerCase());
}

function readInteger(name: string, fallback: number, min: number, max: number): number {
  const raw = Number.parseInt(process.env[name] ?? "", 10);
  if (!Number.isFinite(raw)) return fallback;
  return Math.min(max, Math.max(min, raw));
}

function readList(name: string): string[] {
  return (process.env[name] ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function loadConfig(): AppConfig {
  const domain = (process.env.FEISHU_DOMAIN ?? process.env.LARK_DOMAIN ?? "feishu").toLowerCase();
  return {
    feishuAppId: process.env.FEISHU_APP_ID ?? process.env.LARK_APP_ID ?? "",
    feishuAppSecret: process.env.FEISHU_APP_SECRET ?? process.env.LARK_APP_SECRET ?? "",
    feishuDomain: domain === "lark" ? "lark" : "feishu",
    botName: process.env.BOT_NAME ?? "Claude Code",
    sendTypingAck: readBoolean("SEND_TYPING_ACK", true),
    requireMentionInGroup: readBoolean("REQUIRE_MENTION_IN_GROUP", true),
    allowedUserIds: readList("ALLOW_USER_IDS"),
    maxQueueSize: readInteger("MAX_QUEUE_SIZE", 200, 10, 5000),
    textChunkLimit: readInteger("TEXT_CHUNK_LIMIT", 3800, 500, 8000),
    stateDir:
      process.env.CLAUDECODE_LARK_STATE_DIR ??
      path.join(homedir(), ".claude", "claudecode_lark_mcp"),
    enableClaudeChannelNotifications: readBoolean("ENABLE_CLAUDE_CHANNEL_NOTIFICATIONS", true),
  };
}

export function validateConfig(config: AppConfig): string[] {
  const missing: string[] = [];
  if (!config.feishuAppId) missing.push("FEISHU_APP_ID");
  if (!config.feishuAppSecret) missing.push("FEISHU_APP_SECRET");
  return missing;
}
