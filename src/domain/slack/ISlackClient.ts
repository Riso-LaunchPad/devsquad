/**
 * Port: Full Slack API abstraction.
 * Domain layer depends on this interface only — never on @slack/web-api directly.
 */

// ── Types ────────────────────────────────────────────────────

export interface SlackMessage {
  channel: string;
  text: string;
  threadTs?: string;
}

export interface SlackReaction {
  channel: string;
  timestamp: string;
  emoji: string;
}

export interface PostResult {
  ok: boolean;
  ts: string;
}

export interface ChannelInfo {
  id: string;
  name: string;
}

export interface UserInfo {
  id: string;
  name: string;
  realName: string;
  isBot: boolean;
}

export interface HistoryMessage {
  ts: string;
  user?: string;
  text: string;
  threadTs?: string;
  botId?: string;
}

export interface FileUpload {
  channelId: string;
  filename: string;
  content: string | Buffer;
  title?: string;
  threadTs?: string;
}

export interface FileResult {
  ok: boolean;
  fileId: string;
}

export interface ThreadReply {
  ts: string;
  user?: string;
  text: string;
  botId?: string;
}

// ── Interface ────────────────────────────────────────────────

export interface ISlackClient {
  // Messages
  postMessage(msg: SlackMessage): Promise<PostResult>;
  updateMessage(channel: string, ts: string, text: string): Promise<void>;
  deleteMessage(channel: string, ts: string): Promise<void>;
  scheduleMessage(channel: string, text: string, postAt: number, threadTs?: string): Promise<PostResult>;

  // Reactions
  addReaction(reaction: SlackReaction): Promise<void>;
  removeReaction(reaction: SlackReaction): Promise<void>;

  // Channels
  ensureChannel(name: string): Promise<ChannelInfo>;
  archiveChannel(channelId: string): Promise<void>;
  setChannelTopic(channelId: string, topic: string): Promise<void>;
  setChannelPurpose(channelId: string, purpose: string): Promise<void>;
  getChannelInfo(channelId: string): Promise<ChannelInfo>;
  listChannels(): Promise<ChannelInfo[]>;
  inviteUsers(channelId: string, userIds: string[]): Promise<void>;
  kickUser(channelId: string, userId: string): Promise<void>;

  // Pins
  pinMessage(channel: string, ts: string): Promise<void>;
  unpinMessage(channel: string, ts: string): Promise<void>;

  // History & Threads
  getHistory(channelId: string, limit?: number, oldest?: string, latest?: string): Promise<HistoryMessage[]>;
  getThreadReplies(channelId: string, threadTs: string): Promise<ThreadReply[]>;

  // Files
  uploadFile(upload: FileUpload): Promise<FileResult>;

  // Users
  getBotUserId(): Promise<string>;
  getUserInfo(userId: string): Promise<UserInfo>;
  getUserPresence(userId: string): Promise<string>;

  // Health
  testConnection(): Promise<boolean>;
}
