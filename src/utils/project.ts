import * as path from 'path';
import * as fs from 'fs/promises';
import { exec as execCb } from 'child_process';
import { promisify } from 'util';
import * as crypto from 'crypto';
import type { ProjectConfig } from '../application/project/ProjectService';

const exec = promisify(execCb);

export function resolveProjectName(
  name: string | undefined,
  cwd: string,
  projects: ProjectConfig[],
): string {
  const resolved = name ?? path.basename(cwd);
  const found = projects.find(p => p.name === resolved);
  if (!found) {
    throw new Error(
      `Project '${resolved}' not found. Run 'devsquad project list' to see registered projects.`,
    );
  }
  return resolved;
}

export const GITIGNORE_ENTRIES = [
  '# devsquad — orchestrator runtime files',
  'session/'
];

export interface ClaudeSessionOpts {
  sessionId: string;
  resume?: boolean;
}

export function buildClaudeCommand(opts: ClaudeSessionOpts): string {
  const flags = ['--dangerously-skip-permissions'];
  if (opts.resume) {
    flags.push('--resume', opts.sessionId);
  } else {
    flags.push('--session-id', opts.sessionId);
    flags.push("'start session'");
  }
  return `claude ${flags.join(' ')}`;
}

export async function ensureGitignore(dir: string): Promise<void> {
  const filePath = path.join(dir, '.gitignore');
  let existing = '';
  try {
    existing = await fs.readFile(filePath, 'utf-8');
  } catch {
    // file doesn't exist yet
  }
  const missing = GITIGNORE_ENTRIES.filter(e => !existing.includes(e));
  if (missing.length === 0) return;
  const separator = existing && !existing.endsWith('\n') ? '\n' : '';
  await fs.writeFile(filePath, existing + separator + missing.join('\n') + '\n', 'utf-8');
}

export async function startTmuxSession(session: string, window: string, opts: ClaudeSessionOpts): Promise<void> {
  const cmd = buildClaudeCommand(opts);
  try {
    await exec(`tmux has-session -t "${session}" 2>/dev/null`);
    // Session exists — ensure window exists
    try {
      const execCmd = `tmux new-window -t "${session}" -n "${window}" "${cmd}" 2>/dev/null`;
      console.log(`    → exec: ${execCmd}`);
      await exec(execCmd);
    } catch {
      // window may already exist
    }
  } catch {
    // Session does not exist — create it
    const execCmd = `tmux new-session -d -s "${session}" -n "${window}" "${cmd}"`;
    console.log(`    → exec: ${execCmd}`);
    await exec(execCmd);
  }
}

export function generateSessionId(): string {
  return crypto.randomUUID();
}
