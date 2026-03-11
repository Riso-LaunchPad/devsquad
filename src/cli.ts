import { Command } from 'commander';
import { ensureConfig } from './utils/config';
import { configCommand } from './commands/config';
import { daemonCommand } from './commands/daemon';

const program = new Command();

async function main(): Promise<void> {
  await ensureConfig();

  program
    .name('devsquad')
    .description('CLI tool bridging Slack with Gemini Orchestrator sessions')
    .version('2.0.0');

  program
    .command('config')
    .description('View or set devsquad configuration (Slack tokens)')
    .option('--bot-token <token>', 'Set Slack Bot Token (xoxb-...)')
    .option('--app-token <token>', 'Set Slack App Token (xoxa-...)')
    .option('--view', 'View current configuration')
    .action(configCommand);

  daemonCommand(program);

  await program.parseAsync(process.argv);
}

main().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
