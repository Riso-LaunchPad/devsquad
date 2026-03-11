import { SlackService } from '../application/slack/SlackService';
import { SlackBoltClient } from '../infra/slack/SlackBoltClient';
import { SlackBoltSocket } from '../infra/slack/SlackBoltSocket';
import { RedisService } from '../infra/redis/RedisService';
import { SlackListenerDaemon } from '../application/daemon/SlackListenerDaemon';
import { DaemonStatusService } from '../application/daemon/DaemonStatusService';
import { TeamStatusService } from '../application/daemon/TeamStatusService';
import { DockerService } from '../infra/docker/DockerService';
import { loadConfig } from '../utils/config';

export async function runListenerCommand(): Promise<void> {
  const config = await loadConfig();

  if (!config.slack_bot_token || !config.slack_app_token) {
    console.error('Missing Slack tokens. Run: devsquad config --bot-token ... --app-token ...');
    process.exit(1);
  }

  const client = new SlackBoltClient(config.slack_bot_token);
  const socket = new SlackBoltSocket(config.slack_bot_token, config.slack_app_token);
  const slack = new SlackService(client, socket);

  const redis = new RedisService({
    host: config.redis_host ?? '127.0.0.1',
    port: config.redis_port ?? 6379,
    password: config.redis_password,
  });

  const statusChannel = config.slack_status_channel ?? 'general';
  const statusSvc = new DaemonStatusService(slack, statusChannel);
  const docker = new DockerService();
  const teamStatus = new TeamStatusService(slack, statusChannel, docker);
  const daemon = new SlackListenerDaemon(slack, redis);

  // TEST BINDING — remove after testing
  daemon.bind('C0AK5K4QGNA', 'test-project');

  // Poll docker every 30s and update team status
  const TEAM_POLL_INTERVAL_MS = 30_000;
  const teamPollTimer = setInterval(() => {
    teamStatus.refresh().catch(err => console.error('teamStatus.refresh error:', err));
  }, TEAM_POLL_INTERVAL_MS);

  // Graceful shutdown
  const shutdown = async () => {
    console.log('Shutting down...');
    clearInterval(teamPollTimer);
    await daemon.stop();
    await statusSvc.onStop();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  await statusSvc.onStart();
  await teamStatus.onStart();
  await daemon.start();

  console.log('Slack listener daemon running');
}
