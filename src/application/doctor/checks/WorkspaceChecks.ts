import * as fs from 'fs/promises';
import { Check, CheckResult, CheckContext } from '../types';
import { ensureGitignore, GITIGNORE_ENTRIES } from '../../../utils/project';

export class GitignoreCheck implements Check {
  name = 'Gitignore';
  group: 'Workspace' = 'Workspace';

  async run(_ctx: CheckContext): Promise<CheckResult> {
    try {
      const content = await fs.readFile('.gitignore', 'utf-8');
      const missing = GITIGNORE_ENTRIES.filter(e => !content.includes(e));
      if (missing.length === 0) {
        return { status: 'pass', message: '.gitignore contains required devsquad entries', canAutoFix: false };
      }
      return {
        status: 'fail',
        message: '.gitignore missing required devsquad entries',
        fixHint: 'Run with --fix to update .gitignore',
        canAutoFix: true
      };
    } catch {
      return {
        status: 'fail',
        message: '.gitignore file not found',
        fixHint: 'Run with --fix to create .gitignore',
        canAutoFix: true
      };
    }
  }

  async fix(_ctx: CheckContext): Promise<void> {
    await ensureGitignore(process.cwd());
  }
}
