import { Command } from 'commander';
import { LaunchDaemonManager } from '../infra/launchdaemon';
import { getLogPath } from '../utils/paths';
import { createReadStream } from 'fs';
import { exec as execCb } from 'child_process';
import { promisify } from 'util';

const exec = promisify(execCb);

const LISTENER_LABEL = 'com.devsquad.listener';

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
        console.log(`✓ Daemon started (${LISTENER_LABEL})`);
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
        console.log(`✓ Daemon stopped`);
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
        console.log(`✓ Daemon restarted`);
      } catch (err) {
        console.error('Failed to restart daemon:', err);
        process.exit(1);
      }
    });

  daemon
    .command('remove')
    .description('Stop and remove the daemon plist')
    .action(async () => {
      try {
        await mgr.remove(LISTENER_LABEL);
        console.log(`✓ Daemon removed`);
      } catch (err) {
        console.error('Failed to remove daemon:', err);
        process.exit(1);
      }
    });

  daemon
    .command('status')
    .description('Show daemon status')
    .action(async () => {
      const s = await mgr.status(LISTENER_LABEL);
      if (s.loaded) {
        const pid = s.pid ? `PID ${s.pid}` : 'not running';
        console.log(`● ${LISTENER_LABEL} — loaded (${pid})`);
      } else {
        console.log(`○ ${LISTENER_LABEL} — not loaded`);
      }
    });

  daemon
    .command('logs')
    .description('Tail the daemon log file')
    .action(() => {
      const logPath = getLogPath(LISTENER_LABEL);
      console.log(`Tailing ${logPath}\n`);
      const stream = createReadStream(logPath, { encoding: 'utf-8' });
      stream.on('error', () => console.error('No log file found. Has the daemon been started?'));
      stream.pipe(process.stdout);
    });
}
