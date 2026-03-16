import { GroupedResults } from './DoctorService';

export class DoctorFormatter {
  printHeader(): void {
    console.log('\n🩺 devsquad doctor\n');
  }

  printGroup(group: 'Global' | 'Project' | 'Workspace', results: GroupedResults['Global'] | GroupedResults['Project'] | GroupedResults['Workspace'], projectName?: string): void {
    let title = '';
    if (group === 'Global') title = 'Global Checks';
    else if (group === 'Project') title = projectName ? `Project Checks (${projectName})` : 'Project Checks';
    else title = 'Workspace Checks';

    console.log(`${title}`);
    for (const item of results) {
      const { check, result } = item;
      const icon = result.status === 'pass' ? '✓' : '✗';
      const prefix = group === 'Project' ? `  [${icon}] ${check.name}` : `[${icon}] ${check.name}`;
      console.log(`${prefix}: ${result.message}`);
      if (result.details && result.details.length > 0) {
        for (const detail of result.details) {
          console.log(`    ${detail}`);
        }
      }
      if (result.status === 'fail' && result.fixHint) {
        console.log(`    → ${result.fixHint}`);
      }
    }
    console.log('');
  }

  printSummary(failCount: number): void {
    if (failCount === 0) {
      console.log('✅ All checks passed.\n');
    } else {
      console.log(`${failCount} issue${failCount > 1 ? 's' : ''} found. Run \`devsquad doctor --fix\` to repair.\n`);
    }
  }
}
