import type { GatewayMessage, MessageStatus, QueueSnapshot } from "./types.js";

export class MessageQueue {
  private readonly messages = new Map<string, GatewayMessage>();
  private readonly order: string[] = [];

  constructor(private readonly maxSize: number) {}

  enqueue(message: Omit<GatewayMessage, "status" | "receivedAt">): GatewayMessage | null {
    if (this.messages.has(message.messageId)) return null;

    const item: GatewayMessage = {
      ...message,
      status: "pending",
      receivedAt: new Date().toISOString(),
    };

    this.messages.set(item.messageId, item);
    this.order.push(item.messageId);
    this.trim();
    return item;
  }

  get(messageId: string): GatewayMessage | undefined {
    return this.messages.get(messageId);
  }

  list(options: {
    limit: number;
    offset?: number;
    statuses?: MessageStatus[];
  }): { items: GatewayMessage[]; total: number; hasMore: boolean; nextOffset?: number } {
    const offset = options.offset ?? 0;
    const statuses = new Set(options.statuses ?? []);
    const filtered = this.order
      .map((id) => this.messages.get(id))
      .filter((item): item is GatewayMessage => Boolean(item))
      .filter((item) => statuses.size === 0 || statuses.has(item.status));
    const items = filtered.slice(offset, offset + options.limit);
    const nextOffset = offset + items.length;

    return {
      items,
      total: filtered.length,
      hasMore: nextOffset < filtered.length,
      nextOffset: nextOffset < filtered.length ? nextOffset : undefined,
    };
  }

  mark(messageId: string, status: MessageStatus, note?: string): GatewayMessage {
    const item = this.messages.get(messageId);
    if (!item) {
      throw new Error(`Message not found: ${messageId}`);
    }
    item.status = status;
    item.note = note;
    return item;
  }

  snapshot(): QueueSnapshot {
    const counts: QueueSnapshot = {
      total: this.messages.size,
      pending: 0,
      processing: 0,
      replied: 0,
      ignored: 0,
      error: 0,
    };

    for (const item of this.messages.values()) {
      counts[item.status] += 1;
    }
    return counts;
  }

  private trim(): void {
    while (this.order.length > this.maxSize) {
      const id = this.order.shift();
      if (id) this.messages.delete(id);
    }
  }
}
