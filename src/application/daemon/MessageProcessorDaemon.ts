import type { IRedisService } from '../../domain/redis';
import type { ITmuxService, TmuxTarget } from '../../domain/tmux';
import type { IncomingSlackMessage } from '../../domain/slack/ISlackSocket';

export interface ProcessorConfig {
  project: string;
  target: TmuxTarget;
}

export class MessageProcessorDaemon {
  private running = false;
  private loopPromise: Promise<void> | null = null;

  constructor(
    private readonly config: ProcessorConfig,
    private readonly redis: IRedisService,
    private readonly tmux: ITmuxService,
  ) {}

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.loopPromise = this.loop();
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;
    await this.redis.quit();
    // loopPromise will exit on next bpop timeout — no need to await
  }

  isRunning(): boolean {
    return this.running;
  }

  private async loop(): Promise<void> {
    const key = `queue:${this.config.project}`;

    while (this.running) {
      try {
        const raw = await this.redis.bpop(key, 5); // 5s timeout to allow clean stop
        if (!raw) continue;

        const msg = JSON.parse(raw) as IncomingSlackMessage;
        const formatted = this.format(msg);
        await this.tmux.sendMessage(this.config.target, formatted);
      } catch {
        // continue loop on error
      }
    }
  }

  private format(msg: IncomingSlackMessage): string {
    const thread = msg.threadTs ? ` [thread:${msg.threadTs}]` : '';
    return `[Slack #${msg.channel} | @${msg.user}]${thread}: ${msg.text}`;
  }
}
