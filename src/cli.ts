import { Command } from 'commander';
import { ensureConfig } from './utils/config';
import { configCommand } from './commands/config';
import { daemonCommand } from './commands/daemon';
import { projectCommand } from './commands/project';
import { runListenerCommand } from './commands/run-listener';
import { runProcessorCommand } from './commands/run-processor';
import { slackCommand } from './commands/slack';
import { taskCommand } from './commands/task';
import { agentCommand } from './commands/agent';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { version } = require('../package.json');

const program = new Command();

async function main(): Promise<void> {
  await ensureConfig();

  program
    .name('devsquad')
    .description('CLI tool bridging Slack with Claude Orchestrator sessions')
    .version(version);

  program
    .command('config')
    .description('View or set devsquad configuration (Slack tokens)')
    .option('--bot-token <token>', 'Set Slack Bot Token (xoxb-...)')
    .option('--app-token <token>', 'Set Slack App Token (xoxa-...)')
    .option('--view', 'View current configuration')
    .option('--set <key=value>', 'Set a config key (e.g. --set protocol_base=/path)')
    .action(configCommand);

  daemonCommand(program);
  projectCommand(program);
  agentCommand(program);
  slackCommand(program);
  taskCommand(program);

  program
    .command('_run-listener')
    .description('Internal: run the Slack listener process (used by LaunchAgent)')
    .action(runListenerCommand);

  program
    .command('_run-processor <project>')
    .description('Internal: run the message processor for a project (used by LaunchAgent)')
    .action(runProcessorCommand);

  await program.parseAsync(process.argv);
}

main().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
