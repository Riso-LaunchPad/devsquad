import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TeamStatusService } from '../../src/application/daemon/TeamStatusService';
import { SlackService } from '../../src/application/slack/SlackService';
import { MockSlackClient } from '../mocks/MockSlackClient';
import { MockSlackSocket } from '../mocks/MockSlackSocket';
import { getTeamStatePath } from '../../src/utils/paths';
import type { DockerService, ContainerStatus } from '../../src/infra/docker/DockerService';
import type { AgentRegistryService, AgentDef } from '../../src/application/agent/AgentRegistryService';

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

// ── test agents ───────────────────────────────────────────────────────────────

const TEST_AGENTS: AgentDef[] = [
  { name: 'agent-claude-lead',      role: 'Tech Lead',          model: 'claude-sonnet-4-6' },
  { name: 'agent-gemini-manager',   role: 'Project Manager',    model: 'gemini-2.5-pro-preview' },
  { name: 'agent-gemini-architect', role: 'Solution Architect', model: 'gemini-2.5-pro-preview' },
  { name: 'agent-minimax-dev',      role: 'Developer',          model: 'MiniMax-M2.5' },
  { name: 'agent-claude-dev',       role: 'Developer',          model: 'claude-sonnet-4-6' },
  { name: 'agent-gemini-qa',        role: 'QC Analyst',         model: 'gemini-2.5-pro-preview' },
];

// ── mock docker ───────────────────────────────────────────────────────────────

function makeMockDocker(defaultStatus: ContainerStatus = 'running'): DockerService {
  const statuses: Record<string, ContainerStatus> = {};
  for (const agent of TEST_AGENTS) {
    statuses[agent.name] = defaultStatus;
  }
  return {
    getContainerStatus: vi.fn(async (name: string) => statuses[name] ?? 'unknown'),
    getStatuses: vi.fn(async (names: string[]) =>
      Object.fromEntries(names.map(n => [n, statuses[n] ?? 'unknown'])),
    ),
  } as unknown as DockerService;
}

// ── mock registry ─────────────────────────────────────────────────────────────

function makeMockRegistry(agents: AgentDef[] = TEST_AGENTS): AgentRegistryService {
  return {
    list: vi.fn().mockResolvedValue(agents),
    get: vi.fn(),
    add: vi.fn(),
    remove: vi.fn(),
    init: vi.fn(),
  } as unknown as AgentRegistryService;
}

// ── helpers ───────────────────────────────────────────────────────────────────

function makeService(channel = 'C_STATUS', dockerStatus: ContainerStatus = 'running') {
  const client = new MockSlackClient();
  const socket = new MockSlackSocket();
  const slack = new SlackService(client, socket);
  const docker = makeMockDocker(dockerStatus);
  const registry = makeMockRegistry();
  const svc = new TeamStatusService(slack, channel, docker, registry);
  return { svc, client };
}

// ── tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockFs._files.clear();
  vi.clearAllMocks();
});

describe('TeamStatusService', () => {
  describe('onStart — first start (no state)', () => {
    it('posts a team status table to the channel', async () => {
      const { svc, client } = makeService();
      await svc.onStart();

      expect(client.posted).toHaveLength(1);
      expect(client.posted[0].channel).toBe('C_STATUS');
      expect(client.posted[0].text).toContain('Team Status');
    });

    it('table contains all agents', async () => {
      const { svc, client } = makeService();
      await svc.onStart();

      const text = client.posted[0].text;
      for (const agent of TEST_AGENTS) {
        expect(text).toContain(agent.name);
      }
    });

    it('shows Online when containers are running', async () => {
      const { svc, client } = makeService('C_STATUS', 'running');
      await svc.onStart();

      expect(client.posted[0].text).toContain('Online');
    });

    it('shows Offline when containers are exited', async () => {
      const { svc, client } = makeService('C_STATUS', 'exited');
      await svc.onStart();

      expect(client.posted[0].text).toContain('Offline');
    });

    it('saves state with channelId, messageTs, and statuses', async () => {
      const { svc } = makeService();
      await svc.onStart();

      const stateFile = mockFs._files.get(getTeamStatePath());
      expect(stateFile).toBeDefined();
      const state = JSON.parse(stateFile!);
      expect(state.channelId).toBe('C_STATUS');
      expect(state.messageTs).toBeDefined();
      expect(state.statuses['agent-claude-lead']).toBe('running');
    });
  });

  describe('onStart — restart (state exists)', () => {
    it('edits the existing message with fresh docker statuses', async () => {
      const { svc, client } = makeService();

      await svc.onStart();
      const ts = client.posted[0].ts ?? 'ts_1';
      client.posted = [];

      await svc.onStart();

      expect(client.updated).toHaveLength(1);
      expect(client.updated[0].ts).toBe(ts);
    });
  });

  describe('refresh', () => {
    it('queries docker and edits message', async () => {
      const { svc, client } = makeService();
      await svc.onStart();
      const ts = client.posted[0].ts ?? 'ts_1';
      client.posted = [];

      await svc.refresh();

      expect(client.updated).toHaveLength(1);
      expect(client.updated[0].ts).toBe(ts);
    });

    it('does nothing if no state exists', async () => {
      const { svc, client } = makeService();
      await svc.refresh();

      expect(client.updated).toHaveLength(0);
    });
  });

  describe('updateAgent', () => {
    it('edits message with updated agent status', async () => {
      const { svc, client } = makeService();
      await svc.onStart();
      const ts = client.posted[0].ts ?? 'ts_1';
      client.posted = [];

      await svc.updateAgent('agent-minimax-dev', 'dead');

      expect(client.updated).toHaveLength(1);
      expect(client.updated[0].ts).toBe(ts);
      expect(client.updated[0].text).toContain('Crashed');
    });

    it('persists the updated status', async () => {
      const { svc } = makeService();
      await svc.onStart();

      await svc.updateAgent('agent-gemini-qa', 'exited');

      const statuses = await svc.getStatuses();
      expect(statuses?.['agent-gemini-qa']).toBe('exited');
    });

    it('does nothing if no state exists', async () => {
      const { svc, client } = makeService();
      await svc.updateAgent('agent-claude-lead', 'running');

      expect(client.updated).toHaveLength(0);
    });

    it('other agents remain unchanged after one update', async () => {
      const { svc } = makeService();
      await svc.onStart();

      await svc.updateAgent('agent-gemini-manager', 'dead');

      const statuses = await svc.getStatuses();
      expect(statuses?.['agent-claude-lead']).toBe('running');
      expect(statuses?.['agent-gemini-manager']).toBe('dead');
    });
  });

  describe('getStatuses', () => {
    it('returns null when no state', async () => {
      const { svc } = makeService();
      expect(await svc.getStatuses()).toBeNull();
    });

    it('returns current statuses after start', async () => {
      const { svc } = makeService();
      await svc.onStart();

      const statuses = await svc.getStatuses();
      expect(statuses).not.toBeNull();
      expect(Object.keys(statuses!)).toHaveLength(TEST_AGENTS.length);
    });
  });
});
