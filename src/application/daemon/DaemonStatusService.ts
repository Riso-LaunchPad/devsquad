import * as fs from 'fs/promises';
import type { SlackService } from '../slack/SlackService';
import { getDaemonStatePath, getDaemonShutdownFlagPath, getDevsquadHome } from '../../utils/paths';

export interface DaemonState {
  channelId: string;
  threadTs: string;
}

export class DaemonStatusService {
  private static readonly STATUS_CHANNEL = 'general';

  constructor(private readonly slack: SlackService) {}

  /**
   * Called at daemon startup.
   * - Detects crash vs clean restart vs first start
   * - Posts/replies to Slack status thread
   * - Clears shutdown flag
   */
  async onStart(): Promise<void> {
    await fs.mkdir(getDevsquadHome(), { recursive: true });

    const state = await this.loadState();
    const crashed = !(await this.hasShutdownFlag());
    const now = new Date().toLocaleString();

    if (!state) {
      // First start — create the status thread
      const result = await this.slack.send(
        DaemonStatusService.STATUS_CHANNEL,
        `🟢 *DevSquad Daemon started* — ${now}`,
      );
      await this.saveState({
        channelId: DaemonStatusService.STATUS_CHANNEL,
        threadTs: result.ts,
      });
    } else if (crashed) {
      // Previous session crashed
      await this.slack.reply(
        state.channelId,
        state.threadTs,
        `⚠️ *Daemon recovered from crash* — restarted at ${now}`,
      );
    } else {
      // Clean restart
      await this.slack.reply(
        state.channelId,
        state.threadTs,
        `🟢 *Daemon restarted* — ${now}`,
      );
    }

    // Clear shutdown flag — indicates we are running cleanly
    await this.clearShutdownFlag();
  }

  /**
   * Called at daemon clean shutdown.
   * Posts stop notice and writes shutdown flag.
   */
  async onStop(): Promise<void> {
    const state = await this.loadState();
    const now = new Date().toLocaleString();

    if (state) {
      await this.slack.reply(state.channelId, state.threadTs, `🔴 *Daemon stopped* — ${now}`);
    }

    await this.writeShutdownFlag();
  }

  private async loadState(): Promise<DaemonState | null> {
    try {
      const raw = await fs.readFile(getDaemonStatePath(), 'utf-8');
      return JSON.parse(raw) as DaemonState;
    } catch {
      return null;
    }
  }

  private async saveState(state: DaemonState): Promise<void> {
    await fs.writeFile(getDaemonStatePath(), JSON.stringify(state, null, 2), 'utf-8');
  }

  private async hasShutdownFlag(): Promise<boolean> {
    try {
      await fs.access(getDaemonShutdownFlagPath());
      return true;
    } catch {
      return false;
    }
  }

  private async writeShutdownFlag(): Promise<void> {
    await fs.writeFile(getDaemonShutdownFlagPath(), new Date().toISOString(), 'utf-8');
  }

  private async clearShutdownFlag(): Promise<void> {
    try {
      await fs.unlink(getDaemonShutdownFlagPath());
    } catch {
      // flag didn't exist — first start
    }
  }
}
