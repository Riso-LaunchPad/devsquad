import { App, SlackEventMiddlewareArgs, LogLevel } from '@slack/bolt';
import { ISlackSocket, IncomingSlackMessage, MessageHandler } from '../../domain/slack';

/**
 * Infrastructure adapter: implements ISlackSocket using @slack/bolt Socket Mode.
 */
export class SlackBoltSocket implements ISlackSocket {
  private app: App | null = null;
  private connected = false;
  private healthInterval: NodeJS.Timeout | null = null;
  private reconnectAttempts = 0;
  private onMessage: MessageHandler | null = null;

  private static readonly HEALTH_INTERVAL_MS = 30_000;
  private static readonly MAX_RECONNECT_ATTEMPTS = 5;

  constructor(
    private botToken: string,
    private appToken: string,
  ) {}

  async connect(onMessage: MessageHandler): Promise<void> {
    this.onMessage = onMessage;
    await this.createApp();
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

  /**
   * Creates a fresh App instance with all handlers registered.
   * Must be called for initial connect AND every reconnect,
   * because app.stop()+app.start() does not reliably restore
   * Socket Mode event subscriptions.
   */
  private async createApp(): Promise<void> {
    // Clean up previous instance
    if (this.app) {
      try { await this.app.stop(); } catch { /* ignore */ }
      this.app = null;
    }

    this.app = new App({
      token: this.botToken,
      appToken: this.appToken,
      socketMode: true,
      logLevel: LogLevel.WARN,
    });

    // Global error handler to prevent silent failures
    this.app.error(async (error) => {
      console.error('[SlackBoltSocket] app.error:', error);
    });

    this.app.message(/.*/, async (args: SlackEventMiddlewareArgs<'message'>) => {
      const msg: any = args.message;
      console.log('[SlackBoltSocket] raw event:', JSON.stringify({ type: msg?.type, bot_id: msg?.bot_id, app_id: msg?.app_id, channel: msg?.channel, user: msg?.user }));
      if (!msg || msg.type !== 'message' || msg.bot_id || msg.app_id) return;

      const incoming: IncomingSlackMessage = {
        channel: msg.channel,
        user: msg.user ?? 'unknown',
        text: msg.text ?? '',
        ts: msg.ts,
        threadTs: msg.thread_ts,
      };

      try {
        await this.onMessage!(incoming);
      } catch (err) {
        console.error('[SlackBoltSocket] message handler error (message dropped):', err);
      }
    });

    await this.app.start();
    this.connected = true;
    this.reconnectAttempts = 0;
    console.log('[SlackBoltSocket] connected via Socket Mode');
  }

  private startHealthPing(): void {
    this.healthInterval = setInterval(async () => {
      try {
        const result = await (this.app!.client as any).api.test();
        if (!result.ok) throw new Error('api.test returned not ok');
        this.reconnectAttempts = 0;
      } catch (err) {
        this.connected = false;
        console.error('[SlackBoltSocket] health check failed:', err instanceof Error ? err.message : err);
        await this.attemptReconnect();
      }
    }, SlackBoltSocket.HEALTH_INTERVAL_MS);

    this.healthInterval.unref?.();
  }

  private async attemptReconnect(): Promise<void> {
    this.reconnectAttempts++;

    if (this.reconnectAttempts > SlackBoltSocket.MAX_RECONNECT_ATTEMPTS) {
      console.error(`[SlackBoltSocket] exceeded ${SlackBoltSocket.MAX_RECONNECT_ATTEMPTS} reconnect attempts, exiting for LaunchAgent restart`);
      process.exit(1);
    }

    // Exponential backoff: 2s, 4s, 8s, 16s, 32s
    const delayMs = Math.min(2000 * Math.pow(2, this.reconnectAttempts - 1), 32_000);
    console.log(`[SlackBoltSocket] reconnect attempt ${this.reconnectAttempts}/${SlackBoltSocket.MAX_RECONNECT_ATTEMPTS} in ${delayMs}ms...`);
    await this.sleep(delayMs);

    try {
      // Create entirely new App instance — app.stop()+app.start() loses Socket Mode subscriptions
      await this.createApp();
      console.log('[SlackBoltSocket] reconnected successfully');
    } catch (err) {
      console.error('[SlackBoltSocket] reconnect failed:', err);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
