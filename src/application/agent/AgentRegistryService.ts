import * as fs from 'fs/promises';
import { getAgentsPath, getDevsquadHome } from '../../utils/paths';

export interface AgentDef {
  name: string;
  role: string;
  model: string;
  container?: string;
  skills?: string[];
  description?: string;
}

export const DEFAULT_AGENTS: AgentDef[] = [
  { name: 'agent-claude-lead',      role: 'Tech Lead',          model: 'claude-sonnet-4-6' },
  { name: 'agent-gemini-manager',   role: 'Project Manager',    model: 'gemini-3.1-pro-preview' },
  { name: 'agent-gemini-architect', role: 'Solution Architect', model: 'gemini-3.1-pro-preview' },
  { name: 'agent-minimax-dev',      role: 'Developer',          model: 'MiniMax-M2.5' },
  { name: 'agent-claude-dev',       role: 'Developer',          model: 'claude-sonnet-4-6' },
  { name: 'agent-gemini-qa',        role: 'QC Analyst',         model: 'gemini-3.1-pro-preview' },
];

export class AgentRegistryService {
  async list(): Promise<AgentDef[]> {
    return this.load();
  }

  async get(name: string): Promise<AgentDef | null> {
    const agents = await this.load();
    return agents.find(a => a.name === name) ?? null;
  }

  async add(agent: AgentDef): Promise<void> {
    const agents = await this.load();
    if (agents.some(a => a.name === agent.name)) {
      throw new Error(`Agent "${agent.name}" already exists`);
    }
    agents.push(agent);
    await this.save(agents);
  }

  async remove(name: string): Promise<void> {
    const agents = await this.load();
    const filtered = agents.filter(a => a.name !== name);
    if (filtered.length === agents.length) {
      throw new Error(`Agent "${name}" not found`);
    }
    await this.save(filtered);
  }

  async init(agents: AgentDef[]): Promise<void> {
    try {
      await fs.readFile(getAgentsPath(), 'utf-8');
      // File exists — skip
    } catch {
      await this.save(agents);
    }
  }

  private async load(): Promise<AgentDef[]> {
    try {
      const raw = await fs.readFile(getAgentsPath(), 'utf-8');
      return JSON.parse(raw) as AgentDef[];
    } catch {
      return [];
    }
  }

  private async save(agents: AgentDef[]): Promise<void> {
    await fs.mkdir(getDevsquadHome(), { recursive: true });
    await fs.writeFile(getAgentsPath(), JSON.stringify(agents, null, 2), 'utf-8');
  }
}
