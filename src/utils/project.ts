import * as path from 'path';
import type { ProjectConfig } from '../application/project/ProjectService';

export function resolveProjectName(
  name: string | undefined,
  cwd: string,
  projects: ProjectConfig[],
): string {
  const resolved = name ?? path.basename(cwd);
  const found = projects.find(p => p.name === resolved);
  if (!found) {
    throw new Error(
      `Project '${resolved}' not found. Run 'devsquad project list' to see registered projects.`,
    );
  }
  return resolved;
}
