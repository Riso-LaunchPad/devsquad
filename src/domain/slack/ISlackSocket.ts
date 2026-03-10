/**
 * Port: Slack real-time connection (Socket Mode).
 * Emits incoming messages to a handler; infra manages the actual connection lifecycle.
 */
export interface IncomingSlackMessage {
  channel: string;
  user: string;
  text: string;
  ts: string;
  threadTs?: string;
}

export type MessageHandler = (msg: IncomingSlackMessage) => Promise<void>;

export interface ISlackSocket {
  /** Start listening for messages */
  connect(onMessage: MessageHandler): Promise<void>;

  /** Disconnect */
  disconnect(): Promise<void>;

  /** Whether the socket is currently connected */
  isConnected(): boolean;
}
