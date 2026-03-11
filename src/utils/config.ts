import * as fs from 'fs/promises';
import { getDevsquadHome, getConfigPath } from './paths';

export interface DevsquadConfig {
  port: number;
  logLevel: string;
  slack_app_token?: string;
  slack_bot_token?: string;
  redis_host?: string;
  redis_port?: number;
  redis_password?: string;
}

const DEFAULT_CONFIG: DevsquadConfig = {
  port: 3100,
  logLevel: 'info',
};

export async function ensureConfig(): Promise<void> {
  await fs.mkdir(getDevsquadHome(), { recursive: true });
  await ensureFile(getConfigPath(), JSON.stringify(DEFAULT_CONFIG, null, 2));
}

async function ensureFile(filePath: string, defaultContent: string): Promise<void> {
  try {
    await fs.access(filePath);
  } catch {
    await fs.writeFile(filePath, defaultContent, 'utf-8');
  }
}

export async function loadConfig(): Promise<DevsquadConfig> {
  try {
    const content = await fs.readFile(getConfigPath(), 'utf-8');
    return JSON.parse(content) as DevsquadConfig;
  } catch {
    return DEFAULT_CONFIG;
  }
}

export async function saveConfig(config: DevsquadConfig): Promise<void> {
  await fs.writeFile(getConfigPath(), JSON.stringify(config, null, 2), 'utf-8');
}
