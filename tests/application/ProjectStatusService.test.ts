import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProjectStatusService } from '../../src/application/project/ProjectStatusService';
import { SlackService } from '../../src/application/slack/SlackService';
import { MockSlackClient } from '../mocks/MockSlackClient';
import { MockSlackSocket } from '../mocks/MockSlackSocket';
import { TEAM_AGENTS } from '../../src/application/daemon/TeamStatusService';
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
      for (const agent of TEAM_AGENTS) {
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
      expect(text.match(/Standby/g)?.length).toBe(TEAM_AGENTS.length);
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

      const state = await svc.loadState('test-project');
      expect(state?.agentStatuses['agent-minimax-dev']).toBe('Done');
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
});
