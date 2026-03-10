import {
  ISlackClient,
  SlackMessage,
  SlackReaction,
  PostResult,
  ChannelInfo,
  UserInfo,
  HistoryMessage,
  FileUpload,
  FileResult,
  ThreadReply,
} from '../../src/domain/slack';

export class MockSlackClient implements ISlackClient {
  // ── Recorded calls ─────────────────────────────────────────
  posted: SlackMessage[] = [];
  updated: { channel: string; ts: string; text: string }[] = [];
  deleted: { channel: string; ts: string }[] = [];
  scheduled: { channel: string; text: string; postAt: number; threadTs?: string }[] = [];
  reactions: SlackReaction[] = [];
  removedReactions: SlackReaction[] = [];
  invited: { channelId: string; userIds: string[] }[] = [];
  kicked: { channelId: string; userId: string }[] = [];
  pinned: { channel: string; ts: string }[] = [];
  unpinned: { channel: string; ts: string }[] = [];
  archived: string[] = [];
  topics: { channelId: string; topic: string }[] = [];
  purposes: { channelId: string; purpose: string }[] = [];
  uploads: FileUpload[] = [];

  // ── State ──────────────────────────────────────────────────
  channels = new Map<string, ChannelInfo>();
  users = new Map<string, UserInfo>();
  presences = new Map<string, string>();
  history = new Map<string, HistoryMessage[]>();
  threads = new Map<string, ThreadReply[]>();
  botUserId = 'U_BOT_123';
  postCounter = 0;

  // ── Messages ───────────────────────────────────────────────

  async postMessage(msg: SlackMessage): Promise<PostResult> {
    this.posted.push(msg);
    this.postCounter++;
    return { ok: true, ts: `ts_${this.postCounter}` };
  }

  async updateMessage(channel: string, ts: string, text: string): Promise<void> {
    this.updated.push({ channel, ts, text });
  }

  async deleteMessage(channel: string, ts: string): Promise<void> {
    this.deleted.push({ channel, ts });
  }

  async scheduleMessage(channel: string, text: string, postAt: number, threadTs?: string): Promise<PostResult> {
    this.scheduled.push({ channel, text, postAt, threadTs });
    this.postCounter++;
    return { ok: true, ts: `scheduled_${this.postCounter}` };
  }

  // ── Reactions ──────────────────────────────────────────────

  async addReaction(reaction: SlackReaction): Promise<void> {
    this.reactions.push(reaction);
  }

  async removeReaction(reaction: SlackReaction): Promise<void> {
    this.removedReactions.push(reaction);
  }

  // ── Channels ───────────────────────────────────────────────

  async ensureChannel(name: string): Promise<ChannelInfo> {
    const existing = this.channels.get(name);
    if (existing) return existing;
    const info: ChannelInfo = { id: `C_${name}`, name };
    this.channels.set(name, info);
    return info;
  }

  async archiveChannel(channelId: string): Promise<void> {
    this.archived.push(channelId);
  }

  async setChannelTopic(channelId: string, topic: string): Promise<void> {
    this.topics.push({ channelId, topic });
  }

  async setChannelPurpose(channelId: string, purpose: string): Promise<void> {
    this.purposes.push({ channelId, purpose });
  }

  async getChannelInfo(channelId: string): Promise<ChannelInfo> {
    for (const ch of this.channels.values()) {
      if (ch.id === channelId) return ch;
    }
    return { id: channelId, name: 'unknown' };
  }

  async listChannels(): Promise<ChannelInfo[]> {
    return [...this.channels.values()];
  }

  async inviteUsers(channelId: string, userIds: string[]): Promise<void> {
    this.invited.push({ channelId, userIds });
  }

  async kickUser(channelId: string, userId: string): Promise<void> {
    this.kicked.push({ channelId, userId });
  }

  // ── Pins ───────────────────────────────────────────────────

  async pinMessage(channel: string, ts: string): Promise<void> {
    this.pinned.push({ channel, ts });
  }

  async unpinMessage(channel: string, ts: string): Promise<void> {
    this.unpinned.push({ channel, ts });
  }

  // ── History & Threads ──────────────────────────────────────

  async getHistory(channelId: string, limit?: number): Promise<HistoryMessage[]> {
    const msgs = this.history.get(channelId) ?? [];
    return limit ? msgs.slice(0, limit) : msgs;
  }

  async getThreadReplies(channelId: string, threadTs: string): Promise<ThreadReply[]> {
    return this.threads.get(`${channelId}:${threadTs}`) ?? [];
  }

  // ── Files ──────────────────────────────────────────────────

  async uploadFile(upload: FileUpload): Promise<FileResult> {
    this.uploads.push(upload);
    return { ok: true, fileId: `F_${this.uploads.length}` };
  }

  // ── Users ──────────────────────────────────────────────────

  async getBotUserId(): Promise<string> {
    return this.botUserId;
  }

  async getUserInfo(userId: string): Promise<UserInfo> {
    return this.users.get(userId) ?? { id: userId, name: 'unknown', realName: 'Unknown', isBot: false };
  }

  async getUserPresence(userId: string): Promise<string> {
    return this.presences.get(userId) ?? 'active';
  }

  // ── Health ─────────────────────────────────────────────────

  async testConnection(): Promise<boolean> {
    return true;
  }
}
