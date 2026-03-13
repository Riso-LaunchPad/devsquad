import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RedisService } from '../../src/infra/redis/RedisService';

const mockRedis = {
  rpush: vi.fn(),
  blpop: vi.fn(),
  lpop: vi.fn(),
  llen: vi.fn(),
  del: vi.fn(),
  ping: vi.fn(),
  quit: vi.fn(),
  connect: vi.fn(),
  on: vi.fn(),
};

vi.mock('ioredis', () => ({
  default: function() { return mockRedis; },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('RedisService', () => {
  let svc: RedisService;

  beforeEach(() => {
    svc = new RedisService({ host: '127.0.0.1', port: 6379, password: 'secret' });
  });

  describe('push', () => {
    it('calls rpush with key and value', async () => {
      mockRedis.rpush.mockResolvedValueOnce(1);
      await svc.push('queue:project-alpha', '{"text":"hello"}');
      expect(mockRedis.rpush).toHaveBeenCalledWith('queue:project-alpha', '{"text":"hello"}');
    });
  });

  describe('bpop', () => {
    it('returns value when message available', async () => {
      mockRedis.blpop.mockResolvedValueOnce(['queue:project-alpha', '{"text":"hello"}']);
      const result = await svc.bpop('queue:project-alpha');
      expect(result).toBe('{"text":"hello"}');
      expect(mockRedis.blpop).toHaveBeenCalledWith('queue:project-alpha', 0);
    });

    it('returns null on timeout', async () => {
      mockRedis.blpop.mockResolvedValueOnce(null);
      const result = await svc.bpop('queue:project-alpha', 5);
      expect(result).toBeNull();
      expect(mockRedis.blpop).toHaveBeenCalledWith('queue:project-alpha', 5);
    });
  });

  describe('pop', () => {
    it('returns value when message exists', async () => {
      mockRedis.lpop.mockResolvedValueOnce('{"text":"hello"}');
      const result = await svc.pop('queue:project-alpha');
      expect(result).toBe('{"text":"hello"}');
    });

    it('returns null when queue empty', async () => {
      mockRedis.lpop.mockResolvedValueOnce(null);
      const result = await svc.pop('queue:project-alpha');
      expect(result).toBeNull();
    });
  });

  describe('len', () => {
    it('returns queue length', async () => {
      mockRedis.llen.mockResolvedValueOnce(3);
      expect(await svc.len('queue:project-alpha')).toBe(3);
    });
  });

  describe('del', () => {
    it('calls del with key', async () => {
      mockRedis.del.mockResolvedValueOnce(1);
      await svc.del('queue:project-alpha');
      expect(mockRedis.del).toHaveBeenCalledWith('queue:project-alpha');
    });
  });

  describe('ping', () => {
    it('returns true on PONG', async () => {
      mockRedis.ping.mockResolvedValueOnce('PONG');
      expect(await svc.ping()).toBe(true);
    });

    it('returns false on error', async () => {
      mockRedis.ping.mockRejectedValueOnce(new Error('connection refused'));
      expect(await svc.ping()).toBe(false);
    });
  });

  describe('quit', () => {
    it('calls quit', async () => {
      mockRedis.quit.mockResolvedValueOnce('OK');
      await svc.quit();
      expect(mockRedis.quit).toHaveBeenCalled();
    });
  });
});
