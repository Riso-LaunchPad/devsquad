import { Command } from 'commander';
import { LaunchDaemonManager } from '../infra/launchdaemon';
import { ProjectService } from '../application/project/ProjectService';
import { getLogPath } from '../utils/paths';
import { createReadStream } from 'fs';
import { exec as execCb } from 'child_process';
import { promisify } from 'util';

const exec = promisify(execCb);

const LISTENER_LABEL = 'com.devsquad.listener';

export function processorLabel(projectName: string): string {
  return `com.devsquad.processor.${projectName}`;
}

const mgr = new LaunchDaemonManager();

async function getNodeBin(): Promise<string> {
  const { stdout } = await exec('which node');
  return stdout.trim();
}

async function getDevsquadBin(): Promise<string> {
  const { stdout } = await exec('which devsquad');
  return stdout.trim();
}

export function daemonCommand(program: Command): void {
  const daemon = program
    .command('daemon')
    .description('Manage the devsquad background daemon');

  daemon
    .command('start')
    .description('Install and start the Slack listener daemon')
    .action(async () => {
      try {
        const node = await getNodeBin();
        const bin = await getDevsquadBin();

        await mgr.install({
          label: LISTENER_LABEL,
          program: node,
          args: [bin, '_run-listener'],
          envVars: {
            PATH: '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin',
          },
          keepAlive: true,
        });

        await mgr.load(LISTENER_LABEL);
        console.log(`✓ Listener started (${LISTENER_LABEL})`);
      } catch (err) {
        console.error('Failed to start daemon:', err);
        process.exit(1);
      }
    });

  daemon
    .command('stop')
    .description('Stop and unload the Slack listener daemon')
    .action(async () => {
      try {
        await mgr.unload(LISTENER_LABEL);
        console.log(`✓ Listener stopped`);
      } catch (err) {
        console.error('Failed to stop daemon:', err);
        process.exit(1);
      }
    });

  daemon
    .command('restart')
    .description('Restart the Slack listener daemon')
    .action(async () => {
      try {
        await mgr.restart(LISTENER_LABEL);
        console.log(`✓ Listener restarted`);
      } catch (err) {
        console.error('Failed to restart daemon:', err);
        process.exit(1);
      }
    });

  daemon
    .command('remove')
    .description('Stop and remove the listener daemon plist')
    .action(async () => {
      try {
        await mgr.remove(LISTENER_LABEL);
        console.log(`✓ Listener removed`);
      } catch (err) {
        console.error('Failed to remove daemon:', err);
        process.exit(1);
      }
    });

  daemon
    .command('status')
    .description('Show status of listener + all project processors')
    .action(async () => {
      const listenerStatus = await mgr.status(LISTENER_LABEL);
      if (listenerStatus.loaded) {
        const pid = listenerStatus.pid ? `PID ${listenerStatus.pid}` : 'not running';
        console.log(`● ${LISTENER_LABEL} — loaded (${pid})`);
      } else {
        console.log(`○ ${LISTENER_LABEL} — not loaded`);
      }

      const svc = new ProjectService();
      const projects = await svc.loadAll();
      for (const p of projects) {
        const label = processorLabel(p.name);
        const s = await mgr.status(label);
        if (s.loaded) {
          const pid = s.pid ? `PID ${s.pid}` : 'not running';
          console.log(`● ${label} — loaded (${pid})`);
        } else {
          console.log(`○ ${label} — not loaded`);
        }
      }
    });

  daemon
    .command('logs')
    .description('Tail the listener log (or processor log with --project <name>)')
    .option('--project <name>', 'Show logs for a specific project processor')
    .action((opts) => {
      const label = opts.project ? processorLabel(opts.project) : LISTENER_LABEL;
      const logPath = getLogPath(label);
      console.log(`Tailing ${logPath}\n`);
      const stream = createReadStream(logPath, { encoding: 'utf-8' });
      stream.on('error', () => console.error('No log file found. Has the daemon been started?'));
      stream.pipe(process.stdout);
    });
}
