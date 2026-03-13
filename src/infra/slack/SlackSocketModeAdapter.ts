import { SocketModeClient } from '@slack/socket-mode';
import { WebClient } from '@slack/web-api';
import { ISlackSocket, IncomingSlackMessage, MessageHandler } from '../../domain/slack';

/**
 * Infrastructure adapter: implements ISlackSocket using @slack/socket-mode directly.
 *
 * Uses SocketModeClient's built-in reconnection (auto-reconnect, heartbeat,
 * exponential backoff) instead of manual health checks.
 */
export class SlackSocketModeAdapter implements ISlackSocket {
  private socketClient: SocketModeClient;
  private webClient: WebClient;
  private connected = false;

  constructor(botToken: string, appToken: string) {
    this.webClient = new WebClient(botToken);
    this.socketClient = new SocketModeClient({
      appToken,
      // Built-in auto-reconnect — no manual health checks needed
    });
  }

  async connect(onMessage: MessageHandler): Promise<void> {
    // Connection lifecycle logging
    this.socketClient.on('connected', () => {
      this.connected = true;
      console.log('[SocketMode] connected');
    });

    this.socketClient.on('disconnected', () => {
      this.connected = false;
      console.log('[SocketMode] disconnected — will auto-reconnect');
    });

    this.socketClient.on('reconnecting', () => {
      console.log('[SocketMode] reconnecting...');
    });

    this.socketClient.on('unable_to_socket_mode_start', (err) => {
      console.error('[SocketMode] unable to start:', err);
    });

    // Handle Events API envelopes (which include message events)
    this.socketClient.on('slack_event', async ({ ack, body, retry_num, retry_reason }) => {
      // Acknowledge immediately to prevent Slack from retrying
      await ack();

      if (retry_num !== undefined) {
        console.log(`[SocketMode] received retry #${retry_num}, reason: ${retry_reason}`);
      }

      const event = body?.event;
      if (!event || event.type !== 'message') return;

      // Filter out bot/app messages
      if (event.bot_id || event.app_id) return;

      // Filter out subtypes (edits, deletes, joins, etc.) — only plain user messages
      if (event.subtype) return;

      const incoming: IncomingSlackMessage = {
        channel: event.channel,
        user: event.user ?? 'unknown',
        text: event.text ?? '',
        ts: event.ts,
        threadTs: event.thread_ts,
      };

      try {
        await onMessage(incoming);
      } catch (err) {
        console.error('[SocketMode] message handler error:', err);
      }
    });

    await this.socketClient.start();
    this.connected = true;
    console.log('[SocketMode] started');
  }

  async disconnect(): Promise<void> {
    await this.socketClient.disconnect();
    this.connected = false;
    console.log('[SocketMode] stopped');
  }

  isConnected(): boolean {
    return this.connected;
  }
}
