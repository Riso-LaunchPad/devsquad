import { App, SlackEventMiddlewareArgs, LogLevel } from '@slack/bolt';
import { ISlackSocket, IncomingSlackMessage, MessageHandler } from '../../domain/slack';

/**
 * Infrastructure adapter: implements ISlackSocket using @slack/bolt Socket Mode.
 */
export class SlackBoltSocket implements ISlackSocket {
  private app: App | null = null;
  private connected = false;
  private healthInterval: NodeJS.Timeout | null = null;

  constructor(
    private botToken: string,
    private appToken: string,
  ) {}

  async connect(onMessage: MessageHandler): Promise<void> {
    this.app = new App({
      token: this.botToken,
      appToken: this.appToken,
      socketMode: true,
      logLevel: LogLevel.WARN,
    });

    this.app.message(/.*/, async (args: SlackEventMiddlewareArgs<'message'>) => {
      const msg: any = args.message;
      if (!msg || msg.type !== 'message' || msg.bot_id || msg.app_id) return;

      const incoming: IncomingSlackMessage = {
        channel: msg.channel,
        user: msg.user ?? 'unknown',
        text: msg.text ?? '',
        ts: msg.ts,
        threadTs: msg.thread_ts,
      };

      await onMessage(incoming);
    });

    await this.app.start();
    this.connected = true;
    this.startHealthPing();
  }

  async disconnect(): Promise<void> {
    if (this.healthInterval) {
      clearInterval(this.healthInterval);
      this.healthInterval = null;
    }
    if (this.app) {
      await this.app.stop();
      this.connected = false;
      this.app = null;
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  private startHealthPing(): void {
    this.healthInterval = setInterval(async () => {
      try {
        const result = await (this.app!.client as any).api.test();
        if (!result.ok) this.connected = false;
      } catch {
        this.connected = false;
        try {
          await this.app!.stop();
          await this.app!.start();
          this.connected = true;
        } catch {
          // will retry next interval
        }
      }
    }, 900_000); // 15 min

    this.healthInterval.unref?.();
  }
}
