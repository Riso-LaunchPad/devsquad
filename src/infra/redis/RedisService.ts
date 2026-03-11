import Redis from 'ioredis';
import type { IRedisService } from '../../domain/redis';

export interface RedisConfig {
  host: string;
  port: number;
  password?: string;
}

export class RedisService implements IRedisService {
  private client: Redis;

  constructor(config: RedisConfig) {
    this.client = new Redis({
      host: config.host,
      port: config.port,
      password: config.password,
      lazyConnect: true,
    });
  }

  async push(key: string, value: string): Promise<void> {
    await this.client.rpush(key, value);
  }

  async bpop(key: string, timeoutSeconds = 0): Promise<string | null> {
    const result = await this.client.blpop(key, timeoutSeconds);
    if (!result) return null;
    return result[1]; // [key, value]
  }

  async pop(key: string): Promise<string | null> {
    return this.client.lpop(key);
  }

  async len(key: string): Promise<number> {
    return this.client.llen(key);
  }

  async del(key: string): Promise<void> {
    await this.client.del(key);
  }

  async ping(): Promise<boolean> {
    try {
      const res = await this.client.ping();
      return res === 'PONG';
    } catch {
      return false;
    }
  }

  async quit(): Promise<void> {
    await this.client.quit();
  }
}
