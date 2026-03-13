import * as fs from 'fs/promises';
import { exec as execCb } from 'child_process';
import { promisify } from 'util';
import { getPlistPath, getLogPath, getLogsDir } from '../../utils/paths';

const exec = promisify(execCb);

export interface DaemonDefinition {
  label: string;       // e.g. com.devsquad.listener
  program: string;     // absolute path to node binary or script
  args: string[];      // args passed to program
  envVars?: Record<string, string>;
  keepAlive?: boolean;
}

export interface DaemonStatus {
  label: string;
  loaded: boolean;
  pid?: number;
}

export class LaunchDaemonManager {
  async install(def: DaemonDefinition): Promise<void> {
    await fs.mkdir(getLogsDir(), { recursive: true });
    const plist = this.buildPlist(def);
    await fs.writeFile(getPlistPath(def.label), plist, 'utf-8');
  }

  async load(label: string): Promise<void> {
    await exec(`launchctl load -w "${getPlistPath(label)}"`);
  }

  async unload(label: string): Promise<void> {
    try {
      await exec(`launchctl unload -w "${getPlistPath(label)}"`);
    } catch {
      // already unloaded
    }
  }

  async remove(label: string): Promise<void> {
    await this.unload(label);
    try {
      await fs.unlink(getPlistPath(label));
    } catch {
      // plist already gone
    }
  }

  async status(label: string): Promise<DaemonStatus> {
    try {
      const { stdout } = await exec(`launchctl list | grep ${label}`);
      const parts = stdout.trim().split(/\s+/);
      const pid = parts[0] !== '-' ? parseInt(parts[0], 10) : undefined;
      return { label, loaded: true, pid };
    } catch {
      return { label, loaded: false };
    }
  }

  async restart(label: string): Promise<void> {
    await this.unload(label);
    await this.load(label);
  }

  private buildPlist(def: DaemonDefinition): string {
    const envXml = def.envVars
      ? `\t<key>EnvironmentVariables</key>\n\t<dict>\n${
          Object.entries(def.envVars)
            .map(([k, v]) => `\t\t<key>${k}</key>\n\t\t<string>${v}</string>`)
            .join('\n')
        }\n\t</dict>\n`
      : '';

    const argsXml = [def.program, ...def.args]
      .map(a => `\t\t<string>${a}</string>`)
      .join('\n');

    const keepAlive = def.keepAlive !== false; // default true

    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>Label</key>
\t<string>${def.label}</string>
\t<key>ProgramArguments</key>
\t<array>
${argsXml}
\t</array>
${envXml}\t<key>KeepAlive</key>
\t<${keepAlive}/>
\t<key>ThrottleInterval</key>
\t<integer>10</integer>
\t<key>RunAtLoad</key>
\t<true/>
\t<key>StandardOutPath</key>
\t<string>${getLogPath(def.label)}</string>
\t<key>StandardErrorPath</key>
\t<string>${getLogPath(def.label)}</string>
</dict>
</plist>
`;
  }
}
