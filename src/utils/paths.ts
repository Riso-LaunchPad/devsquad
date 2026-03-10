import * as path from 'path';
import * as os from 'os';

export function getDevsquadHome(): string {
  return path.join(os.homedir(), '.devsquad');
}

export function getConfigPath(): string {
  return path.join(getDevsquadHome(), 'config.json');
}
