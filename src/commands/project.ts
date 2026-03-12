import * as path from 'path';
import * as fs from 'fs/promises';
import { exec as execCb } from 'child_process';
import { promisify } from 'util';
import { Command } from 'commander';
import { SlackService } from '../application/slack/SlackService';
import { SlackBoltClient } from '../infra/slack/SlackBoltClient';
import { ProjectService } from '../application/project/ProjectService';
import { ProjectStatusService } from '../application/project/ProjectStatusService';
import { LaunchDaemonManager } from '../infra/launchdaemon';
import { processorLabel } from './daemon';
import { DaemonStatusService } from '../application/daemon/DaemonStatusService';
import { loadConfig } from '../utils/config';

const exec = promisify(execCb);
const svc = new ProjectService();
const mgr = new LaunchDaemonManager();

const GITIGNORE_ENTRIES = [
  '# devsquad — orchestrator runtime files',
  'session/'
];

async function ensureGitignore(dir: string): Promise<void> {
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

export function projectCommand(program: Command): void {
  const project = program
    .command('project')
    .description('Manage projects (Slack channel ↔ tmux session mappings)');

  // ── init ────────────────────────────────────────────────────────────────────

  project
    .command('init')
    .description('Initialize a project: create Slack channel, start tmux session, register')
    .option('--name <name>', 'Project name (default: current directory name)')
    .option('--session <session>', 'tmux session name (default: project name)')
    .option('--window <window>', 'tmux window name', 'orchestrator')
    .option('--users <ids>', 'Comma-separated Slack user IDs to invite (overrides DEV_SQUAD_CORE_MEMBERS)')
    .action(async (opts) => {
      try {
        const config = await loadConfig();

        if (!config.slack_bot_token) {
          console.error('Missing Slack bot token. Run: devsquad config --bot-token ...');
          process.exit(1);
        }

        const name: string = opts.name ?? path.basename(process.cwd());
        const session: string = opts.session ?? name;
        const window: string = opts.window;

        // Resolve user IDs: --users flag > DEV_SQUAD_CORE_MEMBERS env var
        const userIds: string[] = opts.users
          ? opts.users.split(',').map((u: string) => u.trim()).filter(Boolean)
          : (process.env.DEV_SQUAD_CORE_MEMBERS ?? '')
              .split(',')
              .map((u: string) => u.trim())
              .filter(Boolean);

        console.log(`Initializing project "${name}"...`);

        // 1. Create Slack channel
        process.stdout.write('  Creating Slack channel... ');
        const client = new SlackBoltClient(config.slack_bot_token);
        const slack = new SlackService(client, null as never);
        const channel = await slack.ensureChannel(name);
        console.log(`✓ #${channel.name} (${channel.id})`);

        // 2. Invite users to channel
        if (userIds.length > 0) {
          process.stdout.write(`  Inviting ${userIds.length} member(s)... `);
          await slack.inviteUsers(channel.id, userIds);
          console.log('✓');
        }

        // 3. Start tmux session
        process.stdout.write(`  Starting tmux "${session}:${window}"... `);
        await startTmuxSession(session, window);
        console.log('✓');

        // 4. Update .gitignore in cwd
        await ensureGitignore(process.cwd());

        // 5. Save project
        const projectConfig = {
          name,
          channelId: channel.id,
          tmuxSession: session,
          tmuxWindow: window,
        };
        await svc.add(projectConfig);

        // 5. Post status message to Slack channel
        process.stdout.write('  Posting status to Slack... ');
        const statusSvc = new ProjectStatusService(slack);
        const statusTs = await statusSvc.post(projectConfig);
        await svc.update(name, { statusMessageTs: statusTs });
        console.log('✓');

        // 6. Install + start processor LaunchAgent
        process.stdout.write('  Starting processor daemon... ');
        const node = (await exec('which node')).stdout.trim();
        const bin = (await exec('which devsquad')).stdout.trim();
        const label = processorLabel(name);
        await mgr.install({
          label,
          program: node,
          args: [bin, '_run-processor', name],
          envVars: {
            PATH: '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin',
          },
          keepAlive: true,
        });
        await mgr.load(label);
        console.log('✓');

        // 7. Update daemon status message with new project list
        process.stdout.write('  Updating daemon status... ');
        try {
          const allProjects = await svc.loadAll();
          const config = await loadConfig();
          const daemonClient = new SlackBoltClient(config.slack_bot_token!);
          const daemonSlack = new SlackService(daemonClient, null as never);
          const daemonSvc = new DaemonStatusService(daemonSlack, config.slack_status_channel ?? 'general');
          await daemonSvc.update(allProjects.map(p => p.name));
          console.log('✓');
        } catch {
          console.log('(skipped)');
        }

        console.log('');
        console.log(`✅ Project "${name}" initialized`);
        console.log(`   Slack   : #${channel.name} (${channel.id})`);
        if (userIds.length > 0) console.log(`   Members : ${userIds.join(', ')}`);
        console.log(`   Tmux    : ${session}:${window}`);
        console.log(`   Queue   : queue:${name}`);
        console.log(`   Daemon  : ${label}`);
      } catch (err: unknown) {
        console.error('\nError:', err instanceof Error ? err.message : err);
        process.exit(1);
      }
    });

  // ── update (called by Orchestrator) ─────────────────────────────────────────

  project
    .command('update')
    .description('Update orchestrator phase and/or current task (called by Gemini Orchestrator)')
    .requiredOption('--name <name>', 'Project name')
    .option('--phase <phase>', 'Orchestrator phase: Listening|Planning|Delegating|Waiting|Reporting')
    .option('--task <text>', 'Current task description (use "—" to clear)')
    .action(async (opts) => {
      try {
        const projectConfig = await svc.get(opts.name);
        if (!projectConfig) {
          console.error(`Project "${opts.name}" not found`);
          process.exit(1);
        }

        const config = await loadConfig();
        const client = new SlackBoltClient(config.slack_bot_token!);
        const slack = new SlackService(client, null as never);
        const statusSvc = new ProjectStatusService(slack);

        await statusSvc.updateSession(projectConfig, {
          phase: opts.phase,
          task: opts.task,
        });

        console.log(`✓ Status updated`);
      } catch (err: unknown) {
        console.error('Error:', err instanceof Error ? err.message : err);
        process.exit(1);
      }
    });

  // ── agent (called by Orchestrator) ──────────────────────────────────────────

  project
    .command('agent')
    .description('Update an agent status in the project status message (called by Gemini Orchestrator)')
    .requiredOption('--name <name>', 'Project name')
    .requiredOption('--agent <agent>', 'Agent container name (e.g. agent-claude-lead)')
    .requiredOption('--status <status>', 'Status: Standby|Working|Done|Error')
    .action(async (opts) => {
      try {
        const projectConfig = await svc.get(opts.name);
        if (!projectConfig) {
          console.error(`Project "${opts.name}" not found`);
          process.exit(1);
        }

        const config = await loadConfig();
        const client = new SlackBoltClient(config.slack_bot_token!);
        const slack = new SlackService(client, null as never);
        const statusSvc = new ProjectStatusService(slack);

        await statusSvc.updateAgent(projectConfig, opts.agent, opts.status);

        console.log(`✓ ${opts.agent} → ${opts.status}`);
      } catch (err: unknown) {
        console.error('Error:', err instanceof Error ? err.message : err);
        process.exit(1);
      }
    });

  // ── stop ────────────────────────────────────────────────────────────────────

  project
    .command('stop')
    .description('Kill the tmux session and mark project as Offline in Slack')
    .option('--name <name>', 'Project name (default: current directory name)')
    .action(async (opts) => {
      try {
        const name: string = opts.name ?? require('path').basename(process.cwd());
        const projectConfig = await svc.get(name);
        if (!projectConfig) {
          console.error(`Project "${name}" not found`);
          process.exit(1);
        }

        // Kill tmux session
        process.stdout.write(`  Stopping tmux session "${projectConfig.tmuxSession}"... `);
        try {
          await exec(`tmux kill-session -t "${projectConfig.tmuxSession}"`);
          console.log('✓');
        } catch {
          console.log('(not running)');
        }

        // Update Slack status to Offline
        process.stdout.write('  Updating Slack status... ');
        const config = await loadConfig();
        const client = new SlackBoltClient(config.slack_bot_token!);
        const slack = new SlackService(client, null as never);
        const statusSvc = new ProjectStatusService(slack);
        await statusSvc.updateSession(projectConfig, { phase: 'Offline', task: '—' });
        console.log('✓');

        // Unload processor daemon (keep plist so it can be restarted)
        process.stdout.write('  Stopping processor daemon... ');
        try {
          await mgr.unload(processorLabel(name));
          console.log('✓');
        } catch {
          console.log('(skipped)');
        }

        console.log(`\n✓ Project "${name}" stopped`);
      } catch (err: unknown) {
        console.error('Error:', err instanceof Error ? err.message : err);
        process.exit(1);
      }
    });

  // ── resume ──────────────────────────────────────────────────────────────────

  project
    .command('resume')
    .description('Resume a stopped project: restart tmux session + processor daemon')
    .option('--name <name>', 'Project name (default: current directory name)')
    .option('--window <window>', 'tmux window name (default: project\'s configured window)')
    .action(async (opts) => {
      try {
        const name: string = opts.name ?? require('path').basename(process.cwd());
        const projectConfig = await svc.get(name);
        if (!projectConfig) {
          console.error(`Project "${name}" not found`);
          process.exit(1);
        }

        const window = opts.window ?? projectConfig.tmuxWindow;

        // Restart tmux session
        process.stdout.write(`  Starting tmux "${projectConfig.tmuxSession}:${window}"... `);
        await startTmuxSession(projectConfig.tmuxSession, window);
        console.log('✓');

        // Reload processor daemon
        process.stdout.write('  Starting processor daemon... ');
        await mgr.load(processorLabel(name));
        console.log('✓');

        // Update Slack status
        process.stdout.write('  Updating Slack status... ');
        const config = await loadConfig();
        const client = new SlackBoltClient(config.slack_bot_token!);
        const slack = new SlackService(client, null as never);
        const statusSvc = new ProjectStatusService(slack);
        await statusSvc.updateSession(projectConfig, { phase: 'Listening', task: '—' });
        console.log('✓');

        console.log(`\n✓ Project "${name}" resumed`);
      } catch (err: unknown) {
        console.error('Error:', err instanceof Error ? err.message : err);
        process.exit(1);
      }
    });

  // ── add ─────────────────────────────────────────────────────────────────────

  project
    .command('add')
    .description('Manually register a project (no channel/session creation)')
    .requiredOption('--name <name>', 'Project name (used as queue key)')
    .requiredOption('--channel <id>', 'Slack channel ID (e.g. C0AK5K4QGNA)')
    .requiredOption('--session <session>', 'tmux session name')
    .requiredOption('--window <window>', 'tmux window name')
    .action(async (opts) => {
      try {
        await svc.add({
          name: opts.name,
          channelId: opts.channel,
          tmuxSession: opts.session,
          tmuxWindow: opts.window,
        });
        console.log(`✓ Project "${opts.name}" added`);
      } catch (err: unknown) {
        console.error('Error:', err instanceof Error ? err.message : err);
        process.exit(1);
      }
    });

  // ── remove ───────────────────────────────────────────────────────────────────

  project
    .command('remove')
    .description('Remove a project and clean up tmux session and Slack status')
    .requiredOption('--name <name>', 'Project name')
    .action(async (opts) => {
      try {
        const projectConfig = await svc.get(opts.name);
        if (!projectConfig) {
          console.error(`Project "${opts.name}" not found`);
          process.exit(1);
        }

        // Kill tmux session
        process.stdout.write(`  Stopping tmux session "${projectConfig.tmuxSession}"... `);
        try {
          await exec(`tmux kill-session -t "${projectConfig.tmuxSession}"`);
          console.log('✓');
        } catch {
          console.log('(not running)');
        }

        // Archive Slack channel + remove state file
        process.stdout.write('  Archiving Slack channel... ');
        try {
          const config = await loadConfig();
          const client = new SlackBoltClient(config.slack_bot_token!);
          const slack = new SlackService(client, null as never);
          const statusSvc = new ProjectStatusService(slack);
          await statusSvc.removeState(opts.name);
          await slack.archiveChannel(projectConfig.channelId);
          console.log('✓');
        } catch {
          console.log('(skipped)');
        }

        // Unload + remove processor daemon
        process.stdout.write('  Removing processor daemon... ');
        try {
          await mgr.remove(processorLabel(opts.name));
          console.log('✓');
        } catch {
          console.log('(skipped)');
        }

        // Remove from registry
        await svc.remove(opts.name);

        // Update daemon status message with remaining projects
        process.stdout.write('  Updating daemon status... ');
        try {
          const remaining = await svc.loadAll();
          const config = await loadConfig();
          const daemonClient = new SlackBoltClient(config.slack_bot_token!);
          const daemonSlack = new SlackService(daemonClient, null as never);
          const daemonSvc = new DaemonStatusService(daemonSlack, config.slack_status_channel ?? 'general');
          await daemonSvc.update(remaining.map(p => p.name));
          console.log('✓');
        } catch {
          console.log('(skipped)');
        }

        console.log(`\n✓ Project "${opts.name}" removed`);
      } catch (err: unknown) {
        console.error('Error:', err instanceof Error ? err.message : err);
        process.exit(1);
      }
    });

  // ── list ─────────────────────────────────────────────────────────────────────

  project
    .command('config')
    .description('Show config and state for a project (reads ~/.devsquad files)')
    .option('--name <name>', 'Project name (default: current directory name)')
    .action(async (opts) => {
      const { getProjectsPath, getProjectStatusPath } = await import('../utils/paths');
      const { readFile } = await import('fs/promises');

      const name: string = opts.name ?? require('path').basename(process.cwd());
      const projectsRaw = await readFile(getProjectsPath(), 'utf-8').catch(() => '[]');
      const projects: Array<Record<string, unknown>> = JSON.parse(projectsRaw);
      const p = projects.find(x => x['name'] === name);
      if (!p) {
        console.error(`Project "${name}" not found in projects.json`);
        process.exit(1);
      }

      console.log('\n── Project config (' + getProjectsPath() + ') ──');
      console.log(JSON.stringify(p, null, 2));

      const statePath = getProjectStatusPath(name);
      const stateRaw = await readFile(statePath, 'utf-8').catch(() => null);
      if (stateRaw) {
        console.log('\n── Project state (' + statePath + ') ──');
        console.log(JSON.stringify(JSON.parse(stateRaw), null, 2));
      } else {
        console.log('\n── Project state ──\n(no state file found)');
      }
    });

  project
    .command('list')
    .description('List all registered projects')
    .action(async () => {
      const projects = await svc.loadAll();

      if (projects.length === 0) {
        console.log('No projects registered. Use: devsquad project init');
        return;
      }

      console.log(`${'Name'.padEnd(20)} ${'Channel'.padEnd(14)} Tmux Target`);
      console.log(`${'-'.repeat(20)} ${'-'.repeat(14)} ${'-'.repeat(30)}`);
      for (const p of projects) {
        console.log(`${p.name.padEnd(20)} ${p.channelId.padEnd(14)} ${p.tmuxSession}:${p.tmuxWindow}`);
      }
    });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function startTmuxSession(session: string, window: string): Promise<void> {
  try {
    await exec(`tmux has-session -t "${session}" 2>/dev/null`);
    // Session exists — ensure window exists
    try {
      await exec(`tmux new-window -t "${session}" -n "${window}" "gemini --yolo 'start session'" 2>/dev/null`);
    } catch {
      // window may already exist
    }
  } catch {
    // Session does not exist — create it
    await exec(`tmux new-session -d -s "${session}" -n "${window}" "gemini --yolo 'start session'"`);
  }
}
