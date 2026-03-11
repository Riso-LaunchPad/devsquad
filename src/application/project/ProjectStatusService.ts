import * as fs from 'fs/promises';
import type { SlackService } from '../slack/SlackService';
import type { ProjectConfig } from './ProjectService';
import { TEAM_AGENTS } from '../daemon/TeamStatusService';
import { getProjectStatusPath, getDevsquadHome } from '../../utils/paths';

// ── Phase values ──────────────────────────────────────────────────────────────

export type OrchestratorPhase =
  | 'Listening'
  | 'Planning'
  | 'Delegating'
  | 'Waiting'
  | 'Reporting'
  | 'Offline'
  | 'Crashed'
  | string;

// ── Persisted state ───────────────────────────────────────────────────────────

export interface ProjectStatusState {
  channelId: string;
  messageTs: string;
  phase: OrchestratorPhase;
  task: string;                          // current task, "—" if idle
  error?: string;                        // set when phase is Crashed
  agentStatuses: Record<string, string>; // agentName → status label
}

// ── Service ───────────────────────────────────────────────────────────────────

export class ProjectStatusService {
  constructor(private readonly slack: SlackService) {}

  async post(project: ProjectConfig): Promise<string> {
    await fs.mkdir(getDevsquadHome(), { recursive: true });

    const initialAgentStatuses: Record<string, string> = {};
    for (const agent of TEAM_AGENTS) {
      initialAgentStatuses[agent.name] = 'Standby';
    }

    const state: ProjectStatusState = {
      channelId: project.channelId,
      messageTs: '',
      phase: 'Listening',
      task: '—',
      agentStatuses: initialAgentStatuses,
    };

    const result = await this.slack.send(project.channelId, buildMessage(state));
    state.messageTs = result.ts;
    await this.saveState(project.name, state);
    return result.ts;
  }

  async updateSession(
    project: ProjectConfig,
    patch: { phase?: OrchestratorPhase; task?: string; error?: string },
  ): Promise<void> {
    const state = await this.loadState(project.name);
    if (!state) return;

    if (patch.phase !== undefined) state.phase = patch.phase;
    if (patch.task  !== undefined) state.task  = patch.task;
    if (patch.error !== undefined) state.error = patch.error;
    if (patch.phase !== 'Crashed') delete state.error;

    await this.slack.edit(state.channelId, state.messageTs, buildMessage(state));
    await this.saveState(project.name, state);
  }

  async updateAgent(project: ProjectConfig, agentName: string, status: string): Promise<void> {
    const state = await this.loadState(project.name);
    if (!state) return;

    state.agentStatuses[agentName] = status;

    await this.slack.edit(state.channelId, state.messageTs, buildMessage(state));
    await this.saveState(project.name, state);
  }

  async removeState(projectName: string): Promise<void> {
    try {
      await fs.unlink(getProjectStatusPath(projectName));
    } catch {
      // file may not exist
    }
  }

  async loadState(projectName: string): Promise<ProjectStatusState | null> {
    try {
      const raw = await fs.readFile(getProjectStatusPath(projectName), 'utf-8');
      return JSON.parse(raw) as ProjectStatusState;
    } catch {
      return null;
    }
  }

  private async saveState(projectName: string, state: ProjectStatusState): Promise<void> {
    await fs.writeFile(getProjectStatusPath(projectName), JSON.stringify(state, null, 2), 'utf-8');
  }
}

// ── Message builder ───────────────────────────────────────────────────────────

const COL_AGENT  = 25;
const COL_ROLE   = 20;
const COL_STATUS = 16;

function pad(s: string, len: number): string {
  return s.length >= len ? s : s + ' '.repeat(len - s.length);
}

function buildMessage(state: ProjectStatusState): string {
  // ── Offline: title only ────────────────────────────────────────────────────
  if (state.phase === 'Offline') {
    return '*🔴 Orchestrator Offline*';
  }

  // ── Crashed: title + error subtitle ───────────────────────────────────────
  if (state.phase === 'Crashed') {
    return [
      '*⚠️ Orchestrator Crashed*',
      state.error ? `_${state.error}_` : '_Unexpected error — check daemon logs_',
    ].join('\n');
  }

  // ── Online: full message ───────────────────────────────────────────────────
  const sep = `${'─'.repeat(COL_AGENT)}┼${'─'.repeat(COL_ROLE)}┼${'─'.repeat(COL_STATUS)}`;

  const agentRows = TEAM_AGENTS.map(({ name, role }) => {
    const status = state.agentStatuses[name] ?? 'Standby';
    return `${pad(name, COL_AGENT)}│${pad(role, COL_ROLE)}│${agentEmoji(status)} ${status}`;
  });

  return [
    '*🟢 Orchestrator Online*',
    '',
    `*${phaseEmoji(state.phase)} ${state.phase}*`,
    `_${state.task}_`,
    '',
    '```',
    `${pad('Agent', COL_AGENT)}│${pad('Role', COL_ROLE)}│Status`,
    sep,
    ...agentRows,
    '```',
  ].join('\n');
}

function phaseEmoji(phase: OrchestratorPhase): string {
  switch (phase) {
    case 'Listening':  return '👂';
    case 'Planning':   return '🧠';
    case 'Delegating': return '📋';
    case 'Waiting':    return '⏳';
    case 'Reporting':  return '📢';
    default:           return '🔵';
  }
}

function agentEmoji(status: string): string {
  switch (status) {
    case 'Standby': return '⚪';
    case 'Working': return '🟡';
    case 'Done':    return '🟢';
    case 'Error':   return '🔴';
    default:        return '🔵';
  }
}
