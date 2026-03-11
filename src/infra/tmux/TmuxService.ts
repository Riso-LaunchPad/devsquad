import { exec as execCb } from 'child_process';
import { promisify } from 'util';
import type { ITmuxService, TmuxTarget } from '../../domain/tmux';

const exec = promisify(execCb);

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export class TmuxService implements ITmuxService {
  private fmt(target: TmuxTarget): string {
    return `${target.session}:${target.window}`;
  }

  async hasSession(session: string): Promise<boolean> {
    try {
      await exec(`tmux has-session -t ${session}`);
      return true;
    } catch {
      return false;
    }
  }

  async ensureSession(session: string): Promise<void> {
    if (await this.hasSession(session)) return;
    await exec(`tmux new-session -d -s ${session}`);
  }

  async hasWindow(target: TmuxTarget): Promise<boolean> {
    try {
      const { stdout } = await exec(`tmux list-windows -t ${target.session} -F '#{window_name}'`);
      return stdout.split('\n').map(s => s.trim()).includes(target.window);
    } catch {
      return false;
    }
  }

  async createWindow(target: TmuxTarget, command?: string): Promise<void> {
    const cmd = `tmux new-window -t ${target.session} -n ${target.window}`;
    await exec(cmd);
    if (command) {
      await this.sendMessage(target, command);
    }
  }

  async ensureWindow(target: TmuxTarget, command?: string): Promise<void> {
    await this.ensureSession(target.session);
    if (await this.hasWindow(target)) return;
    await this.createWindow(target, command);
  }

  async sendMessage(target: TmuxTarget, message: string): Promise<void> {
    const escaped = message.replace(/"/g, '\\"');
    await exec(`tmux send-keys -t ${this.fmt(target)} -l "${escaped}"`);
    await sleep(1000);
    await exec(`tmux send-keys -t ${this.fmt(target)} Enter`);
  }

  async killWindow(target: TmuxTarget): Promise<void> {
    await exec(`tmux kill-window -t ${this.fmt(target)}`);
  }

  async killSession(session: string): Promise<void> {
    await exec(`tmux kill-session -t ${session}`);
  }

  async listWindows(session: string): Promise<string[]> {
    try {
      const { stdout } = await exec(`tmux list-windows -t ${session} -F '#{window_name}'`);
      return stdout.split('\n').map(s => s.trim()).filter(Boolean);
    } catch {
      return [];
    }
  }

  async listSessions(): Promise<string[]> {
    try {
      const { stdout } = await exec(`tmux list-sessions -F '#{session_name}'`);
      return stdout.split('\n').map(s => s.trim()).filter(Boolean);
    } catch {
      return [];
    }
  }
}
