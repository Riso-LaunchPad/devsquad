import { describe, it, expect } from 'vitest';
import { resolveProjectName } from '../../src/utils/project';
import type { ProjectConfig } from '../../src/application/project/ProjectService';

const projects: ProjectConfig[] = [
  { name: 'my-project',    channelId: 'C1', tmuxSession: 's', tmuxWindow: 'w' },
  { name: 'other-project', channelId: 'C2', tmuxSession: 's', tmuxWindow: 'w' },
];

describe('resolveProjectName', () => {
  it('returns explicit name when it exists', () => {
    expect(resolveProjectName('my-project', '/some/path', projects)).toBe('my-project');
  });

  it('returns basename(cwd) when name is undefined and basename matches', () => {
    expect(resolveProjectName(undefined, '/workspace/my-project', projects)).toBe('my-project');
  });

  it('throws descriptive error when name is undefined and cwd not registered', () => {
    expect(() => resolveProjectName(undefined, '/workspace/unknown', projects))
      .toThrow("Project 'unknown' not found");
  });

  it('throws descriptive error when explicit name is not registered', () => {
    expect(() => resolveProjectName('nonexistent', '/some/path', projects))
      .toThrow("Project 'nonexistent' not found");
  });
});
