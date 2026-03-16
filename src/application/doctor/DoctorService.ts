import * as path from 'path';
import { Check, CheckContext, CheckResult } from './types';
import { ProjectConfig } from '../project/ProjectService';
import { ProjectEntryCheck, TmuxSessionCheck, ProcessorPlistCheck, ProcessorStateCheck } from './checks/ProjectChecks';
import { GitignoreCheck } from './checks/WorkspaceChecks';

export interface GroupedResults {
  Global: Array<{ check: Check; result: CheckResult }>;
  Project: Array<{ check: Check; result: CheckResult; projectName: string }>;
  Workspace: Array<{ check: Check; result: CheckResult }>;
}

export class DoctorService {
  constructor(private checks: Check[]) {}

  async runAll(ctx: CheckContext, projects: ProjectConfig[]): Promise<GroupedResults> {
    const results: GroupedResults = {
      Global: [],
      Project: [],
      Workspace: []
    };

    // Run Global checks
    const globalChecks = this.checks.filter(c => c.group === 'Global');
    for (const check of globalChecks) {
      const result = await check.run(ctx);
      results.Global.push({ check, result });
    }

    // Determine which projects to check
    let projectsToCheck = projects;
    if (ctx.projectName) {
      projectsToCheck = projects.filter(p => p.name === ctx.projectName);
    }

    // Run Project checks for each project
    for (const project of projectsToCheck) {
      const projectCtx = { ...ctx, projectName: project.name };
      const projectChecks = [
        new ProjectEntryCheck(project.name),
        new TmuxSessionCheck(project.name, project),
        new ProcessorPlistCheck(project.name),
        new ProcessorStateCheck(project.name)
      ];

      for (const check of projectChecks) {
        const result = await check.run(projectCtx);
        results.Project.push({ check, result, projectName: project.name });
      }
    }

    // Run Workspace checks if cwd matches a project
    const cwdName = path.basename(process.cwd());
    const cwdMatchesProject = projectsToCheck.some(p => p.name === cwdName);
    if (cwdMatchesProject) {
      const workspaceCheck = new GitignoreCheck();
      const workspaceResult = await workspaceCheck.run(ctx);
      results.Workspace.push({ check: workspaceCheck, result: workspaceResult });
    }

    return results;
  }

  async applyFixes(failures: Array<{ check: Check; ctx: CheckContext }>): Promise<void> {
    for (const { check, ctx } of failures) {
      try {
        await check.fix(ctx);
        console.log(`  ✓ Fixed: ${check.name}`);
      } catch (err) {
        console.log(`  ✗ Failed to fix: ${check.name}`);
        console.log(`    Error: ${err instanceof Error ? err.message : err}`);
      }
    }
  }

  getFailures(results: GroupedResults, ctx: CheckContext): Array<{ check: Check; result: CheckResult; ctx: CheckContext }> {
    const failures: Array<{ check: Check; result: CheckResult; ctx: CheckContext }> = [];

    // Global failures
    for (const { check, result } of results.Global) {
      if (result.status === 'fail' && result.canAutoFix) {
        failures.push({ check, result, ctx });
      }
    }

    // Project failures
    for (const { check, result, projectName } of results.Project) {
      if (result.status === 'fail' && result.canAutoFix) {
        failures.push({ check, result, ctx: { ...ctx, projectName } });
      }
    }

    // Workspace failures
    for (const { check, result } of results.Workspace) {
      if (result.status === 'fail' && result.canAutoFix) {
        failures.push({ check, result, ctx });
      }
    }

    return failures;
  }

  countFailures(results: GroupedResults): number {
    let count = 0;
    for (const { result } of results.Global) {
      if (result.status === 'fail') count++;
    }
    for (const { result } of results.Project) {
      if (result.status === 'fail') count++;
    }
    for (const { result } of results.Workspace) {
      if (result.status === 'fail') count++;
    }
    return count;
  }
}
