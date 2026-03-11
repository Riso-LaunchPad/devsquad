import type { IRedisService } from '../../src/domain/redis';

export class MockRedisService implements IRedisService {
  queues = new Map<string, string[]>();
  quit_called = false;

  async push(key: string, value: string): Promise<void> {
    const q = this.queues.get(key) ?? [];
    q.push(value);
    this.queues.set(key, q);
  }

  async bpop(key: string, _timeoutSeconds = 0): Promise<string | null> {
    const q = this.queues.get(key);
    if (q && q.length > 0) return q.shift() ?? null;
    // simulate a short block so the loop doesn't spin; exit immediately if quit
    await new Promise(r => setTimeout(r, this.quit_called ? 0 : 10));
    return null;
  }

  async pop(key: string): Promise<string | null> {
    return this.bpop(key);
  }

  async len(key: string): Promise<number> {
    return this.queues.get(key)?.length ?? 0;
  }

  async del(key: string): Promise<void> {
    this.queues.delete(key);
  }

  async ping(): Promise<boolean> {
    return true;
  }

  async quit(): Promise<void> {
    this.quit_called = true;
  }
}
