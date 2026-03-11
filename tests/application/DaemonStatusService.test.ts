import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DaemonStatusService } from '../../src/application/daemon/DaemonStatusService';
import { SlackService } from '../../src/application/slack/SlackService';
import { MockSlackClient } from '../mocks/MockSlackClient';
import { MockSlackSocket } from '../mocks/MockSlackSocket';
import { getDaemonShutdownFlagPath } from '../../src/utils/paths';

// ── fs mock ─────────────────────────────────────────────────────────────────

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
    access: vi.fn().mockImplementation(async (path: string) => {
      if (!files.has(path)) {
        const err: FsError = new Error('ENOENT');
        err.code = 'ENOENT';
        throw err;
      }
    }),
    unlink: vi.fn().mockImplementation(async (path: string) => {
      files.delete(path);
    }),
  };
});

vi.mock('fs/promises', () => mockFs);

// ── helpers ──────────────────────────────────────────────────────────────────

function makeService() {
  const client = new MockSlackClient();
  const socket = new MockSlackSocket();
  const slack = new SlackService(client, socket);
  const svc = new DaemonStatusService(slack);
  return { svc, client };
}

// ── tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockFs._files.clear();
  vi.clearAllMocks();
});

describe('DaemonStatusService', () => {
  describe('onStart — first start (no state, no shutdown flag)', () => {
    it('posts a new started message to #general', async () => {
      const { svc, client } = makeService();
      await svc.onStart();

      expect(client.posted).toHaveLength(1);
      expect(client.posted[0].channel).toBe('general');
      expect(client.posted[0].text).toContain('started');
      expect(client.posted[0].threadTs).toBeUndefined();
    });

    it('saves state with channel and threadTs', async () => {
      const { svc } = makeService();
      await svc.onStart();

      const stateFile = [...mockFs._files.entries()].find(([k]) =>
        k.includes('daemon-state.json'),
      );
      expect(stateFile).toBeDefined();
      const state = JSON.parse(stateFile![1]);
      expect(state.channelId).toBe('general');
      expect(state.threadTs).toBeDefined();
    });

    it('clears shutdown flag after start', async () => {
      const { svc } = makeService();
      // pre-set a shutdown flag at the real path
      mockFs._files.set(getDaemonShutdownFlagPath(), '2024-01-01');
      await svc.onStart();

      // should have been deleted
      const flagExists = [...mockFs._files.keys()].some(k => k.includes('daemon.shutdown'));
      expect(flagExists).toBe(false);
    });
  });

  describe('onStart — crash recovery (state exists, no shutdown flag)', () => {
    it('replies to thread with crash recovery message', async () => {
      const { svc, client } = makeService();

      // First start to create state
      await svc.onStart();
      const threadTs = client.posted[0].ts ?? `ts_1`;
      client.posted = [];

      // Simulate crash: no shutdown flag written
      // Second start
      await svc.onStart();

      expect(client.posted).toHaveLength(1);
      expect(client.posted[0].text).toContain('crash');
      expect(client.posted[0].threadTs).toBe(threadTs);
    });
  });

  describe('onStart — clean restart (state exists, shutdown flag exists)', () => {
    it('replies to thread with restarted message', async () => {
      const { svc, client } = makeService();

      // First start
      await svc.onStart();
      const threadTs = client.posted[0].ts ?? 'ts_1';
      client.posted = [];

      // Clean stop writes shutdown flag
      await svc.onStop();
      client.posted = [];

      // Restart
      await svc.onStart();

      expect(client.posted).toHaveLength(1);
      expect(client.posted[0].text).toContain('restarted');
      expect(client.posted[0].threadTs).toBe(threadTs);
    });
  });

  describe('onStop', () => {
    it('replies to thread with stopped message', async () => {
      const { svc, client } = makeService();
      await svc.onStart();
      const threadTs = client.posted[0].ts ?? 'ts_1';
      client.posted = [];

      await svc.onStop();

      expect(client.posted).toHaveLength(1);
      expect(client.posted[0].text).toContain('stopped');
      expect(client.posted[0].threadTs).toBe(threadTs);
    });

    it('writes shutdown flag', async () => {
      const { svc } = makeService();
      await svc.onStart();
      await svc.onStop();

      const flagExists = [...mockFs._files.keys()].some(k => k.includes('daemon.shutdown'));
      expect(flagExists).toBe(true);
    });

    it('does not throw if no state exists', async () => {
      const { svc } = makeService();
      await expect(svc.onStop()).resolves.not.toThrow();
    });
  });
});
