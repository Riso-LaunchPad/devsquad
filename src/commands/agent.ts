import { Command } from 'commander';
import { AgentRegistryService, DEFAULT_AGENTS } from '../application/agent/AgentRegistryService';

const registry = new AgentRegistryService();

export function agentCommand(program: Command): void {
  const agent = program
    .command('agent')
    .description('Manage agent registry (~/.devsquad/agents.json)');

  // ── list ────────────────────────────────────────────────────────────────────

  agent
    .command('list')
    .description('List all registered agents')
    .action(async () => {
      try {
        const agents = await registry.list();
        if (agents.length === 0) {
          console.log('No agents registered. Use: devsquad agent init');
          return;
        }
        console.log(`${'Name'.padEnd(30)} ${'Role'.padEnd(22)} Model`);
        console.log(`${'-'.repeat(30)} ${'-'.repeat(22)} ${'-'.repeat(25)}`);
        for (const a of agents) {
          console.log(`${a.name.padEnd(30)} ${a.role.padEnd(22)} ${a.model}`);
        }
      } catch (err: unknown) {
        console.error('Error:', err instanceof Error ? err.message : err);
        process.exit(1);
      }
    });

  // ── add ─────────────────────────────────────────────────────────────────────

  agent
    .command('add')
    .description('Register a new agent')
    .requiredOption('--name <name>', 'Agent name (e.g. agent-claude-lead)')
    .requiredOption('--role <role>', 'Agent role (e.g. Tech Lead)')
    .requiredOption('--model <model>', 'Model ID (e.g. claude-sonnet-4-6)')
    .option('--container <container>', 'Docker container name')
    .option('--skills <csv>', 'Comma-separated list of skills')
    .action(async (opts) => {
      try {
        await registry.add({
          name: opts.name,
          role: opts.role,
          model: opts.model,
          ...(opts.container ? { container: opts.container } : {}),
          ...(opts.skills
            ? { skills: (opts.skills as string).split(',').map((s: string) => s.trim()).filter(Boolean) }
            : {}),
        });
        console.log(`✓ Agent "${opts.name}" added`);
      } catch (err: unknown) {
        console.error('Error:', err instanceof Error ? err.message : err);
        process.exit(1);
      }
    });

  // ── remove ──────────────────────────────────────────────────────────────────

  agent
    .command('remove <name>')
    .description('Remove an agent from the registry')
    .action(async (name: string) => {
      try {
        await registry.remove(name);
        console.log(`✓ Agent "${name}" removed`);
      } catch (err: unknown) {
        console.error('Error:', err instanceof Error ? err.message : err);
        process.exit(1);
      }
    });

  // ── show ────────────────────────────────────────────────────────────────────

  agent
    .command('show <name>')
    .description('Show full details for an agent')
    .action(async (name: string) => {
      try {
        const a = await registry.get(name);
        if (!a) {
          console.error(`Agent "${name}" not found`);
          process.exit(1);
        }
        console.log(JSON.stringify(a, null, 2));
      } catch (err: unknown) {
        console.error('Error:', err instanceof Error ? err.message : err);
        process.exit(1);
      }
    });

  // ── init ────────────────────────────────────────────────────────────────────

  agent
    .command('init')
    .description('Seed agents.json with default team agents (skip if file already exists)')
    .action(async () => {
      try {
        await registry.init(DEFAULT_AGENTS);
        console.log('✓ agents.json initialized');
      } catch (err: unknown) {
        console.error('Error:', err instanceof Error ? err.message : err);
        process.exit(1);
      }
    });
}
