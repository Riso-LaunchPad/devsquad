import type { ITmuxService, TmuxTarget } from '../../src/domain/tmux';

export class MockTmuxService implements ITmuxService {
  sent: { target: TmuxTarget; message: string }[] = [];
  windows = new Map<string, Set<string>>(); // session → Set<window>

  async hasSession(session: string): Promise<boolean> {
    return this.windows.has(session);
  }

  async ensureSession(session: string): Promise<void> {
    if (!this.windows.has(session)) this.windows.set(session, new Set());
  }

  async hasWindow(target: TmuxTarget): Promise<boolean> {
    return this.windows.get(target.session)?.has(target.window) ?? false;
  }

  async createWindow(target: TmuxTarget, command?: string): Promise<void> {
    await this.ensureSession(target.session);
    this.windows.get(target.session)!.add(target.window);
    if (command) await this.sendMessage(target, command);
  }

  async ensureWindow(target: TmuxTarget, command?: string): Promise<void> {
    if (await this.hasWindow(target)) return;
    await this.createWindow(target, command);
  }

  async sendMessage(target: TmuxTarget, message: string): Promise<void> {
    this.sent.push({ target, message });
  }

  async killWindow(target: TmuxTarget): Promise<void> {
    this.windows.get(target.session)?.delete(target.window);
  }

  async killSession(session: string): Promise<void> {
    this.windows.delete(session);
  }

  async listWindows(session: string): Promise<string[]> {
    return [...(this.windows.get(session) ?? [])];
  }

  async listSessions(): Promise<string[]> {
    return [...this.windows.keys()];
  }
}
