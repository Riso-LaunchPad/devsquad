import * as fs from 'fs/promises';
import { getProjectsPath, getDevsquadHome } from '../../utils/paths';

export interface ProjectConfig {
  name: string;              // unique key, used as Redis queue key
  channelId: string;         // Slack channel ID
  tmuxSession: string;       // tmux session name
  tmuxWindow: string;        // tmux window name (running Claude CLI as Orchestrator)
  statusMessageTs?: string;  // ts of the pinned status message in Slack
  claudeSessionId?: string;  // Claude CLI session ID for resuming conversations
  mode?: 'autonomous' | 'supervised'; // gate mode for auto-approve system
}

export class ProjectService {
  async add(project: ProjectConfig): Promise<void> {
    const projects = await this.loadAll();

    if (projects.some(p => p.name === project.name)) {
      throw new Error(`Project "${project.name}" already exists`);
    }

    projects.push(project);
    await this.save(projects);
  }

  async update(name: string, patch: Partial<ProjectConfig>): Promise<void> {
    const projects = await this.loadAll();
    const idx = projects.findIndex(p => p.name === name);

    if (idx === -1) {
      throw new Error(`Project "${name}" not found`);
    }

    projects[idx] = { ...projects[idx], ...patch };
    await this.save(projects);
  }

  async remove(name: string): Promise<void> {
    const projects = await this.loadAll();
    const filtered = projects.filter(p => p.name !== name);

    if (filtered.length === projects.length) {
      throw new Error(`Project "${name}" not found`);
    }

    await this.save(filtered);
  }

  async get(name: string): Promise<ProjectConfig | null> {
    const projects = await this.loadAll();
    return projects.find(p => p.name === name) ?? null;
  }

  async loadAll(): Promise<ProjectConfig[]> {
    try {
      const raw = await fs.readFile(getProjectsPath(), 'utf-8');
      return JSON.parse(raw) as ProjectConfig[];
    } catch {
      return [];
    }
  }

  private async save(projects: ProjectConfig[]): Promise<void> {
    await fs.mkdir(getDevsquadHome(), { recursive: true });
    await fs.writeFile(getProjectsPath(), JSON.stringify(projects, null, 2), 'utf-8');
  }
}
