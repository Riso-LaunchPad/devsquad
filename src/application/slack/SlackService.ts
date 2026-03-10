import {
  ISlackClient,
  ISlackSocket,
  IncomingSlackMessage,
  PostResult,
  ChannelInfo,
  UserInfo,
  HistoryMessage,
  ThreadReply,
  FileUpload,
  FileResult,
} from '../../domain/slack';

export type OnMessageListener = (msg: IncomingSlackMessage) => Promise<void> | void;

/**
 * Facade: single entry point for ALL Slack interactions.
 * Other services call this — never touch ISlackClient or ISlackSocket directly.
 */
export class SlackService {
  private listeners: OnMessageListener[] = [];

  constructor(
    private client: ISlackClient,
    private socket: ISlackSocket,
  ) {}

  // ── Lifecycle ──────────────────────────────────────────────

  async start(): Promise<void> {
    await this.socket.connect(async (msg) => {
      for (const listener of this.listeners) {
        await listener(msg);
      }
    });
  }

  async stop(): Promise<void> {
    await this.socket.disconnect();
    this.listeners = [];
  }

  isConnected(): boolean {
    return this.socket.isConnected();
  }

  // ── Inbound (receive) ─────────────────────────────────────

  onMessage(listener: OnMessageListener): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  // ── Messages ───────────────────────────────────────────────

  async send(channel: string, text: string): Promise<PostResult> {
    return this.client.postMessage({ channel, text });
  }

  async reply(channel: string, threadTs: string, text: string): Promise<PostResult> {
    return this.client.postMessage({ channel, text, threadTs });
  }

  async edit(channel: string, ts: string, text: string): Promise<void> {
    await this.client.updateMessage(channel, ts, text);
  }

  async deleteMessage(channel: string, ts: string): Promise<void> {
    await this.client.deleteMessage(channel, ts);
  }

  async scheduleMessage(channel: string, text: string, postAt: number, threadTs?: string): Promise<PostResult> {
    return this.client.scheduleMessage(channel, text, postAt, threadTs);
  }

  // ── Reactions ──────────────────────────────────────────────

  async react(channel: string, ts: string, emoji: string): Promise<void> {
    await this.client.addReaction({ channel, timestamp: ts, emoji });
  }

  async unreact(channel: string, ts: string, emoji: string): Promise<void> {
    await this.client.removeReaction({ channel, timestamp: ts, emoji });
  }

  // ── Channels ───────────────────────────────────────────────

  async ensureChannel(name: string): Promise<ChannelInfo> {
    return this.client.ensureChannel(name);
  }

  async archiveChannel(channelId: string): Promise<void> {
    await this.client.archiveChannel(channelId);
  }

  async setChannelTopic(channelId: string, topic: string): Promise<void> {
    await this.client.setChannelTopic(channelId, topic);
  }

  async setChannelPurpose(channelId: string, purpose: string): Promise<void> {
    await this.client.setChannelPurpose(channelId, purpose);
  }

  async getChannelInfo(channelId: string): Promise<ChannelInfo> {
    return this.client.getChannelInfo(channelId);
  }

  async listChannels(): Promise<ChannelInfo[]> {
    return this.client.listChannels();
  }

  async inviteUsers(channelId: string, userIds: string[]): Promise<void> {
    await this.client.inviteUsers(channelId, userIds);
  }

  async kickUser(channelId: string, userId: string): Promise<void> {
    await this.client.kickUser(channelId, userId);
  }

  // ── Pins ───────────────────────────────────────────────────

  async pinMessage(channel: string, ts: string): Promise<void> {
    await this.client.pinMessage(channel, ts);
  }

  async unpinMessage(channel: string, ts: string): Promise<void> {
    await this.client.unpinMessage(channel, ts);
  }

  // ── History & Threads ──────────────────────────────────────

  async getHistory(channelId: string, limit?: number, oldest?: string, latest?: string): Promise<HistoryMessage[]> {
    return this.client.getHistory(channelId, limit, oldest, latest);
  }

  async getThreadReplies(channelId: string, threadTs: string): Promise<ThreadReply[]> {
    return this.client.getThreadReplies(channelId, threadTs);
  }

  // ── Files ──────────────────────────────────────────────────

  async uploadFile(upload: FileUpload): Promise<FileResult> {
    return this.client.uploadFile(upload);
  }

  // ── Users ──────────────────────────────────────────────────

  async getBotUserId(): Promise<string> {
    return this.client.getBotUserId();
  }

  async getUserInfo(userId: string): Promise<UserInfo> {
    return this.client.getUserInfo(userId);
  }

  async getUserPresence(userId: string): Promise<string> {
    return this.client.getUserPresence(userId);
  }

  // ── Health ─────────────────────────────────────────────────

  async testConnection(): Promise<boolean> {
    return this.client.testConnection();
  }
}
