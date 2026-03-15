import * as fs from 'fs/promises';
import type { SlackService } from '../slack/SlackService';
import type { DockerService, ContainerStatus } from '../../infra/docker/DockerService';
import { getTeamStatePath, getDevsquadHome } from '../../utils/paths';

// ── Agent definitions (from Team Topology) ───────────────────────────────────

export interface AgentDef {
  name: string;
  role: string;
}

export const TEAM_AGENTS: AgentDef[] = [
  { name: 'agent-claude-lead',      role: 'Tech Lead' },
  { name: 'agent-gemini-manager',   role: 'Project Manager' },
  { name: 'agent-gemini-architect', role: 'Solution Architect' },
  { name: 'agent-minimax-dev',      role: 'Developer' },
  { name: 'agent-claude-dev',       role: 'Developer' },
  { name: 'agent-gemini-qa',        role: 'QC Analyst' },
];

// ── Persisted state ───────────────────────────────────────────────────────────

export interface TeamState {
  channelId: string;
  messageTs: string;
  statuses: Record<string, ContainerStatus>;
}

// ── Service ───────────────────────────────────────────────────────────────────

export class TeamStatusService {
  constructor(
    private readonly slack: SlackService,
    private readonly channel: string,
    private readonly docker: DockerService,
  ) {}

  /**
   * Query all containers, post or edit the status table.
   */
  async onStart(): Promise<void> {
    await fs.mkdir(getDevsquadHome(), { recursive: true });

    const statuses = await this.fetchStatuses();
    const state = await this.loadState();

    if (!state) {
      const result = await this.slack.send(this.channel, buildTable(statuses));
      await this.saveState({ channelId: this.channel, messageTs: result.ts, statuses });
    } else {
      await this.slack.edit(state.channelId, state.messageTs, buildTable(statuses));
      await this.saveState({ ...state, statuses });
    }
  }

  /**
   * Re-query all containers and edit the message in-place.
   */
  async refresh(): Promise<void> {
    const state = await this.loadState();
    if (!state) return;

    const statuses = await this.fetchStatuses();
    await this.slack.edit(state.channelId, state.messageTs, buildTable(statuses));
    await this.saveState({ ...state, statuses });
  }

  /**
   * Override a single agent's status (e.g. Working, Done) and edit in-place.
   * Does not query Docker — use refresh() to sync with real container state.
   */
  async updateAgent(agentName: string, status: ContainerStatus | string): Promise<void> {
    const state = await this.loadState();
    if (!state) return;

    const updated = { ...state.statuses, [agentName]: status as ContainerStatus };
    await this.slack.edit(state.channelId, state.messageTs, buildTable(updated));
    await this.saveState({ ...state, statuses: updated });
  }

  /**
   * Return current cached statuses without touching Slack or Docker.
   */
  async getStatuses(): Promise<Record<string, ContainerStatus> | null> {
    const state = await this.loadState();
    return state?.statuses ?? null;
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private async fetchStatuses(): Promise<Record<string, ContainerStatus>> {
    return this.docker.getStatuses(TEAM_AGENTS.map(a => a.name));
  }

  private async loadState(): Promise<TeamState | null> {
    try {
      const raw = await fs.readFile(getTeamStatePath(), 'utf-8');
      return JSON.parse(raw) as TeamState;
    } catch {
      return null;
    }
  }

  private async saveState(state: TeamState): Promise<void> {
    await fs.writeFile(getTeamStatePath(), JSON.stringify(state, null, 2), 'utf-8');
  }
}

// ── Table builder ─────────────────────────────────────────────────────────────

const COL_NAME   = 25;
const COL_ROLE   = 20;
const COL_STATUS = 14;

function pad(s: string, len: number): string {
  return s.length >= len ? s : s + ' '.repeat(len - s.length);
}

function buildTable(statuses: Record<string, ContainerStatus | string>): string {
  const sep = `${'─'.repeat(COL_NAME)}┼${'─'.repeat(COL_ROLE)}┼${'─'.repeat(COL_STATUS)}`;

  const header =
    `*DevSquad — Team Status*\n` +
    '```\n' +
    `${pad('Container', COL_NAME)}│${pad('Role', COL_ROLE)}│Status\n` +
    sep;

  const rows = TEAM_AGENTS.map(({ name, role }) => {
    const raw = statuses[name] ?? 'unknown';
    const label = `${statusEmoji(raw)} ${containerLabel(raw)}`;
    return `${pad(name, COL_NAME)}│${pad(role, COL_ROLE)}│${label}`;
  });

  return [header, ...rows, '```'].join('\n');
}

function containerLabel(status: string): string {
  switch (status) {
    case 'running':    return 'Online';
    case 'exited':     return 'Offline';
    case 'restarting': return 'Restarting';
    case 'dead':       return 'Crashed';
    case 'paused':     return 'Paused';
    case 'created':    return 'Starting';
    default:           return 'Unknown';
  }
}

function statusEmoji(status: string): string {
  switch (status) {
    case 'running':    return '🟢';
    case 'exited':     return '🔴';
    case 'restarting': return '🟡';
    case 'dead':       return '💀';
    case 'paused':     return '⏸';
    case 'created':    return '⚪';
    default:           return '⚫';
  }
}
