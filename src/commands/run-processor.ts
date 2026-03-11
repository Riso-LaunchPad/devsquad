import { RedisService } from '../infra/redis/RedisService';
import { TmuxService } from '../infra/tmux/TmuxService';
import { MessageProcessorDaemon } from '../application/daemon/MessageProcessorDaemon';
import { ProjectService } from '../application/project/ProjectService';
import { ProjectStatusService } from '../application/project/ProjectStatusService';
import { SlackService } from '../application/slack/SlackService';
import { SlackBoltClient } from '../infra/slack/SlackBoltClient';
import { loadConfig } from '../utils/config';

export async function runProcessorCommand(projectName: string): Promise<void> {
  const config = await loadConfig();
  const svc = new ProjectService();
  const project = await svc.get(projectName);

  if (!project) {
    console.error(`Project "${projectName}" not found. Run: devsquad project init`);
    process.exit(1);
  }

  const redis = new RedisService({
    host: config.redis_host ?? '127.0.0.1',
    port: config.redis_port ?? 6379,
    password: config.redis_password,
  });

  const tmux = new TmuxService();
  const processor = new MessageProcessorDaemon(
    { project: project.name, target: { session: project.tmuxSession, window: project.tmuxWindow } },
    redis,
    tmux,
  );

  const client = new SlackBoltClient(config.slack_bot_token!);
  const slack = new SlackService(client, null as never);
  const statusSvc = new ProjectStatusService(slack);

  const shutdown = async () => {
    console.log(`[processor:${projectName}] Shutting down...`);
    await processor.stop();
    await statusSvc.updateProcessorStatus(project, 'stopped').catch(() => {});
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  await processor.start();
  await statusSvc.updateProcessorStatus(project, 'running').catch(() => {});
  console.log(`[processor:${projectName}] running`);
}
