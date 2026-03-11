import { SlackService } from '../application/slack/SlackService';
import { SlackBoltClient } from '../infra/slack/SlackBoltClient';
import { SlackBoltSocket } from '../infra/slack/SlackBoltSocket';
import { RedisService } from '../infra/redis/RedisService';
import { SlackListenerDaemon } from '../application/daemon/SlackListenerDaemon';
import { DaemonStatusService } from '../application/daemon/DaemonStatusService';
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
  const daemon = new SlackListenerDaemon(slack, redis);

  // Graceful shutdown
  const shutdown = async () => {
    console.log('Shutting down...');
    await daemon.stop();
    await statusSvc.onStop();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  await statusSvc.onStart();
  await daemon.start();

  console.log('Slack listener daemon running');
}
