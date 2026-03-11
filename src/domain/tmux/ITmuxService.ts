export interface TmuxTarget {
  session: string;
  window: string;
}

export interface ITmuxService {
  /** Check session exists */
  hasSession(session: string): Promise<boolean>;

  /** Create session if not exists */
  ensureSession(session: string): Promise<void>;

  /** Check window exists in session */
  hasWindow(target: TmuxTarget): Promise<boolean>;

  /** Create window in session, run command if provided */
  createWindow(target: TmuxTarget, command?: string): Promise<void>;

  /** Ensure window exists, create if not */
  ensureWindow(target: TmuxTarget, command?: string): Promise<void>;

  /** Send text + Enter to a window (with 1s sleep between) */
  sendMessage(target: TmuxTarget, message: string): Promise<void>;

  /** Kill window */
  killWindow(target: TmuxTarget): Promise<void>;

  /** Kill session */
  killSession(session: string): Promise<void>;

  /** List windows in session */
  listWindows(session: string): Promise<string[]>;

  /** List all sessions */
  listSessions(): Promise<string[]>;
}
