import * as fs from 'fs/promises';
import type { SlackService } from '../slack/SlackService';
import { getDaemonStatePath, getDaemonShutdownFlagPath, getDevsquadHome } from '../../utils/paths';

export interface DaemonState {
  channelId: string;
  threadTs: string;
}

export class DaemonStatusService {
  private readonly statusChannel: string;

  constructor(
    private readonly slack: SlackService,
    statusChannel: string,
  ) {
    this.statusChannel = statusChannel;
  }

  /**
   * Called at daemon startup.
   * - Detects crash vs clean restart vs first start
   * - Posts/replies to Slack status thread
   * - Clears shutdown flag
   */
  async onStart(projects: string[] = []): Promise<void> {
    await fs.mkdir(getDevsquadHome(), { recursive: true });

    const state = await this.loadState();
    const crashed = !(await this.hasShutdownFlag());
    const now = new Date().toLocaleString();
    const subtitle = buildSubtitle(projects);

    if (!state) {
      // First start — create the status thread
      const result = await this.slack.send(
        this.statusChannel,
        `🟢 *DevSquad Daemon started* — ${now}\n${subtitle}`,
      );
      await this.saveState({
        channelId: this.statusChannel,
        threadTs: result.ts,
      });
    } else if (crashed) {
      await this.slack.edit(
        state.channelId,
        state.threadTs,
        `⚠️ *Daemon recovered from crash* — restarted at ${now}\n${subtitle}`,
      );
    } else {
      await this.slack.edit(
        state.channelId,
        state.threadTs,
        `🟢 *Daemon restarted* — ${now}\n${subtitle}`,
      );
    }

    // Clear shutdown flag — indicates we are running cleanly
    await this.clearShutdownFlag();
  }

  /**
   * Called at daemon clean shutdown.
   * Posts stop notice and writes shutdown flag.
   */
  async onStop(projects: string[] = []): Promise<void> {
    const state = await this.loadState();
    const now = new Date().toLocaleString();

    if (state) {
      const subtitle = buildSubtitle(projects);
      await this.slack.edit(state.channelId, state.threadTs, `🔴 *Daemon stopped* — ${now}\n${subtitle}`);
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

function buildSubtitle(projects: string[]): string {
  const listenerStatus = '● Listener: running';
  if (projects.length === 0) {
    return `_${listenerStatus} | Processors: none_`;
  }
  const processorList = projects.map(p => `● ${p}`).join(', ');
  return `_${listenerStatus} | Processors: ${processorList}_`;
}
