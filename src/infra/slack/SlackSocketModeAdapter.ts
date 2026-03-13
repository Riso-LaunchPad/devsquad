import { SocketModeClient } from '@slack/socket-mode';
import { ISlackSocket, IncomingSlackMessage, MessageHandler } from '../../domain/slack';

/**
 * Infrastructure adapter: implements ISlackSocket using @slack/socket-mode directly.
 *
 * Uses SocketModeClient's built-in reconnection (auto-reconnect, heartbeat,
 * exponential backoff) instead of manual health checks.
 */
export class SlackSocketModeAdapter implements ISlackSocket {
  private socketClient: SocketModeClient;
  private connected = false;

  constructor(_botToken: string, appToken: string) {
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

    // DEBUG: Log ALL events from SocketModeClient to see what Slack sends
    this.socketClient.on('slack_event', async ({ ack, type, body, retry_num }) => {
      const evt = body?.event;
      console.log('[SocketMode] raw_envelope:', JSON.stringify({
        envelope_type: type,
        event_type: evt?.type,
        subtype: evt?.subtype,
        channel: evt?.channel,
        user: evt?.user,
        bot_id: evt?.bot_id,
        text: evt?.text?.substring(0, 50),
        retry: retry_num,
      }));

      // Only ack here if nobody else handles it
      // (the 'message' listener below will ack message events)
      if (evt?.type !== 'message') {
        await ack();
      }
    });

    // Listen on 'message' — SocketModeClient emits event.payload.event.type
    // for events_api envelopes, so message events emit as 'message'.
    this.socketClient.on('message', async ({ ack, event, retry_num, retry_reason }) => {
      await ack();

      if (retry_num !== undefined && retry_num > 0) {
        console.log(`[SocketMode] retry #${retry_num}, reason: ${retry_reason}`);
      }

      console.log('[SocketMode] >>> message:', JSON.stringify({
        subtype: event?.subtype,
        channel: event?.channel,
        user: event?.user,
        bot_id: event?.bot_id,
        text: event?.text?.substring(0, 50),
      }));

      if (!event) return;

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
        console.log('[SocketMode] >>> pushed to handler OK');
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
