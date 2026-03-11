import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LaunchDaemonManager } from '../../src/infra/launchdaemon/LaunchDaemonManager';

const mockFs = vi.hoisted(() => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
  unlink: vi.fn().mockResolvedValue(undefined),
}));

const mockExec = vi.hoisted(() => vi.fn());

vi.mock('fs/promises', () => mockFs);
vi.mock('child_process', () => ({ exec: mockExec }));
vi.mock('util', () => ({ promisify: (fn: any) => fn }));

const def = {
  label: 'com.devsquad.listener',
  program: '/usr/local/bin/node',
  args: ['/Users/binn/.devsquad/bin/listener.js'],
  envVars: { SLACK_BOT_TOKEN: 'xoxb-test' },
};

beforeEach(() => vi.clearAllMocks());

describe('LaunchDaemonManager', () => {
  let mgr: LaunchDaemonManager;
  beforeEach(() => { mgr = new LaunchDaemonManager(); });

  describe('install', () => {
    it('creates logs dir and writes plist', async () => {
      await mgr.install(def);
      expect(mockFs.mkdir).toHaveBeenCalledWith(expect.stringContaining('logs'), { recursive: true });
      expect(mockFs.writeFile).toHaveBeenCalledWith(
        expect.stringContaining('com.devsquad.listener.plist'),
        expect.stringContaining('<string>com.devsquad.listener</string>'),
        'utf-8',
      );
    });

    it('includes program and args in plist', async () => {
      await mgr.install(def);
      const plist = mockFs.writeFile.mock.calls[0][1] as string;
      expect(plist).toContain('/usr/local/bin/node');
      expect(plist).toContain('/Users/binn/.devsquad/bin/listener.js');
    });

    it('includes env vars in plist', async () => {
      await mgr.install(def);
      const plist = mockFs.writeFile.mock.calls[0][1] as string;
      expect(plist).toContain('SLACK_BOT_TOKEN');
      expect(plist).toContain('xoxb-test');
    });

    it('sets KeepAlive true by default', async () => {
      await mgr.install(def);
      const plist = mockFs.writeFile.mock.calls[0][1] as string;
      expect(plist).toContain('<key>KeepAlive</key>\n\t<true/>');
    });

    it('sets KeepAlive false when specified', async () => {
      await mgr.install({ ...def, keepAlive: false });
      const plist = mockFs.writeFile.mock.calls[0][1] as string;
      expect(plist).toContain('<key>KeepAlive</key>\n\t<false/>');
    });

    it('includes stdout/stderr log paths', async () => {
      await mgr.install(def);
      const plist = mockFs.writeFile.mock.calls[0][1] as string;
      expect(plist).toContain('com.devsquad.listener.log');
    });
  });

  describe('load', () => {
    it('calls launchctl load', async () => {
      mockExec.mockResolvedValueOnce({ stdout: '', stderr: '' });
      await mgr.load('com.devsquad.listener');
      expect(mockExec).toHaveBeenCalledWith(
        expect.stringContaining('launchctl load -w'),
      );
    });
  });

  describe('unload', () => {
    it('calls launchctl unload', async () => {
      mockExec.mockResolvedValueOnce({ stdout: '', stderr: '' });
      await mgr.unload('com.devsquad.listener');
      expect(mockExec).toHaveBeenCalledWith(
        expect.stringContaining('launchctl unload -w'),
      );
    });

    it('does not throw if already unloaded', async () => {
      mockExec.mockRejectedValueOnce(new Error('not loaded'));
      await expect(mgr.unload('com.devsquad.listener')).resolves.not.toThrow();
    });
  });

  describe('remove', () => {
    it('unloads and deletes plist', async () => {
      mockExec.mockResolvedValueOnce({ stdout: '', stderr: '' }); // unload
      await mgr.remove('com.devsquad.listener');
      expect(mockExec).toHaveBeenCalledWith(expect.stringContaining('launchctl unload'));
      expect(mockFs.unlink).toHaveBeenCalledWith(expect.stringContaining('com.devsquad.listener.plist'));
    });
  });

  describe('status', () => {
    it('returns loaded=true with pid when running', async () => {
      mockExec.mockResolvedValueOnce({ stdout: '1234\t0\tcom.devsquad.listener\n', stderr: '' });
      const result = await mgr.status('com.devsquad.listener');
      expect(result.loaded).toBe(true);
      expect(result.pid).toBe(1234);
    });

    it('returns loaded=true with no pid when not running', async () => {
      mockExec.mockResolvedValueOnce({ stdout: '-\t0\tcom.devsquad.listener\n', stderr: '' });
      const result = await mgr.status('com.devsquad.listener');
      expect(result.loaded).toBe(true);
      expect(result.pid).toBeUndefined();
    });

    it('returns loaded=false when not found', async () => {
      mockExec.mockRejectedValueOnce(new Error('not found'));
      const result = await mgr.status('com.devsquad.listener');
      expect(result.loaded).toBe(false);
    });
  });

  describe('restart', () => {
    it('unloads then loads', async () => {
      mockExec
        .mockResolvedValueOnce({ stdout: '', stderr: '' }) // unload
        .mockResolvedValueOnce({ stdout: '', stderr: '' }); // load
      await mgr.restart('com.devsquad.listener');
      expect(mockExec).toHaveBeenCalledTimes(2);
      expect(mockExec.mock.calls[0][0]).toContain('unload');
      expect(mockExec.mock.calls[1][0]).toContain('load');
    });
  });
});
