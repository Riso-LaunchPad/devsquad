import * as fs from 'fs/promises';
import type { SlackService } from '../slack/SlackService';
import type { ProjectConfig } from './ProjectService';
import { DEFAULT_AGENTS } from '../agent/AgentRegistryService';
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
  agentReasons?: Record<string, string>; // agentName → reason (for Error status)
  processorStatus: 'running' | 'stopped';
  approveNext?: boolean;                 // pre-authorize next auto-when-autonomous gate
}

// ── Service ───────────────────────────────────────────────────────────────────

export class ProjectStatusService {
  constructor(private readonly slack: SlackService) {}

  async post(project: ProjectConfig): Promise<string> {
    await fs.mkdir(getDevsquadHome(), { recursive: true });

    const initialAgentStatuses: Record<string, string> = {};
    for (const agent of DEFAULT_AGENTS) {
      initialAgentStatuses[agent.name] = 'Standby';
    }

    const state: ProjectStatusState = {
      channelId: project.channelId,
      messageTs: '',
      phase: 'Listening',
      task: '—',
      agentStatuses: initialAgentStatuses,
      processorStatus: 'running',
    };

    const result = await this.slack.send(project.channelId, buildMessage(state, project.mode));
    state.messageTs = result.ts;
    await this.saveState(project.name, state);
    return result.ts;
  }

  async updateSession(
    project: ProjectConfig,
    patch: { phase?: OrchestratorPhase; task?: string; error?: string },
    agentUpdate?: { name: string; status: string; reason?: string },
  ): Promise<void> {
    const state = await this.loadState(project.name);
    if (!state) return;

    if (patch.phase !== undefined) state.phase = patch.phase;
    if (patch.task  !== undefined) state.task  = patch.task;
    if (patch.error !== undefined) state.error = patch.error;
    if (patch.phase !== 'Crashed') delete state.error;

    // Apply agent update if provided (atomic - single slack.edit call)
    if (agentUpdate) {
      if (!state.agentReasons) {
        state.agentReasons = {};
      }
      const { name, status, reason } = agentUpdate;
      state.agentStatuses[name] = status === 'Done' ? 'Standby' : status;
      if (status === 'Error' && reason) {
        state.agentReasons[name] = reason;
      } else {
        delete state.agentReasons[name];
      }
    }

    await this.slack.edit(state.channelId, state.messageTs, buildMessage(state, project.mode));
    await this.saveState(project.name, state);
  }

  async updateAgent(project: ProjectConfig, agentName: string, status: string, reason?: string): Promise<void> {
    const state = await this.loadState(project.name);
    if (!state) return;

    // Initialize agentReasons if not present
    if (!state.agentReasons) {
      state.agentReasons = {};
    }

    // 'Done' reverts to Standby — agents cycle: Dead → Standby → Working → Standby
    state.agentStatuses[agentName] = status === 'Done' ? 'Standby' : status;

    // Store reason if status is Error and reason is provided
    if (status === 'Error' && reason) {
      state.agentReasons[agentName] = reason;
    } else {
      // Clear reason when status transitions away from Error
      delete state.agentReasons[agentName];
    }

    await this.slack.edit(state.channelId, state.messageTs, buildMessage(state, project.mode));
    await this.saveState(project.name, state);
  }

  async updateBatch(
    project: ProjectConfig,
    patch: { phase?: OrchestratorPhase; task?: string; agents?: Record<string, string> },
  ): Promise<void> {
    const state = await this.loadState(project.name);
    if (!state) return;

    if (patch.phase !== undefined) state.phase = patch.phase;
    if (patch.task !== undefined) state.task = patch.task;

    // Apply all agent status changes in one call
    if (patch.agents) {
      if (!state.agentReasons) {
        state.agentReasons = {};
      }
      for (const [agentName, status] of Object.entries(patch.agents)) {
        // 'Done' reverts to Standby
        state.agentStatuses[agentName] = status === 'Done' ? 'Standby' : status;
        // Clear any existing reason when status changes
        delete state.agentReasons[agentName];
      }
    }

    // Single slack.edit call for all changes
    await this.slack.edit(state.channelId, state.messageTs, buildMessage(state, project.mode));
    await this.saveState(project.name, state);
  }

  async updateProcessorStatus(project: ProjectConfig, status: 'running' | 'stopped'): Promise<void> {
    const state = await this.loadState(project.name);
    if (!state) return;

    state.processorStatus = status;
    await this.slack.edit(state.channelId, state.messageTs, buildMessage(state, project.mode));
    await this.saveState(project.name, state);
  }

  async setApproveNext(project: ProjectConfig, approveNext: boolean): Promise<void> {
    const state = await this.loadState(project.name);
    if (!state) return;

    state.approveNext = approveNext;
    await this.slack.edit(state.channelId, state.messageTs, buildMessage(state, project.mode));
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

function buildMessage(state: ProjectStatusState, mode?: 'autonomous' | 'supervised'): string {
  const processorLine = state.processorStatus === 'running'
    ? '_● Processor: running_'
    : '_○ Processor: stopped_';

  // Build mode indicator if mode is set
  const modeIndicator = mode ? ` | Mode: ${mode}` : '';

  // ── Offline: title + processor status ─────────────────────────────────────
  if (state.phase === 'Offline') {
    return [`*🔴 Orchestrator Offline*${modeIndicator}`, processorLine].join('\n');
  }

  // ── Crashed: title + error + processor status ──────────────────────────────
  if (state.phase === 'Crashed') {
    return [
      `*⚠️ Orchestrator Crashed*${modeIndicator}`,
      state.error ? `_${state.error}_` : '_Unexpected error — check daemon logs_',
      processorLine,
    ].join('\n');
  }

  // ── Online: full message ───────────────────────────────────────────────────
  const sep = `${'─'.repeat(COL_AGENT)}┼${'─'.repeat(COL_ROLE)}┼${'─'.repeat(COL_STATUS)}`;

  const agentRows = DEFAULT_AGENTS.map(({ name, role }) => {
    const status = state.agentStatuses[name] ?? 'Standby';
    const reason = state.agentReasons?.[name];
    const statusText = status === 'Error' && reason
      ? `Error — ${reason.slice(0, 30)}`
      : status;
    return `${pad(name, COL_AGENT)}│${pad(role, COL_ROLE)}│${agentEmoji(status)} ${statusText}`;
  });

  return [
    `*🟢 Orchestrator Online*${modeIndicator}`,
    processorLine,
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
    case 'Dead':    return '⚫';
    case 'Standby': return '⚪';
    case 'Working': return '🟡';
    case 'Error':   return '🔴';
    default:        return '⚪';
  }
}
