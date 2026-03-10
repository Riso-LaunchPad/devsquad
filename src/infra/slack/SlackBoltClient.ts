import { WebClient } from '@slack/web-api';
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
} from '../../domain/slack';

export class SlackBoltClient implements ISlackClient {
  private client: WebClient;

  constructor(botToken: string) {
    this.client = new WebClient(botToken);
  }

  // ── Messages ───────────────────────────────────────────────

  async postMessage(msg: SlackMessage): Promise<PostResult> {
    const result = await this.client.chat.postMessage({
      channel: msg.channel,
      text: msg.text,
      thread_ts: msg.threadTs,
      unfurl_links: false,
    });
    return { ok: !!result.ok, ts: result.ts ?? '' };
  }

  async updateMessage(channel: string, ts: string, text: string): Promise<void> {
    await this.client.chat.update({ channel, ts, text });
  }

  async deleteMessage(channel: string, ts: string): Promise<void> {
    await this.client.chat.delete({ channel, ts });
  }

  async scheduleMessage(channel: string, text: string, postAt: number, threadTs?: string): Promise<PostResult> {
    const result = await this.client.chat.scheduleMessage({
      channel,
      text,
      post_at: postAt,
      thread_ts: threadTs,
    });
    return { ok: !!result.ok, ts: result.scheduled_message_id ?? '' };
  }

  // ── Reactions ──────────────────────────────────────────────

  async addReaction(reaction: SlackReaction): Promise<void> {
    await this.client.reactions.add({
      channel: reaction.channel,
      timestamp: reaction.timestamp,
      name: reaction.emoji,
    });
  }

  async removeReaction(reaction: SlackReaction): Promise<void> {
    await this.client.reactions.remove({
      channel: reaction.channel,
      timestamp: reaction.timestamp,
      name: reaction.emoji,
    });
  }

  // ── Channels ───────────────────────────────────────────────

  async ensureChannel(name: string): Promise<ChannelInfo> {
    try {
      const result = await this.client.conversations.create({ name });
      return { id: result.channel!.id!, name: result.channel!.name! };
    } catch (error: unknown) {
      const slackErr = error as { data?: { error?: string } };
      if (slackErr.data?.error === 'name_taken') return this.findChannel(name);
      throw error;
    }
  }

  async archiveChannel(channelId: string): Promise<void> {
    await this.client.conversations.archive({ channel: channelId });
  }

  async setChannelTopic(channelId: string, topic: string): Promise<void> {
    await this.client.conversations.setTopic({ channel: channelId, topic });
  }

  async setChannelPurpose(channelId: string, purpose: string): Promise<void> {
    await this.client.conversations.setPurpose({ channel: channelId, purpose });
  }

  async getChannelInfo(channelId: string): Promise<ChannelInfo> {
    const result = await this.client.conversations.info({ channel: channelId });
    return { id: result.channel!.id!, name: (result.channel as any).name ?? '' };
  }

  async listChannels(): Promise<ChannelInfo[]> {
    const channels: ChannelInfo[] = [];
    let cursor: string | undefined;
    do {
      const result = await this.client.conversations.list({
        types: 'public_channel,private_channel',
        cursor,
        limit: 200,
      });
      for (const ch of result.channels ?? []) {
        if (ch.id) channels.push({ id: ch.id, name: ch.name ?? '' });
      }
      cursor = result.response_metadata?.next_cursor;
    } while (cursor);
    return channels;
  }

  async inviteUsers(channelId: string, userIds: string[]): Promise<void> {
    if (userIds.length === 0) return;
    try {
      await this.client.conversations.invite({ channel: channelId, users: userIds.join(',') });
    } catch (error: unknown) {
      const slackErr = error as { data?: { error?: string } };
      if (slackErr.data?.error === 'already_in_channel' || slackErr.data?.error === 'cant_invite_self') return;
      throw error;
    }
  }

  async kickUser(channelId: string, userId: string): Promise<void> {
    await this.client.conversations.kick({ channel: channelId, user: userId });
  }

  // ── Pins ───────────────────────────────────────────────────

  async pinMessage(channel: string, ts: string): Promise<void> {
    await this.client.pins.add({ channel, timestamp: ts });
  }

  async unpinMessage(channel: string, ts: string): Promise<void> {
    await this.client.pins.remove({ channel, timestamp: ts });
  }

  // ── History & Threads ──────────────────────────────────────

  async getHistory(channelId: string, limit = 100, oldest?: string, latest?: string): Promise<HistoryMessage[]> {
    const result = await this.client.conversations.history({ channel: channelId, limit, oldest, latest });
    return (result.messages ?? []).map((m: any) => ({
      ts: m.ts,
      user: m.user,
      text: m.text ?? '',
      threadTs: m.thread_ts,
      botId: m.bot_id,
    }));
  }

  async getThreadReplies(channelId: string, threadTs: string): Promise<ThreadReply[]> {
    const result = await this.client.conversations.replies({ channel: channelId, ts: threadTs });
    return (result.messages ?? []).map((m: any) => ({
      ts: m.ts,
      user: m.user,
      text: m.text ?? '',
      botId: m.bot_id,
    }));
  }

  // ── Files ──────────────────────────────────────────────────

  async uploadFile(upload: FileUpload): Promise<FileResult> {
    const content = typeof upload.content === 'string' ? upload.content : upload.content.toString('base64');
    const opts: Record<string, unknown> = {
      channel_id: upload.channelId,
      filename: upload.filename,
      content,
    };
    if (upload.title) opts.title = upload.title;
    if (upload.threadTs) opts.thread_ts = upload.threadTs;
    const result = await this.client.files.uploadV2(opts as any);
    return { ok: true, fileId: (result as any).file?.id ?? '' };
  }

  // ── Users ──────────────────────────────────────────────────

  async getBotUserId(): Promise<string> {
    const result = await this.client.auth.test();
    if (!result.ok || !result.user_id) throw new Error(`Failed to get bot user ID: ${result.error}`);
    return result.user_id;
  }

  async getUserInfo(userId: string): Promise<UserInfo> {
    const result = await this.client.users.info({ user: userId });
    const u = result.user!;
    return { id: u.id!, name: u.name ?? '', realName: u.real_name ?? '', isBot: u.is_bot ?? false };
  }

  async getUserPresence(userId: string): Promise<string> {
    const result = await this.client.users.getPresence({ user: userId });
    return result.presence ?? 'unknown';
  }

  // ── Health ─────────────────────────────────────────────────

  async testConnection(): Promise<boolean> {
    try {
      const result = await this.client.auth.test();
      return !!result.ok;
    } catch {
      return false;
    }
  }

  // ── Private ────────────────────────────────────────────────

  private async findChannel(name: string): Promise<ChannelInfo> {
    let cursor: string | undefined;
    do {
      const result = await this.client.conversations.list({
        types: 'public_channel,private_channel', cursor, limit: 200,
      });
      const channel = result.channels?.find((c) => c.name === name);
      if (channel?.id) return { id: channel.id, name: channel.name ?? name };
      cursor = result.response_metadata?.next_cursor;
    } while (cursor);
    throw new Error(`Channel #${name} not found`);
  }
}
