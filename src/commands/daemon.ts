import { Command } from 'commander';
import { LaunchDaemonManager } from '../infra/launchdaemon';
import { ProjectService } from '../application/project/ProjectService';
import { getLogPath } from '../utils/paths';
import { createReadStream } from 'fs';
import { exec as execCb } from 'child_process';
import { promisify } from 'util';
import { LISTENER_LABEL, processorLabel, getNodeBin, getDevsquadBin, killStaleListeners } from '../utils/daemon';

const exec = promisify(execCb);

const mgr = new LaunchDaemonManager();

async function ensureListenerRunning(): Promise<void> {
  const status = await mgr.status(LISTENER_LABEL);
  if (status.loaded && status.pid) {
    await killStaleListeners(status.pid);
    return;
  }

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
  console.log(`  ● Listener started (${LISTENER_LABEL})`);
}

async function startProcessor(projectName: string): Promise<void> {
  const node = await getNodeBin();
  const bin = await getDevsquadBin();
  const label = processorLabel(projectName);
  await mgr.install({
    label,
    program: node,
    args: [bin, '_run-processor', projectName],
    envVars: {
      PATH: '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin',
    },
    keepAlive: true,
  });
  await mgr.load(label);
  console.log(`  ● Processor started (${label})`);
}

export function daemonCommand(program: Command): void {
  const daemon = program
    .command('daemon')
    .description('Manage the devsquad background daemons');

  // ── start ─────────────────────────────────────────────────────

  daemon
    .command('start')
    .description('Start daemons. Without --name: starts listener + all processors. With --name: starts that processor (and listener if needed).')
    .option('--name <project>', 'Start processor for a specific project')
    .action(async (opts) => {
      try {
        if (opts.name) {
          // Start single project processor (ensure listener is running)
          await ensureListenerRunning();
          await startProcessor(opts.name);
          console.log(`✓ Project "${opts.name}" daemon started`);
        } else {
          // Start listener + all processors
          await ensureListenerRunning();
          const svc = new ProjectService();
          const projects = await svc.loadAll();
          for (const p of projects) {
            const label = processorLabel(p.name);
            const s = await mgr.status(label);
            if (!s.loaded || !s.pid) {
              await startProcessor(p.name);
            }
          }
          console.log(`✓ All daemons started (listener + ${projects.length} processor(s))`);
        }
      } catch (err) {
        console.error('Failed to start daemon:', err);
        process.exit(1);
      }
    });

  // ── stop ──────────────────────────────────────────────────────

  daemon
    .command('stop')
    .description('Stop daemons. Without --name: stops everything. With --name: stops that processor only.')
    .option('--name <project>', 'Stop processor for a specific project')
    .action(async (opts) => {
      try {
        if (opts.name) {
          // Stop single project processor
          const label = processorLabel(opts.name);
          await mgr.unload(label);
          console.log(`✓ Processor "${opts.name}" stopped`);
        } else {
          // Stop all processors then listener
          const svc = new ProjectService();
          const projects = await svc.loadAll();
          for (const p of projects) {
            try {
              await mgr.unload(processorLabel(p.name));
              console.log(`  ○ Processor "${p.name}" stopped`);
            } catch { /* may not be loaded */ }
          }
          try {
            await mgr.unload(LISTENER_LABEL);
            console.log(`  ○ Listener stopped`);
          } catch { /* may not be loaded */ }
          console.log('✓ All daemons stopped');
        }
      } catch (err) {
        console.error('Failed to stop daemon:', err);
        process.exit(1);
      }
    });

  // ── restart ───────────────────────────────────────────────────

  daemon
    .command('restart')
    .description('Restart daemons. Without --name: restarts listener + all processors. With --name: restarts that processor.')
    .option('--name <project>', 'Restart processor for a specific project')
    .action(async (opts) => {
      try {
        if (opts.name) {
          const label = processorLabel(opts.name);
          await mgr.restart(label);
          console.log(`✓ Processor "${opts.name}" restarted`);
        } else {
          // Kill stale listeners before restart to avoid duplicate connections
          await killStaleListeners();

          // Restart listener
          await mgr.restart(LISTENER_LABEL);
          console.log('  ● Listener restarted');

          // Restart all processors
          const svc = new ProjectService();
          const projects = await svc.loadAll();
          for (const p of projects) {
            try {
              await mgr.restart(processorLabel(p.name));
              console.log(`  ● Processor "${p.name}" restarted`);
            } catch { /* may not be loaded */ }
          }
          console.log('✓ All daemons restarted');
        }
      } catch (err) {
        console.error('Failed to restart daemon:', err);
        process.exit(1);
      }
    });

  // ── remove ────────────────────────────────────────────────────

  daemon
    .command('remove')
    .description('Stop and remove daemon plists. Without --name: removes everything. With --name: removes that processor.')
    .option('--name <project>', 'Remove processor for a specific project')
    .action(async (opts) => {
      try {
        if (opts.name) {
          await mgr.remove(processorLabel(opts.name));
          console.log(`✓ Processor "${opts.name}" removed`);
        } else {
          const svc = new ProjectService();
          const projects = await svc.loadAll();
          for (const p of projects) {
            try {
              await mgr.remove(processorLabel(p.name));
              console.log(`  ○ Processor "${p.name}" removed`);
            } catch { /* may not exist */ }
          }
          await mgr.remove(LISTENER_LABEL);
          console.log(`  ○ Listener removed`);
          console.log('✓ All daemons removed');
        }
      } catch (err) {
        console.error('Failed to remove daemon:', err);
        process.exit(1);
      }
    });

  // ── status ────────────────────────────────────────────────────

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

  // ── logs ──────────────────────────────────────────────────────

  daemon
    .command('logs')
    .description('Tail daemon logs. Without --name: listener logs. With --name: processor logs.')
    .option('--name <project>', 'Show logs for a specific project processor')
    .action((opts) => {
      const label = opts.name ? processorLabel(opts.name) : LISTENER_LABEL;
      const logPath = getLogPath(label);
      console.log(`Tailing ${logPath}\n`);
      const stream = createReadStream(logPath, { encoding: 'utf-8' });
      stream.on('error', () => console.error('No log file found. Has the daemon been started?'));
      stream.pipe(process.stdout);
    });
}
