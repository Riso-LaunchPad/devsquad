import { describe, it, expect, beforeEach } from 'vitest';
import { MessageProcessorDaemon } from '../../src/application/daemon/MessageProcessorDaemon';
import { MockRedisService } from '../mocks/MockRedisService';
import { MockTmuxService } from '../mocks/MockTmuxService';

const target = { session: 'devsquad', window: 'project-alpha' };
const config = { project: 'project-alpha', target };

const makeRaw = (overrides = {}) =>
  JSON.stringify({
    channel: 'C123',
    user: 'U456',
    text: 'hello',
    ts: '1234567890.000001',
    ...overrides,
  });

describe('MessageProcessorDaemon', () => {
  let redis: MockRedisService;
  let tmux: MockTmuxService;
  let daemon: MessageProcessorDaemon;

  beforeEach(() => {
    redis = new MockRedisService();
    tmux = new MockTmuxService();
    daemon = new MessageProcessorDaemon(config, redis, tmux);
  });

  it('starts and marks as running', async () => {
    await daemon.start();
    expect(daemon.isRunning()).toBe(true);
    await daemon.stop();
  });

  it('does not start twice', async () => {
    await daemon.start();
    await daemon.start();
    expect(daemon.isRunning()).toBe(true);
    await daemon.stop();
  });

  it('stops and quits redis', async () => {
    await daemon.start();
    await daemon.stop();
    expect(daemon.isRunning()).toBe(false);
    expect(redis.quit_called).toBe(true);
  });

  it('processes a message from queue and sends to tmux', async () => {
    await redis.push('queue:project-alpha', makeRaw({ text: 'hello world' }));

    await daemon.start();
    // wait for one loop tick
    await new Promise(r => setTimeout(r, 20));
    await daemon.stop();

    expect(tmux.sent.length).toBeGreaterThan(0);
    expect(tmux.sent[0].target).toEqual(target);
    expect(tmux.sent[0].message).toContain('hello world');
    expect(tmux.sent[0].message).toContain('@U456');
    expect(tmux.sent[0].message).toContain('#C123');
    expect(tmux.sent[0].message).toContain('ts:1234567890.000001');
  });

  it('formats message with thread info', async () => {
    await redis.push('queue:project-alpha', makeRaw({ threadTs: '111.222' }));

    await daemon.start();
    await new Promise(r => setTimeout(r, 20));
    await daemon.stop();

    expect(tmux.sent[0].message).toContain('[thread:111.222]');
  });

  it('formats message without thread info when no threadTs', async () => {
    await redis.push('queue:project-alpha', makeRaw());

    await daemon.start();
    await new Promise(r => setTimeout(r, 20));
    await daemon.stop();

    expect(tmux.sent[0].message).not.toContain('[thread:');
  });

  it('processes multiple messages in order', async () => {
    await redis.push('queue:project-alpha', makeRaw({ text: 'first' }));
    await redis.push('queue:project-alpha', makeRaw({ text: 'second' }));

    await daemon.start();
    await new Promise(r => setTimeout(r, 50));
    await daemon.stop();

    expect(tmux.sent.length).toBe(2);
    expect(tmux.sent[0].message).toContain('first');
    expect(tmux.sent[1].message).toContain('second');
  });
});
