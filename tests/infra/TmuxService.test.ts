import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TmuxService } from '../../src/infra/tmux/TmuxService';

vi.mock('child_process', () => ({
  exec: vi.fn(),
}));

vi.mock('util', () => ({
  promisify: (fn: any) => fn,
}));

import { exec } from 'child_process';

const mockExec = exec as unknown as ReturnType<typeof vi.fn>;

const target = { session: 'devsquad', window: 'project-alpha' };

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
});

describe('TmuxService', () => {
  let svc: TmuxService;

  beforeEach(() => {
    svc = new TmuxService();
  });

  describe('hasSession', () => {
    it('returns true when session exists', async () => {
      mockExec.mockResolvedValueOnce({ stdout: '', stderr: '' });
      expect(await svc.hasSession('devsquad')).toBe(true);
      expect(mockExec).toHaveBeenCalledWith('tmux has-session -t devsquad');
    });

    it('returns false when session does not exist', async () => {
      mockExec.mockRejectedValueOnce(new Error('no server'));
      expect(await svc.hasSession('devsquad')).toBe(false);
    });
  });

  describe('ensureSession', () => {
    it('creates session if not exists', async () => {
      mockExec
        .mockRejectedValueOnce(new Error('no server')) // hasSession
        .mockResolvedValueOnce({ stdout: '', stderr: '' }); // new-session
      await svc.ensureSession('devsquad');
      expect(mockExec).toHaveBeenCalledWith('tmux new-session -d -s devsquad');
    });

    it('skips creation if session exists', async () => {
      mockExec.mockResolvedValueOnce({ stdout: '', stderr: '' }); // hasSession
      await svc.ensureSession('devsquad');
      expect(mockExec).toHaveBeenCalledTimes(1);
    });
  });

  describe('hasWindow', () => {
    it('returns true when window exists', async () => {
      mockExec.mockResolvedValueOnce({ stdout: 'project-alpha\nproject-beta\n', stderr: '' });
      expect(await svc.hasWindow(target)).toBe(true);
    });

    it('returns false when window not in list', async () => {
      mockExec.mockResolvedValueOnce({ stdout: 'project-beta\n', stderr: '' });
      expect(await svc.hasWindow(target)).toBe(false);
    });

    it('returns false on error', async () => {
      mockExec.mockRejectedValueOnce(new Error('no session'));
      expect(await svc.hasWindow(target)).toBe(false);
    });
  });

  describe('sendMessage', () => {
    it('sends text with -l flag, waits 1s, then sends Enter', async () => {
      mockExec.mockResolvedValue({ stdout: '', stderr: '' });

      const promise = svc.sendMessage(target, 'hello from slack');
      await vi.advanceTimersByTimeAsync(1000);
      await promise;

      expect(mockExec).toHaveBeenNthCalledWith(
        1,
        'tmux send-keys -t devsquad:project-alpha -l "hello from slack"'
      );
      expect(mockExec).toHaveBeenNthCalledWith(
        2,
        'tmux send-keys -t devsquad:project-alpha Enter'
      );
    });

    it('escapes double quotes in message', async () => {
      mockExec.mockResolvedValue({ stdout: '', stderr: '' });

      const promise = svc.sendMessage(target, 'say "hello"');
      await vi.advanceTimersByTimeAsync(1000);
      await promise;

      expect(mockExec).toHaveBeenNthCalledWith(
        1,
        'tmux send-keys -t devsquad:project-alpha -l "say \\"hello\\""'
      );
    });
  });

  describe('killWindow', () => {
    it('kills the target window', async () => {
      mockExec.mockResolvedValueOnce({ stdout: '', stderr: '' });
      await svc.killWindow(target);
      expect(mockExec).toHaveBeenCalledWith('tmux kill-window -t devsquad:project-alpha');
    });
  });

  describe('killSession', () => {
    it('kills the session', async () => {
      mockExec.mockResolvedValueOnce({ stdout: '', stderr: '' });
      await svc.killSession('devsquad');
      expect(mockExec).toHaveBeenCalledWith('tmux kill-session -t devsquad');
    });
  });

  describe('listWindows', () => {
    it('returns list of window names', async () => {
      mockExec.mockResolvedValueOnce({ stdout: 'project-alpha\nproject-beta\n', stderr: '' });
      expect(await svc.listWindows('devsquad')).toEqual(['project-alpha', 'project-beta']);
    });

    it('returns empty array on error', async () => {
      mockExec.mockRejectedValueOnce(new Error('no session'));
      expect(await svc.listWindows('devsquad')).toEqual([]);
    });
  });

  describe('listSessions', () => {
    it('returns list of session names', async () => {
      mockExec.mockResolvedValueOnce({ stdout: 'devsquad\nother\n', stderr: '' });
      expect(await svc.listSessions()).toEqual(['devsquad', 'other']);
    });

    it('returns empty array when no sessions', async () => {
      mockExec.mockRejectedValueOnce(new Error('no server'));
      expect(await svc.listSessions()).toEqual([]);
    });
  });
});
