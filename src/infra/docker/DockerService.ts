import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export type ContainerStatus = 'running' | 'exited' | 'restarting' | 'dead' | 'paused' | 'created' | 'unknown';

export class DockerService {
  async getContainerStatus(containerName: string): Promise<ContainerStatus> {
    try {
      const { stdout } = await execAsync(
        `docker inspect --format '{{.State.Status}}' ${containerName}`,
      );
      const status = stdout.trim() as ContainerStatus;
      return status || 'unknown';
    } catch {
      // Container not found
      return 'unknown';
    }
  }

  async getStatuses(containerNames: string[]): Promise<Record<string, ContainerStatus>> {
    const entries = await Promise.all(
      containerNames.map(async name => [name, await this.getContainerStatus(name)] as const),
    );
    return Object.fromEntries(entries);
  }
}
