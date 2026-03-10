import { describe, it, expect, beforeEach } from 'vitest';
import { SlackService } from '../../src/application/slack';
import { MockSlackClient } from '../mocks/MockSlackClient';
import { MockSlackSocket } from '../mocks/MockSlackSocket';
import { IncomingSlackMessage } from '../../src/domain/slack';

describe('SlackService', () => {
  let client: MockSlackClient;
  let socket: MockSlackSocket;
  let service: SlackService;

  beforeEach(() => {
    client = new MockSlackClient();
    socket = new MockSlackSocket();
    service = new SlackService(client, socket);
  });

  const incomingMsg: IncomingSlackMessage = {
    channel: 'C123',
    user: 'U_USER',
    text: 'hello',
    ts: '111.222',
  };

  // ── Lifecycle ──

  it('start connects socket', async () => {
    await service.start();
    expect(socket.isConnected()).toBe(true);
  });

  it('stop disconnects socket and clears listeners', async () => {
    await service.start();
    service.onMessage(() => {});
    await service.stop();
    expect(socket.isConnected()).toBe(false);
  });

  it('isConnected delegates to socket', async () => {
    expect(service.isConnected()).toBe(false);
    await service.start();
    expect(service.isConnected()).toBe(true);
  });

  // ── Inbound ──

  it('dispatches incoming messages to listeners', async () => {
    await service.start();
    const received: IncomingSlackMessage[] = [];
    service.onMessage((msg) => { received.push(msg); });
    await socket.simulateMessage(incomingMsg);
    expect(received).toHaveLength(1);
    expect(received[0]).toEqual(incomingMsg);
  });

  it('supports multiple listeners', async () => {
    await service.start();
    let count = 0;
    service.onMessage(() => { count++; });
    service.onMessage(() => { count++; });
    await socket.simulateMessage(incomingMsg);
    expect(count).toBe(2);
  });

  it('unsubscribe removes listener', async () => {
    await service.start();
    let count = 0;
    const unsub = service.onMessage(() => { count++; });
    unsub();
    await socket.simulateMessage(incomingMsg);
    expect(count).toBe(0);
  });

  // ── Messages ──

  it('send posts message', async () => {
    const result = await service.send('C123', 'hello');
    expect(result.ok).toBe(true);
    expect(client.posted[0]).toEqual({ channel: 'C123', text: 'hello' });
  });

  it('reply posts in thread', async () => {
    const result = await service.reply('C123', 'thread_1', 'reply');
    expect(result.ok).toBe(true);
    expect(client.posted[0].threadTs).toBe('thread_1');
  });

  it('edit updates message', async () => {
    await service.edit('C123', 'ts_1', 'updated');
    expect(client.updated[0]).toEqual({ channel: 'C123', ts: 'ts_1', text: 'updated' });
  });

  it('deleteMessage removes message', async () => {
    await service.deleteMessage('C123', 'ts_1');
    expect(client.deleted[0]).toEqual({ channel: 'C123', ts: 'ts_1' });
  });

  it('scheduleMessage schedules a message', async () => {
    const result = await service.scheduleMessage('C123', 'later', 1700000000, 'thread_1');
    expect(result.ok).toBe(true);
    expect(client.scheduled[0]).toEqual({ channel: 'C123', text: 'later', postAt: 1700000000, threadTs: 'thread_1' });
  });

  // ── Reactions ──

  it('react adds reaction', async () => {
    await service.react('C123', 'ts_1', 'thumbsup');
    expect(client.reactions[0]).toEqual({ channel: 'C123', timestamp: 'ts_1', emoji: 'thumbsup' });
  });

  it('unreact removes reaction', async () => {
    await service.unreact('C123', 'ts_1', 'thumbsup');
    expect(client.removedReactions[0]).toEqual({ channel: 'C123', timestamp: 'ts_1', emoji: 'thumbsup' });
  });

  // ── Channels ──

  it('ensureChannel creates or returns channel', async () => {
    const result = await service.ensureChannel('project-myapp');
    expect(result).toEqual({ id: 'C_project-myapp', name: 'project-myapp' });
  });

  it('archiveChannel archives', async () => {
    await service.archiveChannel('C123');
    expect(client.archived[0]).toBe('C123');
  });

  it('setChannelTopic sets topic', async () => {
    await service.setChannelTopic('C123', 'new topic');
    expect(client.topics[0]).toEqual({ channelId: 'C123', topic: 'new topic' });
  });

  it('setChannelPurpose sets purpose', async () => {
    await service.setChannelPurpose('C123', 'new purpose');
    expect(client.purposes[0]).toEqual({ channelId: 'C123', purpose: 'new purpose' });
  });

  it('getChannelInfo returns info', async () => {
    client.channels.set('test', { id: 'C123', name: 'test' });
    const info = await service.getChannelInfo('C123');
    expect(info).toEqual({ id: 'C123', name: 'test' });
  });

  it('listChannels returns all channels', async () => {
    client.channels.set('a', { id: 'C1', name: 'a' });
    client.channels.set('b', { id: 'C2', name: 'b' });
    const list = await service.listChannels();
    expect(list).toHaveLength(2);
  });

  it('inviteUsers invites', async () => {
    await service.inviteUsers('C123', ['U1', 'U2']);
    expect(client.invited[0]).toEqual({ channelId: 'C123', userIds: ['U1', 'U2'] });
  });

  it('kickUser kicks', async () => {
    await service.kickUser('C123', 'U1');
    expect(client.kicked[0]).toEqual({ channelId: 'C123', userId: 'U1' });
  });

  // ── Pins ──

  it('pinMessage pins', async () => {
    await service.pinMessage('C123', 'ts_1');
    expect(client.pinned[0]).toEqual({ channel: 'C123', ts: 'ts_1' });
  });

  it('unpinMessage unpins', async () => {
    await service.unpinMessage('C123', 'ts_1');
    expect(client.unpinned[0]).toEqual({ channel: 'C123', ts: 'ts_1' });
  });

  // ── History & Threads ──

  it('getHistory returns messages', async () => {
    client.history.set('C123', [
      { ts: '1', text: 'msg1' },
      { ts: '2', text: 'msg2' },
    ]);
    const msgs = await service.getHistory('C123');
    expect(msgs).toHaveLength(2);
  });

  it('getHistory respects limit', async () => {
    client.history.set('C123', [
      { ts: '1', text: 'msg1' },
      { ts: '2', text: 'msg2' },
      { ts: '3', text: 'msg3' },
    ]);
    const msgs = await service.getHistory('C123', 2);
    expect(msgs).toHaveLength(2);
  });

  it('getThreadReplies returns replies', async () => {
    client.threads.set('C123:ts_1', [
      { ts: 'r1', text: 'reply1' },
    ]);
    const replies = await service.getThreadReplies('C123', 'ts_1');
    expect(replies).toHaveLength(1);
    expect(replies[0].text).toBe('reply1');
  });

  // ── Files ──

  it('uploadFile uploads', async () => {
    const result = await service.uploadFile({
      channelId: 'C123',
      filename: 'test.txt',
      content: 'hello',
    });
    expect(result.ok).toBe(true);
    expect(client.uploads[0].filename).toBe('test.txt');
  });

  // ── Users ──

  it('getBotUserId returns bot id', async () => {
    expect(await service.getBotUserId()).toBe('U_BOT_123');
  });

  it('getUserInfo returns user', async () => {
    client.users.set('U1', { id: 'U1', name: 'bob', realName: 'Bob Smith', isBot: false });
    const user = await service.getUserInfo('U1');
    expect(user.name).toBe('bob');
    expect(user.realName).toBe('Bob Smith');
  });

  it('getUserPresence returns presence', async () => {
    client.presences.set('U1', 'away');
    expect(await service.getUserPresence('U1')).toBe('away');
  });

  // ── Health ──

  it('testConnection delegates to client', async () => {
    expect(await service.testConnection()).toBe(true);
  });
});
