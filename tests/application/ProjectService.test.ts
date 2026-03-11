import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProjectService } from '../../src/application/project/ProjectService';

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

// ── fixtures ──────────────────────────────────────────────────────────────────

const projectA = {
  name: 'project-a',
  channelId: 'C_AAA',
  tmuxSession: 'gemini',
  tmuxWindow: 'project-a',
};

const projectB = {
  name: 'project-b',
  channelId: 'C_BBB',
  tmuxSession: 'gemini',
  tmuxWindow: 'project-b',
};

// ── tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockFs._files.clear();
  vi.clearAllMocks();
});

describe('ProjectService', () => {
  describe('loadAll', () => {
    it('returns empty array when no projects file exists', async () => {
      const svc = new ProjectService();
      expect(await svc.loadAll()).toEqual([]);
    });
  });

  describe('add', () => {
    it('persists a new project', async () => {
      const svc = new ProjectService();
      await svc.add(projectA);

      const projects = await svc.loadAll();
      expect(projects).toHaveLength(1);
      expect(projects[0]).toEqual(projectA);
    });

    it('persists multiple projects', async () => {
      const svc = new ProjectService();
      await svc.add(projectA);
      await svc.add(projectB);

      const projects = await svc.loadAll();
      expect(projects).toHaveLength(2);
    });

    it('throws if project name already exists', async () => {
      const svc = new ProjectService();
      await svc.add(projectA);

      await expect(svc.add({ ...projectA, channelId: 'C_OTHER' }))
        .rejects.toThrow('already exists');
    });
  });

  describe('remove', () => {
    it('removes an existing project', async () => {
      const svc = new ProjectService();
      await svc.add(projectA);
      await svc.add(projectB);

      await svc.remove('project-a');

      const projects = await svc.loadAll();
      expect(projects).toHaveLength(1);
      expect(projects[0].name).toBe('project-b');
    });

    it('throws if project not found', async () => {
      const svc = new ProjectService();
      await expect(svc.remove('nonexistent')).rejects.toThrow('not found');
    });
  });

  describe('get', () => {
    it('returns project by name', async () => {
      const svc = new ProjectService();
      await svc.add(projectA);

      const found = await svc.get('project-a');
      expect(found).toEqual(projectA);
    });

    it('returns null if not found', async () => {
      const svc = new ProjectService();
      expect(await svc.get('nonexistent')).toBeNull();
    });
  });
});
