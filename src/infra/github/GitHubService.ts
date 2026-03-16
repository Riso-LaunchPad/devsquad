import { exec as execCb, spawn } from 'child_process';
import { promisify } from 'util';
import { graphql as createGraphqlClient } from '@octokit/graphql';

const exec = promisify(execCb);

export class GitHubService {
  async checkAuth(): Promise<boolean> {
    try {
      await exec('gh auth status');
      return true;
    } catch (err: unknown) {
      const error = err as NodeJS.ErrnoException;
      if (error.code === 'ENOENT' || (error.message && error.message.includes('not found'))) {
        throw new Error('GitHub CLI (gh) is not installed. Install from https://cli.github.com');
      }
      return false;
    }
  }

  async login(): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn('gh', ['auth', 'login'], { stdio: 'inherit' });
      child.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`gh auth login exited with code ${code}`));
        }
      });
      child.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'ENOENT') {
          reject(new Error('GitHub CLI (gh) is not installed. Install from https://cli.github.com'));
        } else {
          reject(new Error(`Failed to spawn gh auth login: ${err.message}`));
        }
      });
    });
  }

  async getGraphqlClient(): Promise<typeof createGraphqlClient> {
    let token: string;
    try {
      const { stdout } = await exec('gh auth token');
      token = stdout.trim();
    } catch (err: unknown) {
      const error = err as NodeJS.ErrnoException;
      if (error.code === 'ENOENT' || (error.message && error.message.includes('not found'))) {
        throw new Error('GitHub CLI (gh) is not installed. Install from https://cli.github.com');
      }
      throw new Error(`Failed to retrieve GitHub token. Run: gh auth login`);
    }

    if (!token) {
      throw new Error('Failed to retrieve GitHub token. Run: gh auth login');
    }

    return createGraphqlClient.defaults({
      headers: { authorization: `token ${token}` },
    });
  }

  async ensureAuth(): Promise<void> {
    const authenticated = await this.checkAuth();
    if (!authenticated) {
      await this.login();
    }
  }
}
