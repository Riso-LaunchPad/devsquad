import * as fs from 'fs/promises';
import { exec as execCb } from 'child_process';
import { promisify } from 'util';
import { Check, CheckResult, CheckContext } from '../types';
import { getConfigPath, getAgentsPath, getPlistPath } from '../../../utils/paths';
import { loadConfig } from '../../../utils/config';
import { LaunchDaemonManager } from '../../../infra/launchdaemon';
import { LISTENER_LABEL, getNodeBin, getDevsquadBin, killStaleListeners } from '../../../utils/daemon';

const exec = promisify(execCb);
const mgr = new LaunchDaemonManager();

// 1. ConfigFileCheck
export class ConfigFileCheck implements Check {
  name = 'Config File';
  group: 'Global' = 'Global';

  async run(_ctx: CheckContext): Promise<CheckResult> {
    try {
      await fs.access(getConfigPath());
      return { status: 'pass', message: 'Config file exists', canAutoFix: false };
    } catch {
      return {
        status: 'fail',
        message: 'Config file missing (~/.devsquad/config.json)',
        fixHint: 'Run: devsquad config init',
        canAutoFix: false
      };
    }
  }

  async fix(_ctx: CheckContext): Promise<void> {
    // Manual fix required
  }
}

// 2. SlackTokenCheck
export class SlackTokenCheck implements Check {
  name = 'Slack Token';
  group: 'Global' = 'Global';

  async run(_ctx: CheckContext): Promise<CheckResult> {
    try {
      const config = await loadConfig();
      if (config.slack_bot_token) {
        return { status: 'pass', message: 'Slack bot token configured', canAutoFix: false };
      }
      return {
        status: 'fail',
        message: 'Slack bot token not configured',
        fixHint: 'Run: devsquad config --bot-token <token>',
        canAutoFix: false
      };
    } catch {
      return {
        status: 'fail',
        message: 'Slack bot token not configured',
        fixHint: 'Run: devsquad config --bot-token <token>',
        canAutoFix: false
      };
    }
  }

  async fix(_ctx: CheckContext): Promise<void> {
    // Manual fix required
  }
}

// 3. AgentsFileCheck
export class AgentsFileCheck implements Check {
  name = 'Agents File';
  group: 'Global' = 'Global';

  async run(_ctx: CheckContext): Promise<CheckResult> {
    try {
      await fs.access(getAgentsPath());
      return { status: 'pass', message: 'Agents file exists', canAutoFix: false };
    } catch {
      return {
        status: 'fail',
        message: 'Agents file missing (~/.devsquad/agents.json)',
        fixHint: 'Run with --fix to create empty agents file',
        canAutoFix: true
      };
    }
  }

  async fix(_ctx: CheckContext): Promise<void> {
    await fs.writeFile(getAgentsPath(), '[]', 'utf-8');
  }
}

// 4. ListenerPlistCheck
export class ListenerPlistCheck implements Check {
  name = 'Listener Plist';
  group: 'Global' = 'Global';

  async run(_ctx: CheckContext): Promise<CheckResult> {
    try {
      await fs.access(getPlistPath(LISTENER_LABEL));
      return { status: 'pass', message: 'Listener plist exists', canAutoFix: false };
    } catch {
      return {
        status: 'fail',
        message: 'Listener plist missing (com.devsquad.listener.plist)',
        fixHint: 'Run with --fix to create listener plist',
        canAutoFix: true
      };
    }
  }

  async fix(_ctx: CheckContext): Promise<void> {
    const node = await getNodeBin();
    const bin = await getDevsquadBin();
    await mgr.install({
      label: LISTENER_LABEL,
      program: node,
      args: [bin, '_run-listener'],
      envVars: {
        PATH: '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin',
      },
      keepAlive: true,
    });
  }
}

// 5. ListenerStateCheck
export class ListenerStateCheck implements Check {
  name = 'Listener State';
  group: 'Global' = 'Global';

  async run(_ctx: CheckContext): Promise<CheckResult> {
    const status = await mgr.status(LISTENER_LABEL);
    if (status.loaded && status.pid) {
      return { status: 'pass', message: `Listener is running (PID ${status.pid})`, canAutoFix: false };
    }
    return {
      status: 'fail',
      message: 'Listener is not running',
      fixHint: 'Run with --fix to start listener',
      canAutoFix: true
    };
  }

  async fix(_ctx: CheckContext): Promise<void> {
    // First ensure plist exists
    try {
      await fs.access(getPlistPath(LISTENER_LABEL));
    } catch {
      await new ListenerPlistCheck().fix(_ctx);
    }
    await mgr.load(LISTENER_LABEL);
  }
}

// 6. StaleListenersCheck
export class StaleListenersCheck implements Check {
  name = 'Stale Listeners';
  group: 'Global' = 'Global';

  private async getActivePid(): Promise<number | undefined> {
    const status = await mgr.status(LISTENER_LABEL);
    return status.pid;
  }

  async run(_ctx: CheckContext): Promise<CheckResult> {
    try {
      const activePid = await this.getActivePid();
      const { stdout } = await exec("ps -eo pid,args | grep '_run-listener' | grep -v grep");
      const lines = stdout.trim().split('\n').filter(Boolean);

      // Exclude the active launchd-managed PID
      const staleLines = lines.filter(line => {
        const pid = parseInt(line.trim().split(/\s+/)[0], 10);
        return pid !== activePid;
      });

      if (staleLines.length === 0) {
        return { status: 'pass', message: 'No stale listener processes', canAutoFix: false };
      }

      const detailLines = staleLines.map(line => {
        const parts = line.trim().split(/\s+/);
        const pid = parts[0];
        const cmd = parts.slice(1).join(' ');
        return `PID ${pid} — ${cmd}`;
      });

      return {
        status: 'fail',
        message: `Found ${staleLines.length} stale listener process(es)`,
        details: detailLines,
        fixHint: 'Run with --fix to kill stale processes',
        canAutoFix: true
      };
    } catch {
      return { status: 'pass', message: 'No stale listener processes', canAutoFix: false };
    }
  }

  async fix(_ctx: CheckContext): Promise<void> {
    const activePid = await this.getActivePid();
    await killStaleListeners(activePid);
  }
}
