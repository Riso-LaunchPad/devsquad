import { ISlackSocket, IncomingSlackMessage, MessageHandler } from '../../src/domain/slack';

export class MockSlackSocket implements ISlackSocket {
  private handler: MessageHandler | null = null;
  private connected = false;

  async connect(onMessage: MessageHandler): Promise<void> {
    this.handler = onMessage;
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    this.handler = null;
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  /** Simulate an incoming message from Slack */
  async simulateMessage(msg: IncomingSlackMessage): Promise<void> {
    if (this.handler) {
      await this.handler(msg);
    }
  }
}
