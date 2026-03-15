import * as path from 'path';
import * as os from 'os';

export function getDevsquadHome(): string {
  return path.join(os.homedir(), '.devsquad');
}

export function getConfigPath(): string {
  return path.join(getDevsquadHome(), 'config.json');
}

export function getLaunchAgentsDir(): string {
  return path.join(os.homedir(), 'Library', 'LaunchAgents');
}

export function getPlistPath(label: string): string {
  return path.join(getLaunchAgentsDir(), `${label}.plist`);
}

export function getLogsDir(): string {
  return path.join(getDevsquadHome(), 'logs');
}

export function getLogPath(label: string): string {
  return path.join(getLogsDir(), `${label}.log`);
}

export function getDaemonStatePath(): string {
  return path.join(getDevsquadHome(), 'daemon-state.json');
}

export function getDaemonShutdownFlagPath(): string {
  return path.join(getDevsquadHome(), 'daemon.shutdown');
}

export function getTeamStatePath(): string {
  return path.join(getDevsquadHome(), 'team-state.json');
}

export function getProjectsPath(): string {
  return path.join(getDevsquadHome(), 'projects.json');
}

export function getAgentsPath(): string {
  return path.join(getDevsquadHome(), 'agents.json');
}

export function getProjectStatusPath(name: string): string {
  return path.join(getDevsquadHome(), `project-${name}.state.json`);
}

export function getSessionDir(): string {
  return path.join(process.cwd(), 'session');
}

export function getAuditLogPath(): string {
  return path.join(getSessionDir(), 'audit.log');
}
