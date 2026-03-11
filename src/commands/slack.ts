import { Command } from 'commander';
import { SlackService } from '../application/slack/SlackService';
import { SlackBoltClient } from '../infra/slack/SlackBoltClient';
import { ProjectService } from '../application/project/ProjectService';
import { loadConfig } from '../utils/config';

function buildSlack(botToken: string): SlackService {
  return new SlackService(new SlackBoltClient(botToken), null as never);
}

async function resolveChannel(channelArg: string | undefined, projectArg: string | undefined): Promise<string> {
  if (channelArg) return channelArg;

  const name = projectArg ?? require('path').basename(process.cwd());
  const svc = new ProjectService();
  const project = await svc.get(name);
  if (!project) throw new Error(`Project "${name}" not found`);
  return project.channelId;
}

export function slackCommand(program: Command): void {
  const slack = program
    .command('slack')
    .description('Send messages to Slack channels');

  // ── send ────────────────────────────────────────────────────────────────────

  slack
    .command('send <message>')
    .description('Send a message to a channel')
    .option('--channel <id>', 'Slack channel ID')
    .option('--project <name>', 'Project name (uses project channel, default: current directory)')
    .action(async (message: string, opts) => {
      try {
        const config = await loadConfig();
        const channelId = await resolveChannel(opts.channel, opts.project);
        const svc = buildSlack(config.slack_bot_token!);
        const result = await svc.send(channelId, message);
        console.log(`✓ Sent (ts: ${result.ts})`);
      } catch (err: unknown) {
        console.error('Error:', err instanceof Error ? err.message : err);
        process.exit(1);
      }
    });

  // ── reply ───────────────────────────────────────────────────────────────────

  slack
    .command('reply <threadTs> <message>')
    .description('Reply to a thread')
    .option('--channel <id>', 'Slack channel ID')
    .option('--project <name>', 'Project name (uses project channel, default: current directory)')
    .action(async (threadTs: string, message: string, opts) => {
      try {
        const config = await loadConfig();
        const channelId = await resolveChannel(opts.channel, opts.project);
        const svc = buildSlack(config.slack_bot_token!);
        const result = await svc.reply(channelId, threadTs, message);
        console.log(`✓ Replied (ts: ${result.ts})`);
      } catch (err: unknown) {
        console.error('Error:', err instanceof Error ? err.message : err);
        process.exit(1);
      }
    });
}
