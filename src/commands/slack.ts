import { Command } from 'commander';
import * as fs from 'fs/promises';
import * as path from 'path';
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

  // ── react ───────────────────────────────────────────────────────────────────

  slack
    .command('react <ts> <emoji>')
    .description('Add a reaction to a message')
    .option('--channel <id>', 'Slack channel ID')
    .option('--project <name>', 'Project name (uses project channel, default: current directory)')
    .action(async (ts: string, emoji: string, opts) => {
      try {
        const config = await loadConfig();
        const channelId = await resolveChannel(opts.channel, opts.project);
        const svc = buildSlack(config.slack_bot_token!);
        await svc.react(channelId, ts, emoji);
        console.log(`✓ Reacted :${emoji}:`);
      } catch (err: unknown) {
        console.error('Error:', err instanceof Error ? err.message : err);
        process.exit(1);
      }
    });

  // ── unreact ─────────────────────────────────────────────────────────────────

  slack
    .command('unreact <ts> <emoji>')
    .description('Remove a reaction from a message')
    .option('--channel <id>', 'Slack channel ID')
    .option('--project <name>', 'Project name (uses project channel, default: current directory)')
    .action(async (ts: string, emoji: string, opts) => {
      try {
        const config = await loadConfig();
        const channelId = await resolveChannel(opts.channel, opts.project);
        const svc = buildSlack(config.slack_bot_token!);
        await svc.unreact(channelId, ts, emoji);
        console.log(`✓ Unreacted :${emoji}:`);
      } catch (err: unknown) {
        console.error('Error:', err instanceof Error ? err.message : err);
        process.exit(1);
      }
    });

  // ── upload ──────────────────────────────────────────────────────────────────

  slack
    .command('upload <filepath>')
    .description('Upload a file to a channel')
    .requiredOption('--thread <ts>', 'Thread timestamp to upload to')
    .option('--channel <id>', 'Slack channel ID')
    .option('--project <name>', 'Project name (uses project channel, default: current directory)')
    .option('--title <title>', 'File title')
    .option('--comment <text>', 'Comment to post after upload')
    .action(async (filepath: string, opts) => {
      try {
        const config = await loadConfig();
        const channelId = await resolveChannel(opts.channel, opts.project);

        // Validate file exists
        try {
          await fs.access(filepath);
        } catch {
          console.error(`Error: File not found: ${filepath}`);
          process.exit(1);
        }

        // Check file size and warn if > 5MB
        const stats = await fs.stat(filepath);
        const SIZE_WARNING_THRESHOLD = 5 * 1024 * 1024; // 5MB
        if (stats.size > SIZE_WARNING_THRESHOLD) {
          console.warn(`⚠️ Warning: File is ${(stats.size / 1024 / 1024).toFixed(2)}MB (>5MB limit)`);
        }

        // Read file contents
        const content = await fs.readFile(filepath);
        const filename = path.basename(filepath);

        const svc = buildSlack(config.slack_bot_token!);
        const result = await svc.uploadFile({
          channelId,
          filename,
          content,
          title: opts.title,
          threadTs: opts.thread,
        });

        console.log(`✓ Uploaded (fileId: ${result.fileId})`);

        // Post comment if provided
        if (opts.comment) {
          await svc.reply(channelId, opts.thread, opts.comment);
          console.log(`✓ Comment posted`);
        }
      } catch (err: unknown) {
        console.error('Error:', err instanceof Error ? err.message : err);
        process.exit(1);
      }
    });
}
