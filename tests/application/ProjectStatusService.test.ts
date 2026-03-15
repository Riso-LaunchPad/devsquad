import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProjectStatusService } from '../../src/application/project/ProjectStatusService';
import { SlackService } from '../../src/application/slack/SlackService';
import { MockSlackClient } from '../mocks/MockSlackClient';
import { MockSlackSocket } from '../mocks/MockSlackSocket';
import { DEFAULT_AGENTS } from '../../src/application/agent/AgentRegistryService';
import { getProjectStatusPath } from '../../src/utils/paths';
import type { ProjectConfig } from '../../src/application/project/ProjectService';

// ── fs mock ───────────────────────────────────────────────────────────────────

type FsError = Error & { code?: string };

const mockFs = vi.hoisted(() => {
  const files = new Map<string, string>();
  return {
    _files: files,
    mkdir: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn().mockImplementation(async (path: string) => {
      if (files.has(path)) return files.get(path)!;
      const err: FsError = new Error('ENOENT');
      err.code = 'ENOENT';
      throw err;
    }),
    writeFile: vi.fn().mockImplementation(async (path: string, content: string) => {
      files.set(path, content);
    }),
  };
});

vi.mock('fs/promises', () => mockFs);

// ── helpers ───────────────────────────────────────────────────────────────────

const PROJECT: ProjectConfig = {
  name: 'test-project',
  channelId: 'C_TEST',
  tmuxSession: 'gemini',
  tmuxWindow: 'orchestrator',
};

const PROJECT_WITH_MODE: ProjectConfig = {
  name: 'test-project',
  channelId: 'C_TEST',
  tmuxSession: 'gemini',
  tmuxWindow: 'orchestrator',
  mode: 'autonomous',
};

function makeService() {
  const client = new MockSlackClient();
  const socket = new MockSlackSocket();
  const slack = new SlackService(client, socket);
  const svc = new ProjectStatusService(slack);
  return { svc, client };
}

// ── tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockFs._files.clear();
  vi.clearAllMocks();
});

describe('ProjectStatusService', () => {
  describe('post', () => {
    it('posts status message to project channel', async () => {
      const { svc, client } = makeService();
      await svc.post(PROJECT);

      expect(client.posted).toHaveLength(1);
      expect(client.posted[0].channel).toBe('C_TEST');
    });

    it('message shows Online title', async () => {
      const { svc, client } = makeService();
      await svc.post(PROJECT);

      expect(client.posted[0].text).toContain('Orchestrator Online');
    });

    it('message contains all 5 agents', async () => {
      const { svc, client } = makeService();
      await svc.post(PROJECT);

      const text = client.posted[0].text;
      for (const agent of DEFAULT_AGENTS) {
        expect(text).toContain(agent.name);
      }
    });

    it('initial phase is Listening', async () => {
      const { svc, client } = makeService();
      await svc.post(PROJECT);

      expect(client.posted[0].text).toContain('Listening');
    });

    it('all agents start as Standby', async () => {
      const { svc, client } = makeService();
      await svc.post(PROJECT);

      const text = client.posted[0].text;
      expect(text.match(/Standby/g)?.length).toBe(DEFAULT_AGENTS.length);
    });

    it('persists state with messageTs', async () => {
      const { svc, client } = makeService();
      await svc.post(PROJECT);

      const ts = client.posted[0].ts ?? 'ts_1';
      const raw = mockFs._files.get(getProjectStatusPath('test-project'));
      expect(raw).toBeDefined();
      const state = JSON.parse(raw!);
      expect(state.messageTs).toBe(ts);
      expect(state.channelId).toBe('C_TEST');
    });

    it('returns the message ts', async () => {
      const { svc, client } = makeService();
      const ts = await svc.post(PROJECT);

      expect(ts).toBe(client.posted[0].ts ?? 'ts_1');
    });
  });

  describe('updateSession', () => {
    it('edits message in-place with new phase', async () => {
      const { svc, client } = makeService();
      await svc.post(PROJECT);
      const ts = client.posted[0].ts ?? 'ts_1';
      client.posted = [];

      await svc.updateSession(PROJECT, { phase: 'Planning' });

      expect(client.updated).toHaveLength(1);
      expect(client.updated[0].ts).toBe(ts);
      expect(client.updated[0].text).toContain('Planning');
    });

    it('task rendered as italic subtitle', async () => {
      const { svc, client } = makeService();
      await svc.post(PROJECT);
      client.posted = [];

      await svc.updateSession(PROJECT, { task: 'Fix auth bug #123' });

      expect(client.updated[0].text).toContain('_Fix auth bug #123_');
    });

    it('Offline shows title and processor status', async () => {
      const { svc, client } = makeService();
      await svc.post(PROJECT);
      client.posted = [];

      await svc.updateSession(PROJECT, { phase: 'Offline' });

      const text = client.updated[0].text;
      expect(text).toContain('Orchestrator Offline');
      expect(text).toContain('Processor:');
      expect(text).not.toContain('agent-claude-lead');
      expect(text.trim().split('\n')).toHaveLength(2);
    });

    it('Crashed shows title and error subtitle', async () => {
      const { svc, client } = makeService();
      await svc.post(PROJECT);
      client.posted = [];

      await svc.updateSession(PROJECT, { phase: 'Crashed', error: 'tmux session not found' });

      const text = client.updated[0].text;
      expect(text).toContain('Orchestrator Crashed');
      expect(text).toContain('_tmux session not found_');
      expect(text).not.toContain('agent-claude-lead');
    });

    it('Crashed without error shows default fallback', async () => {
      const { svc, client } = makeService();
      await svc.post(PROJECT);
      client.posted = [];

      await svc.updateSession(PROJECT, { phase: 'Crashed' });

      expect(client.updated[0].text).toContain('_');
    });

    it('persists updated phase', async () => {
      const { svc } = makeService();
      await svc.post(PROJECT);

      await svc.updateSession(PROJECT, { phase: 'Waiting' });

      const state = await svc.loadState('test-project');
      expect(state?.phase).toBe('Waiting');
    });

    it('does nothing if no state exists', async () => {
      const { svc, client } = makeService();
      await svc.updateSession(PROJECT, { phase: 'Planning' });

      expect(client.updated).toHaveLength(0);
    });
  });

  describe('updateAgent', () => {
    it('edits message with updated agent status', async () => {
      const { svc, client } = makeService();
      await svc.post(PROJECT);
      const ts = client.posted[0].ts ?? 'ts_1';
      client.posted = [];

      await svc.updateAgent(PROJECT, 'agent-claude-lead', 'Working');

      expect(client.updated).toHaveLength(1);
      expect(client.updated[0].ts).toBe(ts);
      expect(client.updated[0].text).toContain('Working');
    });

    it('persists the updated agent status', async () => {
      const { svc } = makeService();
      await svc.post(PROJECT);

      await svc.updateAgent(PROJECT, 'agent-minimax-dev', 'Done');

      // 'Done' reverts to 'Standby' — agents cycle: Dead → Standby → Working → Standby
      const state = await svc.loadState('test-project');
      expect(state?.agentStatuses['agent-minimax-dev']).toBe('Standby');
    });

    it('other agents remain Standby after one update', async () => {
      const { svc } = makeService();
      await svc.post(PROJECT);

      await svc.updateAgent(PROJECT, 'agent-claude-lead', 'Working');

      const state = await svc.loadState('test-project');
      expect(state?.agentStatuses['agent-gemini-manager']).toBe('Standby');
    });

    it('does nothing if no state exists', async () => {
      const { svc, client } = makeService();
      await svc.updateAgent(PROJECT, 'agent-claude-lead', 'Working');

      expect(client.updated).toHaveLength(0);
    });
  });

  describe('updateProcessorStatus', () => {
    it('shows processor running by default after post', async () => {
      const { svc, client } = makeService();
      await svc.post(PROJECT);

      const text = client.posted[0].text;
      expect(text).toContain('● Processor: running');
    });

    it('updates message to stopped when processor stops', async () => {
      const { svc, client } = makeService();
      await svc.post(PROJECT);
      client.posted = [];

      await svc.updateProcessorStatus(PROJECT, 'stopped');

      expect(client.updated[0].text).toContain('○ Processor: stopped');
    });

    it('updates message back to running when processor resumes', async () => {
      const { svc, client } = makeService();
      await svc.post(PROJECT);
      await svc.updateProcessorStatus(PROJECT, 'stopped');
      client.updated = [];

      await svc.updateProcessorStatus(PROJECT, 'running');

      expect(client.updated[0].text).toContain('● Processor: running');
    });

    it('persists processorStatus in state', async () => {
      const { svc } = makeService();
      await svc.post(PROJECT);

      await svc.updateProcessorStatus(PROJECT, 'stopped');

      const state = await svc.loadState('test-project');
      expect(state?.processorStatus).toBe('stopped');
    });

    it('does nothing if no state exists', async () => {
      const { svc, client } = makeService();
      await svc.updateProcessorStatus(PROJECT, 'stopped');

      expect(client.updated).toHaveLength(0);
    });
  });

  describe('loadState', () => {
    it('returns null when no state file exists', async () => {
      const { svc } = makeService();
      expect(await svc.loadState('test-project')).toBeNull();
    });

    it('returns state after post', async () => {
      const { svc } = makeService();
      await svc.post(PROJECT);

      const state = await svc.loadState('test-project');
      expect(state).not.toBeNull();
      expect(state?.phase).toBe('Listening');
      expect(state?.task).toBe('—');
    });
  });

  // D1: --reason flag tests
  describe('updateAgent with reason', () => {
    it('stores reason when status is Error', async () => {
      const { svc } = makeService();
      await svc.post(PROJECT);

      await svc.updateAgent(PROJECT, 'agent-claude-lead', 'Error', 'exit 1');

      const state = await svc.loadState('test-project');
      expect(state?.agentReasons?.['agent-claude-lead']).toBe('exit 1');
    });

    it('shows error reason in Slack message', async () => {
      const { svc, client } = makeService();
      await svc.post(PROJECT);
      client.posted = [];

      await svc.updateAgent(PROJECT, 'agent-claude-lead', 'Error', 'exit 1');

      expect(client.updated[0].text).toContain('Error — exit 1');
    });

    it('caps reason at 30 characters in message', async () => {
      const { svc, client } = makeService();
      await svc.post(PROJECT);
      client.posted = [];

      const longReason = 'this is a very long error message that exceeds 30 chars';
      await svc.updateAgent(PROJECT, 'agent-claude-lead', 'Error', longReason);

      expect(client.updated[0].text).toContain('Error — this is a very long error');
      expect(client.updated[0].text).not.toContain(longReason);
    });

    it('clears reason when status transitions away from Error', async () => {
      const { svc } = makeService();
      await svc.post(PROJECT);

      await svc.updateAgent(PROJECT, 'agent-claude-lead', 'Error', 'exit 1');
      await svc.updateAgent(PROJECT, 'agent-claude-lead', 'Working');

      const state = await svc.loadState('test-project');
      expect(state?.agentReasons?.['agent-claude-lead']).toBeUndefined();
    });

    it('does not store reason for non-Error status', async () => {
      const { svc } = makeService();
      await svc.post(PROJECT);

      await svc.updateAgent(PROJECT, 'agent-claude-lead', 'Working', 'should be ignored');

      const state = await svc.loadState('test-project');
      expect(state?.agentReasons?.['agent-claude-lead']).toBeUndefined();
    });
  });

  // D5: updateSession with agentUpdate
  describe('updateSession with agentUpdate', () => {
    it('updates phase and agent in single slack.edit call', async () => {
      const { svc, client } = makeService();
      await svc.post(PROJECT);
      client.posted = [];

      await svc.updateSession(PROJECT, { phase: 'Delegating' }, { name: 'agent-claude-lead', status: 'Working' });

      expect(client.updated).toHaveLength(1);
      expect(client.updated[0].text).toContain('Delegating');
      expect(client.updated[0].text).toContain('Working');
    });

    it('persists agent status when using agentUpdate', async () => {
      const { svc } = makeService();
      await svc.post(PROJECT);

      await svc.updateSession(PROJECT, { phase: 'Delegating' }, { name: 'agent-claude-lead', status: 'Working' });

      const state = await svc.loadState('test-project');
      expect(state?.agentStatuses['agent-claude-lead']).toBe('Working');
    });

    it('stores reason when agentUpdate includes reason', async () => {
      const { svc } = makeService();
      await svc.post(PROJECT);

      await svc.updateSession(PROJECT, {}, { name: 'agent-claude-lead', status: 'Error', reason: 'crash' });

      const state = await svc.loadState('test-project');
      expect(state?.agentReasons?.['agent-claude-lead']).toBe('crash');
    });
  });

  // D5: updateBatch
  describe('updateBatch', () => {
    it('updates phase and task in one call', async () => {
      const { svc, client } = makeService();
      await svc.post(PROJECT);
      client.posted = [];

      await svc.updateBatch(PROJECT, { phase: 'Delegating', task: 'Implementing feature' });

      expect(client.updated).toHaveLength(1);
      expect(client.updated[0].text).toContain('Delegating');
      expect(client.updated[0].text).toContain('Implementing feature');
    });

    it('updates multiple agents at once', async () => {
      const { svc, client } = makeService();
      await svc.post(PROJECT);
      client.posted = [];

      await svc.updateBatch(PROJECT, {
        agents: {
          'agent-claude-lead': 'Working',
          'agent-gemini-manager': 'Working',
        },
      });

      expect(client.updated).toHaveLength(1);
      const text = client.updated[0].text;
      // Should have 2 Working statuses
      expect(text.match(/Working/g)?.length).toBeGreaterThanOrEqual(2);
    });

    it('does single slack.edit call for all changes', async () => {
      const { svc, client } = makeService();
      await svc.post(PROJECT);
      client.posted = [];

      await svc.updateBatch(PROJECT, {
        phase: 'Waiting',
        task: 'Review PR',
        agents: { 'agent-claude-lead': 'Working' },
      });

      expect(client.updated).toHaveLength(1);
    });

    it('persists all batch changes', async () => {
      const { svc } = makeService();
      await svc.post(PROJECT);

      await svc.updateBatch(PROJECT, {
        phase: 'Reporting',
        task: 'Final report',
        agents: { 'agent-claude-lead': 'Done' },
      });

      const state = await svc.loadState('test-project');
      expect(state?.phase).toBe('Reporting');
      expect(state?.task).toBe('Final report');
      // Done reverts to Standby
      expect(state?.agentStatuses['agent-claude-lead']).toBe('Standby');
    });

    it('does nothing if no state exists', async () => {
      const { svc, client } = makeService();
      await svc.updateBatch(PROJECT, { phase: 'Planning' });

      expect(client.updated).toHaveLength(0);
    });
  });

  // W1: Mode indicator tests
  describe('mode indicator', () => {
    it('shows mode indicator when mode is set to autonomous', async () => {
      const client = new MockSlackClient();
      const socket = new MockSlackSocket();
      const slack = new SlackService(client, socket);
      const svc = new ProjectStatusService(slack);

      await svc.post(PROJECT_WITH_MODE);

      expect(client.posted[0].text).toContain('| Mode: autonomous');
    });

    it('shows mode indicator when mode is set to supervised', async () => {
      const client = new MockSlackClient();
      const socket = new MockSlackSocket();
      const slack = new SlackService(client, socket);
      const svc = new ProjectStatusService(slack);

      await svc.post({ ...PROJECT_WITH_MODE, mode: 'supervised' });

      expect(client.posted[0].text).toContain('| Mode: supervised');
    });

    it('shows no mode indicator when mode is undefined', async () => {
      const { svc, client } = makeService();
      await svc.post(PROJECT);

      expect(client.posted[0].text).not.toContain('| Mode:');
    });

    it('shows mode indicator in updateSession', async () => {
      const client = new MockSlackClient();
      const socket = new MockSlackSocket();
      const slack = new SlackService(client, socket);
      const svc = new ProjectStatusService(slack);

      await svc.post(PROJECT_WITH_MODE);
      client.posted = [];

      await svc.updateSession(PROJECT_WITH_MODE, { phase: 'Planning' });

      expect(client.updated[0].text).toContain('| Mode: autonomous');
    });

    it('shows mode indicator in Offline state', async () => {
      const client = new MockSlackClient();
      const socket = new MockSlackSocket();
      const slack = new SlackService(client, socket);
      const svc = new ProjectStatusService(slack);

      await svc.post(PROJECT_WITH_MODE);
      client.posted = [];

      await svc.updateSession(PROJECT_WITH_MODE, { phase: 'Offline' });

      expect(client.updated[0].text).toContain('| Mode: autonomous');
    });
  });

  // W1: setApproveNext tests
  describe('setApproveNext', () => {
    it('sets approveNext flag to true', async () => {
      const { svc } = makeService();
      await svc.post(PROJECT);

      await svc.setApproveNext(PROJECT, true);

      const state = await svc.loadState('test-project');
      expect(state?.approveNext).toBe(true);
    });

    it('sets approveNext flag to false', async () => {
      const { svc } = makeService();
      await svc.post(PROJECT);
      await svc.setApproveNext(PROJECT, true);

      await svc.setApproveNext(PROJECT, false);

      const state = await svc.loadState('test-project');
      expect(state?.approveNext).toBe(false);
    });

    it('updates Slack message when setting approveNext', async () => {
      const { svc, client } = makeService();
      await svc.post(PROJECT);
      client.posted = [];

      await svc.setApproveNext(PROJECT, true);

      expect(client.updated).toHaveLength(1);
    });

    it('does nothing if no state exists', async () => {
      const { svc, client } = makeService();
      await svc.setApproveNext(PROJECT, true);

      expect(client.updated).toHaveLength(0);
    });
  });
});
