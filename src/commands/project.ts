import * as path from 'path';
import { exec as execCb } from 'child_process';
import { promisify } from 'util';
import { Command } from 'commander';
import { SlackService } from '../application/slack/SlackService';
import { SlackBoltClient } from '../infra/slack/SlackBoltClient';
import { ProjectService } from '../application/project/ProjectService';
import { ProjectStatusService } from '../application/project/ProjectStatusService';
import { loadConfig } from '../utils/config';

const exec = promisify(execCb);
const svc = new ProjectService();

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

        // 4. Save project
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

        console.log('');
        console.log(`✅ Project "${name}" initialized`);
        console.log(`   Slack   : #${channel.name} (${channel.id})`);
        if (userIds.length > 0) console.log(`   Members : ${userIds.join(', ')}`);
        console.log(`   Tmux    : ${session}:${window}`);
        console.log(`   Queue   : queue:${name}`);
        console.log('');
        console.log('Next: devsquad daemon restart');
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

        // Update Slack status to Offline
        process.stdout.write('  Updating Slack status... ');
        const config = await loadConfig();
        const client = new SlackBoltClient(config.slack_bot_token!);
        const slack = new SlackService(client, null as never);
        const statusSvc = new ProjectStatusService(slack);
        await statusSvc.updateSession(projectConfig, { phase: 'Offline', task: '—' });
        console.log('✓');

        console.log(`\n✓ Project "${opts.name}" stopped`);
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

        // Remove from registry
        await svc.remove(opts.name);
        console.log(`\n✓ Project "${opts.name}" removed`);
      } catch (err: unknown) {
        console.error('Error:', err instanceof Error ? err.message : err);
        process.exit(1);
      }
    });

  // ── list ─────────────────────────────────────────────────────────────────────

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
