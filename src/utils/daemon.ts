import { exec as execCb } from 'child_process';
import { promisify } from 'util';

const exec = promisify(execCb);

export const LISTENER_LABEL = 'com.devsquad.listener';

export function processorLabel(projectName: string): string {
  return `com.devsquad.processor.${projectName}`;
}

export async function getNodeBin(): Promise<string> {
  const { stdout } = await exec('which node');
  return stdout.trim();
}

export async function getDevsquadBin(): Promise<string> {
  const { stdout } = await exec('which devsquad');
  return stdout.trim();
}

/**
 * Kill any stale `_run-listener` processes that aren't managed by the
 * current launchd job. This prevents duplicate WebSocket connections
 * which cause Slack to split events across connections.
 */
export async function killStaleListeners(currentPid?: number): Promise<void> {
  try {
    const { stdout } = await exec("ps -eo pid,args | grep '_run-listener' | grep -v grep");
    for (const line of stdout.trim().split('\n')) {
      const pid = parseInt(line.trim().split(/\s+/)[0], 10);
      if (!pid || pid === currentPid) continue;
      try {
        process.kill(pid, 'SIGTERM');
        console.log(`  Killed stale listener process (PID ${pid})`);
      } catch { /* already dead */ }
    }
  } catch { /* no matching processes */ }
}
