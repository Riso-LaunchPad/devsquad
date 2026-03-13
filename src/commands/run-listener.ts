import { SlackService } from '../application/slack/SlackService';
import { SlackBoltClient } from '../infra/slack/SlackBoltClient';
import { SlackSocketModeAdapter } from '../infra/slack/SlackSocketModeAdapter';
import { RedisService } from '../infra/redis/RedisService';
import { SlackListenerDaemon } from '../application/daemon/SlackListenerDaemon';
import { DaemonStatusService } from '../application/daemon/DaemonStatusService';
import { TeamStatusService } from '../application/daemon/TeamStatusService';
import { DockerService } from '../infra/docker/DockerService';
import { ProjectService } from '../application/project/ProjectService';
import { loadConfig } from '../utils/config';

const PROJECT_RELOAD_INTERVAL_MS = 10_000;
const TEAM_POLL_INTERVAL_MS = 30_000;

export async function runListenerCommand(): Promise<void> {
  process.on('unhandledRejection', (reason) => {
    console.error('[listener] unhandledRejection:', reason);
  });
  process.on('uncaughtException', (err) => {
    console.error('[listener] uncaughtException:', err);
    process.exit(1);
  });

  const config = await loadConfig();

  if (!config.slack_bot_token || !config.slack_app_token) {
    console.error('Missing Slack tokens. Run: devsquad config --bot-token ... --app-token ...');
    process.exit(1);
  }

  const client = new SlackBoltClient(config.slack_bot_token);
  const socket = new SlackSocketModeAdapter(config.slack_bot_token, config.slack_app_token);
  const slack = new SlackService(client, socket);

  const projectSvc = new ProjectService();

  const redis = new RedisService({
    host: config.redis_host ?? '127.0.0.1',
    port: config.redis_port ?? 6379,
    password: config.redis_password,
  });

  await redis.connect();
  console.log('[listener] Redis connected');

  const statusChannel = config.slack_status_channel ?? 'general';
  const statusSvc = new DaemonStatusService(slack, statusChannel);
  const docker = new DockerService();
  const teamStatus = new TeamStatusService(slack, statusChannel, docker);
  const slackDaemon = new SlackListenerDaemon(slack, redis);

  // Load initial project bindings
  await reloadBindings(slackDaemon, projectSvc);

  // Periodically reload project bindings so new projects are picked up
  // without needing to restart the listener
  const reloadTimer = setInterval(async () => {
    try {
      await reloadBindings(slackDaemon, projectSvc);
    } catch (err) {
      console.error('[listener] binding reload error:', err);
    }
  }, PROJECT_RELOAD_INTERVAL_MS);
  reloadTimer.unref?.();

  const teamPollTimer = setInterval(() => {
    teamStatus.refresh().catch(err => console.error('teamStatus.refresh error:', err));
  }, TEAM_POLL_INTERVAL_MS);

  const shutdown = async () => {
    console.log('Shutting down...');
    clearInterval(reloadTimer);
    clearInterval(teamPollTimer);
    const projects = await projectSvc.loadAll();
    await slackDaemon.stop();
    await statusSvc.onStop(projects.map(p => p.name));
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  const projects = await projectSvc.loadAll();
  const projectNames = projects.map(p => p.name);
  await statusSvc.onStart(projectNames);
  await teamStatus.onStart();
  await slackDaemon.start();

  console.log('[listener] Slack listener daemon running (always-on, auto-reconnect)');
}

/**
 * Sync project bindings from projects.json into the listener daemon.
 * Adds new bindings and removes stale ones without restarting.
 */
async function reloadBindings(daemon: SlackListenerDaemon, projectSvc: ProjectService): Promise<void> {
  const projects = await projectSvc.loadAll();
  const desired = new Map(projects.map(p => [p.channelId, p.name]));
  const current = new Map(daemon.getBindings().map(b => [b.channelId, b.project]));

  // Add new bindings
  for (const [channelId, project] of desired) {
    if (!current.has(channelId)) {
      daemon.bind(channelId, project);
      console.log(`[listener] bound channel ${channelId} → ${project}`);
    }
  }

  // Remove stale bindings
  for (const [channelId, project] of current) {
    if (!desired.has(channelId)) {
      daemon.unbind(channelId);
      console.log(`[listener] unbound channel ${channelId} (was ${project})`);
    }
  }
}
