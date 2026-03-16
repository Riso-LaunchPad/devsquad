export type CheckGroup = 'Global' | 'Project' | 'Workspace';

export interface CheckResult {
  status: 'pass' | 'fail';
  message: string;
  details?: string[];
  fixHint?: string;
  canAutoFix: boolean;
}

export interface CheckContext {
  projectName?: string;
  isFixMode: boolean;
}

export interface Check {
  name: string;
  group: CheckGroup;

  run(ctx: CheckContext): Promise<CheckResult>;

  fix(ctx: CheckContext): Promise<void>;
}
