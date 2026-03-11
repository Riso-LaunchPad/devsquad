import type { SlackService } from '../slack/SlackService';
import type { IRedisService } from '../../domain/redis';
import type { IncomingSlackMessage } from '../../domain/slack/ISlackSocket';

export interface ChannelBinding {
  channelId: string;
  project: string;
}

export class SlackListenerDaemon {
  private bindings = new Map<string, string>(); // channelId → project
  private running = false;

  constructor(
    private readonly slack: SlackService,
    private readonly redis: IRedisService,
  ) {}

  bind(channelId: string, project: string): void {
    this.bindings.set(channelId, project);
  }

  unbind(channelId: string): void {
    this.bindings.delete(channelId);
  }

  getBindings(): ChannelBinding[] {
    return Array.from(this.bindings.entries()).map(([channelId, project]) => ({
      channelId,
      project,
    }));
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    this.slack.onMessage(async (msg: IncomingSlackMessage) => {
      const project = this.bindings.get(msg.channel);
      if (!project) return;

      await this.redis.push(`queue:${project}`, JSON.stringify(msg));
    });

    await this.slack.start();
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;
    await this.slack.stop();
    await this.redis.quit();
  }

  isRunning(): boolean {
    return this.running;
  }
}
