import { describe, it, expect, beforeEach } from 'vitest';
import { SlackListenerDaemon } from '../../src/application/daemon/SlackListenerDaemon';
import { SlackService } from '../../src/application/slack/SlackService';
import { MockSlackClient } from '../mocks/MockSlackClient';
import { MockSlackSocket } from '../mocks/MockSlackSocket';
import { MockRedisService } from '../mocks/MockRedisService';

const makeMessage = (channel: string, text = 'hello') => ({
  channel,
  user: 'U123',
  text,
  ts: '1234567890.000001',
});

describe('SlackListenerDaemon', () => {
  let socket: MockSlackSocket;
  let redis: MockRedisService;
  let daemon: SlackListenerDaemon;

  beforeEach(() => {
    socket = new MockSlackSocket();
    redis = new MockRedisService();
    const slack = new SlackService(new MockSlackClient(), socket);
    daemon = new SlackListenerDaemon(slack, redis);
  });

  it('starts and connects to Slack', async () => {
    await daemon.start();
    expect(daemon.isRunning()).toBe(true);
    expect(socket.isConnected()).toBe(true);
  });

  it('does not start twice', async () => {
    await daemon.start();
    await daemon.start();
    expect(daemon.isRunning()).toBe(true);
  });

  it('stops and disconnects', async () => {
    await daemon.start();
    await daemon.stop();
    expect(daemon.isRunning()).toBe(false);
    expect(redis.quit_called).toBe(true);
  });

  it('routes message to correct redis queue after binding', async () => {
    daemon.bind('C123', 'project-alpha');
    await daemon.start();

    await socket.simulateMessage(makeMessage('C123', 'hello from slack'));

    const item = await redis.pop('queue:project-alpha');
    expect(item).not.toBeNull();
    const parsed = JSON.parse(item!);
    expect(parsed.text).toBe('hello from slack');
    expect(parsed.channel).toBe('C123');
  });

  it('ignores message from unbound channel', async () => {
    daemon.bind('C123', 'project-alpha');
    await daemon.start();

    await socket.simulateMessage(makeMessage('C999', 'ignored'));

    expect(await redis.len('queue:project-alpha')).toBe(0);
  });

  it('routes to correct project for multiple bindings', async () => {
    daemon.bind('C123', 'project-alpha');
    daemon.bind('C456', 'project-beta');
    await daemon.start();

    await socket.simulateMessage(makeMessage('C123', 'msg-alpha'));
    await socket.simulateMessage(makeMessage('C456', 'msg-beta'));

    expect(await redis.len('queue:project-alpha')).toBe(1);
    expect(await redis.len('queue:project-beta')).toBe(1);

    const alpha = JSON.parse((await redis.pop('queue:project-alpha'))!);
    const beta = JSON.parse((await redis.pop('queue:project-beta'))!);
    expect(alpha.text).toBe('msg-alpha');
    expect(beta.text).toBe('msg-beta');
  });

  it('unbind stops routing to that channel', async () => {
    daemon.bind('C123', 'project-alpha');
    daemon.unbind('C123');
    await daemon.start();

    await socket.simulateMessage(makeMessage('C123', 'should be ignored'));

    expect(await redis.len('queue:project-alpha')).toBe(0);
  });

  it('routes any bound channel including general', async () => {
    daemon.bind('C0AK5K4QGNA', 'general');
    await daemon.start();

    await socket.simulateMessage(makeMessage('C0AK5K4QGNA', 'test from general'));

    const item = await redis.pop('queue:general');
    expect(item).not.toBeNull();
    const parsed = JSON.parse(item!);
    expect(parsed.text).toBe('test from general');
  });

  it('unbound channel messages are ignored', async () => {
    // no bindings at all — messages should be dropped
    await daemon.start();

    await socket.simulateMessage(makeMessage('C0AK5K4QGNA', 'no binding'));

    expect(await redis.len('queue:general')).toBe(0);
  });

  it('getBindings returns all bindings', () => {
    daemon.bind('C123', 'project-alpha');
    daemon.bind('C456', 'project-beta');
    const bindings = daemon.getBindings();
    expect(bindings).toHaveLength(2);
    expect(bindings).toContainEqual({ channelId: 'C123', project: 'project-alpha' });
    expect(bindings).toContainEqual({ channelId: 'C456', project: 'project-beta' });
  });
});
