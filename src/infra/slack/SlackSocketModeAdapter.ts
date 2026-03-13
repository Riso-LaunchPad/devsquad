import { SocketModeClient } from '@slack/socket-mode';
import { ISlackSocket, IncomingSlackMessage, MessageHandler } from '../../domain/slack';

function ts(): string {
  return new Date().toISOString();
}

/**
 * Infrastructure adapter: implements ISlackSocket using @slack/socket-mode directly.
 *
 * Uses SocketModeClient's built-in reconnection (auto-reconnect, heartbeat,
 * exponential backoff) instead of manual health checks.
 *
 * Includes a watchdog that forces reconnect if no real messages arrive
 * within WATCHDOG_TIMEOUT_MS, to recover from "zombie" connections where
 * the WebSocket stays alive but Slack stops delivering new messages.
 */
export class SlackSocketModeAdapter implements ISlackSocket {
  private socketClient: SocketModeClient;
  private connected = false;
  private lastRealMessageAt = Date.now();
  private watchdogTimer: ReturnType<typeof setInterval> | null = null;

  /** If no real (non-subtype) message arrives within this window, force reconnect */
  private static readonly WATCHDOG_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
  private static readonly WATCHDOG_CHECK_MS = 60 * 1000; // check every 60s

  constructor(_botToken: string, appToken: string) {
    this.socketClient = new SocketModeClient({
      appToken,
      autoReconnectEnabled: true,
      clientPingTimeout: 5_000,   // 5s — wait for pong from server
      serverPingTimeout: 15_000,  // 15s — expect ping from server (default 30s, tighter)
    });
  }

  async connect(onMessage: MessageHandler): Promise<void> {
    // Connection lifecycle logging
    this.socketClient.on('connected', () => {
      this.connected = true;
      this.lastRealMessageAt = Date.now(); // reset watchdog on fresh connection
      console.log(`[${ts()}] [SocketMode] connected`);
    });

    this.socketClient.on('disconnected', () => {
      this.connected = false;
      console.log(`[${ts()}] [SocketMode] disconnected — will auto-reconnect`);
    });

    this.socketClient.on('reconnecting', () => {
      console.log(`[${ts()}] [SocketMode] reconnecting...`);
    });

    this.socketClient.on('unable_to_socket_mode_start', (err) => {
      console.error(`[${ts()}] [SocketMode] unable to start:`, err);
    });

    // Single handler for ALL Slack events via the catch-all emitter.
    // We handle message routing here instead of listening on 'message'
    // to avoid potential conflicts with Node.js EventEmitter internals.
    this.socketClient.on('slack_event', async ({ ack, type, body, retry_num, retry_reason }) => {
      const evt = body?.event;

      // Log every envelope we receive
      console.log(`[${ts()}] [SocketMode] envelope: type=${type} event=${evt?.type ?? 'n/a'} subtype=${evt?.subtype ?? 'n/a'} channel=${evt?.channel ?? 'n/a'}`);

      // Ack immediately to prevent Slack retries
      await ack();

      // Only process message events from events_api envelopes
      if (type !== 'events_api' || !evt || evt.type !== 'message') return;

      if (retry_num !== undefined && retry_num > 0) {
        console.log(`[${ts()}] [SocketMode] retry #${retry_num}, reason: ${retry_reason}`);
      }

      // Filter out subtypes (edits, deletes, joins, etc.) — only plain user messages
      if (evt.subtype) return;

      // Filter out bot/app messages
      if (evt.bot_id || evt.app_id) {
        console.log(`[${ts()}] [SocketMode] bot message from ${evt.bot_id || evt.app_id}, skipping`);
        return;
      }

      // Real user message — reset watchdog
      this.lastRealMessageAt = Date.now();

      console.log(`[${ts()}] [SocketMode] message: channel=${evt.channel} user=${evt.user} text="${(evt.text ?? '').substring(0, 80)}"`);

      const incoming: IncomingSlackMessage = {
        channel: evt.channel,
        user: evt.user ?? 'unknown',
        text: evt.text ?? '',
        ts: evt.ts,
        threadTs: evt.thread_ts,
      };

      try {
        await onMessage(incoming);
        console.log(`[${ts()}] [SocketMode] → pushed to handler OK`);
      } catch (err) {
        console.error(`[${ts()}] [SocketMode] message handler error:`, err);
      }
    });

    await this.socketClient.start();
    this.connected = true;
    this.lastRealMessageAt = Date.now();
    console.log(`[${ts()}] [SocketMode] started`);

    // Start watchdog — force reconnect if no real messages for too long
    this.startWatchdog();
  }

  async disconnect(): Promise<void> {
    this.stopWatchdog();
    await this.socketClient.disconnect();
    this.connected = false;
    console.log(`[${ts()}] [SocketMode] stopped`);
  }

  isConnected(): boolean {
    return this.connected;
  }

  private startWatchdog(): void {
    this.watchdogTimer = setInterval(async () => {
      const silenceMs = Date.now() - this.lastRealMessageAt;
      const silenceSec = Math.round(silenceMs / 1000);

      if (silenceMs > SlackSocketModeAdapter.WATCHDOG_TIMEOUT_MS) {
        console.log(`[${ts()}] [SocketMode] watchdog: no real messages for ${silenceSec}s — forcing reconnect`);
        try {
          await this.socketClient.disconnect();
          // SocketModeClient auto-reconnect will kick in after disconnect
        } catch (err) {
          console.error(`[${ts()}] [SocketMode] watchdog reconnect error:`, err);
        }
      } else {
        console.log(`[${ts()}] [SocketMode] watchdog: OK (last real message ${silenceSec}s ago)`);
      }
    }, SlackSocketModeAdapter.WATCHDOG_CHECK_MS);
    this.watchdogTimer.unref?.();
  }

  private stopWatchdog(): void {
    if (this.watchdogTimer) {
      clearInterval(this.watchdogTimer);
      this.watchdogTimer = null;
    }
  }
}
