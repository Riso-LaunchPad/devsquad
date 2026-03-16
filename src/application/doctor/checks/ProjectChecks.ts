import * as fs from 'fs/promises';
import { exec as execCb } from 'child_process';
import { promisify } from 'util';
import { Check, CheckResult, CheckContext } from '../types';
import { ProjectService, ProjectConfig } from '../../project/ProjectService';
import { getPlistPath } from '../../../utils/paths';
import { LaunchDaemonManager } from '../../../infra/launchdaemon';
import { processorLabel, getNodeBin, getDevsquadBin } from '../../../utils/daemon';
import { startTmuxSession, generateSessionId } from '../../../utils/project';

const exec = promisify(execCb);
const projectSvc = new ProjectService();
const mgr = new LaunchDaemonManager();

export class ProjectEntryCheck implements Check {
  name = 'Project Entry';
  group: 'Project' = 'Project';

  constructor(private projectName: string) {}

  async run(_ctx: CheckContext): Promise<CheckResult> {
    const project = await projectSvc.get(this.projectName);
    if (project) {
      return { status: 'pass', message: `Project "${this.projectName}" registered`, canAutoFix: false };
    }
    return {
      status: 'fail',
      message: `Project "${this.projectName}" not found in projects.json`,
      fixHint: 'Run: devsquad project init',
      canAutoFix: false
    };
  }

  async fix(_ctx: CheckContext): Promise<void> {
    // Manual fix required
  }
}

export class TmuxSessionCheck implements Check {
  name = 'Tmux Session';
  group: 'Project' = 'Project';

  constructor(
    private projectName: string,
    private project: ProjectConfig
  ) {}

  async run(_ctx: CheckContext): Promise<CheckResult> {
    try {
      await exec(`tmux has-session -t "${this.project.tmuxSession}" 2>/dev/null`);
      return { status: 'pass', message: `Tmux session "${this.project.tmuxSession}" is running`, canAutoFix: false };
    } catch {
      return {
        status: 'fail',
        message: `Tmux session "${this.project.tmuxSession}" is not running`,
        fixHint: 'Run with --fix to resume project',
        canAutoFix: true
      };
    }
  }

  async fix(_ctx: CheckContext): Promise<void> {
    const sessionId = this.project.claudeSessionId || generateSessionId();
    await startTmuxSession(
      this.project.tmuxSession,
      this.project.tmuxWindow,
      { sessionId, resume: !!this.project.claudeSessionId }
    );
  }
}

export class ProcessorPlistCheck implements Check {
  name = 'Processor Plist';
  group: 'Project' = 'Project';

  constructor(private projectName: string) {}

  async run(_ctx: CheckContext): Promise<CheckResult> {
    const label = processorLabel(this.projectName);
    try {
      await fs.access(getPlistPath(label));
      return { status: 'pass', message: `Processor plist exists (${label})`, canAutoFix: false };
    } catch {
      return {
        status: 'fail',
        message: `Processor plist missing (${label})`,
        fixHint: 'Run with --fix to create processor plist',
        canAutoFix: true
      };
    }
  }

  async fix(_ctx: CheckContext): Promise<void> {
    const node = await getNodeBin();
    const bin = await getDevsquadBin();
    const label = processorLabel(this.projectName);
    await mgr.install({
      label,
      program: node,
      args: [bin, '_run-processor', this.projectName],
      envVars: {
        PATH: '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin',
      },
      keepAlive: true,
    });
  }
}

export class ProcessorStateCheck implements Check {
  name = 'Processor State';
  group: 'Project' = 'Project';

  constructor(private projectName: string) {}

  async run(_ctx: CheckContext): Promise<CheckResult> {
    const label = processorLabel(this.projectName);
    const status = await mgr.status(label);
    if (status.loaded && status.pid) {
      return { status: 'pass', message: `Processor is running (PID ${status.pid})`, canAutoFix: false };
    }
    return {
      status: 'fail',
      message: `Processor is not running`,
      fixHint: 'Run with --fix to start processor',
      canAutoFix: true
    };
  }

  async fix(_ctx: CheckContext): Promise<void> {
    const label = processorLabel(this.projectName);
    // First ensure plist exists
    try {
      await fs.access(getPlistPath(label));
    } catch {
      const node = await getNodeBin();
      const bin = await getDevsquadBin();
      await mgr.install({
        label,
        program: node,
        args: [bin, '_run-processor', this.projectName],
        envVars: {
          PATH: '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin',
        },
        keepAlive: true,
      });
    }
    await mgr.load(label);
  }
}
