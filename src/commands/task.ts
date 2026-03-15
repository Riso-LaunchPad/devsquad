import * as fs from 'fs/promises';
import { Command } from 'commander';

interface TaskBriefOptions {
  role: string;
  task?: string;
  output?: string;
}

const ROLE_CONFIG: Record<string, { label: string; agents: string[]; skills: Array<{ name: string; why: string }> }> = {
  developer: {
    label: 'Developer',
    agents: ['agent-claude-dev', 'agent-minimax-dev'],
    skills: [
      { name: 'clean-code', why: 'maintain readability and correctness' },
      { name: 'typescript-expert', why: 'leverage TypeScript type safety' },
    ],
  },
  'tech-lead': {
    label: 'Tech Lead',
    agents: ['agent-claude-lead'],
    skills: [
      { name: 'code-review-excellence', why: 'ensure quality standards' },
      { name: 'architecture', why: 'guide structural decisions' },
    ],
  },
  architect: {
    label: 'Architect',
    agents: ['agent-gemini-architect'],
    skills: [
      { name: 'architecture', why: 'design system structure' },
      { name: 'domain-driven-design', why: 'model business domains accurately' },
    ],
  },
  manager: {
    label: 'Manager',
    agents: ['agent-gemini-manager'],
    skills: [
      { name: 'planning-with-files', why: 'keep plans in version-controlled files' },
      { name: 'concise-planning', why: 'reduce overhead with minimal plans' },
    ],
  },
  qa: {
    label: 'QA Engineer',
    agents: ['agent-gemini-qa'],
    skills: [
      { name: 'testing-patterns', why: 'apply proven test structures' },
      { name: 'documentation', why: 'document test coverage and findings' },
    ],
  },
};

function renderBrief(options: TaskBriefOptions): string {
  const config = ROLE_CONFIG[options.role];
  const taskTitle = options.task ?? 'TODO';
  const skillLines = config.skills
    .map((s) => `- \`${s.name}\` — ${s.why}`)
    .join('\n');

  return `# Task: ${taskTitle}

## Your Role
You are a **${config.label}** in a development team.

## Goal
<TODO: 1-3 sentences. Specific end result.>

## Background
<TODO: Why this task exists. Max 3-5 lines.>

## Scope — What to Do
1. TODO

## Scope — What NOT to Do
- TODO

## Input Files
- TODO

## Output Files
- TODO

## Skills
Use the following skills:
${skillLines}

## Acceptance Criteria
- [ ] TODO

## Post-Task
Write a self-report to \`session/logs/post-task-<task-id>.md\`.
`;
}

export async function runTaskBriefCommand(options: TaskBriefOptions): Promise<void> {
  if (!ROLE_CONFIG[options.role]) {
    const valid = Object.keys(ROLE_CONFIG).join(', ');
    console.error(`Error: unknown role "${options.role}". Valid roles: ${valid}`);
    process.exit(1);
  }

  const brief = renderBrief(options);

  if (options.output) {
    await fs.writeFile(options.output, brief, 'utf-8');
    console.log(`Brief written to ${options.output}`);
  } else {
    process.stdout.write(brief);
  }
}

export function taskCommand(program: Command): void {
  const task = program.command('task').description('Task authoring utilities');

  task
    .command('brief')
    .description('Scaffold a pre-filled task brief skeleton')
    .requiredOption('--role <role>', 'Agent role (developer, tech-lead, architect, manager, qa)')
    .option('--task <description>', 'One-line task description')
    .option('--output <file>', 'Write brief to file instead of stdout')
    .action((opts) => runTaskBriefCommand(opts));
}
