import { Command } from 'commander';
import { DoctorService, GroupedResults } from '../application/doctor/DoctorService';
import { DoctorFormatter } from '../application/doctor/DoctorFormatter';
import { Check, CheckResult } from '../application/doctor/types';
import { ProjectService } from '../application/project/ProjectService';
import {
  ConfigFileCheck,
  SlackTokenCheck,
  AgentsFileCheck,
  ListenerPlistCheck,
  ListenerStateCheck,
  StaleListenersCheck
} from '../application/doctor/checks/GlobalChecks';

function printResults(formatter: DoctorFormatter, results: GroupedResults): void {
  formatter.printGroup('Global', results.Global);
  if (results.Project.length > 0) {
    const projectNames = [...new Set(results.Project.map(p => p.projectName))];
    for (const pName of projectNames) {
      const pResults = results.Project.filter(p => p.projectName === pName);
      formatter.printGroup('Project', pResults, pName);
    }
  }
  if (results.Workspace.length > 0) {
    formatter.printGroup('Workspace', results.Workspace);
  }
}

export function doctorCommand(program: Command): void {
  program
    .command('doctor')
    .description('Diagnose and repair devsquad environment')
    .option('--name <project>', 'Check a specific project only')
    .option('--fix', 'Automatically repair fixable issues')
    .action(async (opts) => {
      try {
        const projectName = opts.name;
        const isFixMode = !!opts.fix;

        // Load projects
        const projectSvc = new ProjectService();
        const projects = await projectSvc.loadAll();

        // Build all check instances (global checks)
        const checks: Check[] = [
          new ConfigFileCheck(),
          new SlackTokenCheck(),
          new AgentsFileCheck(),
          new ListenerPlistCheck(),
          new ListenerStateCheck(),
          new StaleListenersCheck()
        ];

        // Create service and formatter
        const service = new DoctorService(checks);
        const formatter = new DoctorFormatter();

        // Initial run
        formatter.printHeader();

        const ctx = { projectName, isFixMode };
        let results = await service.runAll(ctx, projects);

        // Print results
        printResults(formatter, results);

        const failCount = service.countFailures(results);

        // Fix mode: apply fixes and re-run
        if (isFixMode && failCount > 0) {
          console.log('Applying fixes...\n');
          const failures = service.getFailures(results, ctx);
          await service.applyFixes(failures.map(f => ({ check: f.check, ctx: f.ctx })));

          // Re-run checks after fixes
          console.log('\nRe-running checks after fixes...\n');
          results = await service.runAll(ctx, projects);

          // Print updated results
          printResults(formatter, results);
        }

        const finalFailCount = service.countFailures(results);
        formatter.printSummary(finalFailCount);

        process.exit(finalFailCount > 0 ? 1 : 0);
      } catch (err) {
        console.error('Error running doctor:', err instanceof Error ? err.message : err);
        process.exit(1);
      }
    });
}
