import type { ResourceDescriptor } from "@larksuiteoapi/node-sdk";

export type MessageStatus = "pending" | "processing" | "replied" | "ignored" | "error";

export interface AppConfig {
  feishuAppId: string;
  feishuAppSecret: string;
  feishuDomain: "feishu" | "lark";
  botName: string;
  sendTypingAck: boolean;
  requireMentionInGroup: boolean;
  allowedUserIds: string[];
  maxQueueSize: number;
  textChunkLimit: number;
  stateDir: string;
  enableClaudeChannelNotifications: boolean;
}

export interface GatewayMessage {
  messageId: string;
  chatId: string;
  chatType: "p2p" | "group";
  senderId: string;
  senderName?: string;
  text: string;
  rawContentType: string;
  mentionedBot: boolean;
  mentionAll: boolean;
  createTime: number;
  receivedAt: string;
  status: MessageStatus;
  resources: ResourceDescriptor[];
  replyToMessageId?: string;
  threadId?: string;
  note?: string;
}

export interface QueueSnapshot {
  total: number;
  pending: number;
  processing: number;
  replied: number;
  ignored: number;
  error: number;
}

export interface GatewayStatus {
  connected: boolean;
  startedAt?: string;
  lastMessageAt?: string;
  lastError?: string;
}
