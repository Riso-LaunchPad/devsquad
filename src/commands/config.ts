import prompts from 'prompts';
import { loadConfig, saveConfig, DevsquadConfig } from '../utils/config';

function maskToken(token: string | undefined): string {
  if (!token) return '<not set>';
  if (token.length <= 10) return '***';
  return `${token.substring(0, 6)}...${token.substring(token.length - 4)}`;
}

const ALLOWED_SET_KEYS = ['protocol_base'] as const;
type AllowedSetKey = typeof ALLOWED_SET_KEYS[number];

interface ConfigOptions {
  botToken?: string;
  appToken?: string;
  view?: boolean;
  set?: string;
}

export async function configCommand(options: ConfigOptions = {}): Promise<void> {
  const { botToken, appToken, view, set } = options;

  if (set) {
    const eqIndex = set.indexOf('=');
    if (eqIndex === -1) {
      console.error('Error: --set requires key=value format');
      process.exit(1);
    }
    const key = set.substring(0, eqIndex);
    const value = set.substring(eqIndex + 1);
    if (!(ALLOWED_SET_KEYS as readonly string[]).includes(key)) {
      console.error(`Error: Unknown config key "${key}". Allowed keys: ${ALLOWED_SET_KEYS.join(', ')}`);
      process.exit(1);
    }
    const config = await loadConfig();
    (config as unknown as Record<string, unknown>)[key as AllowedSetKey] = value;
    await saveConfig(config);
    console.log(`✅ Config updated: ${key} = ${value}`);
    return;
  }

  if (view) {
    const config = await loadConfig();
    console.log('\n📋 Current Configuration:\n');
    console.log(`   Port:        ${config.port}`);
    console.log(`   Log Level:   ${config.logLevel}`);
    console.log(`   Bot Token:   ${maskToken(config.slack_bot_token)}`);
    console.log(`   App Token:   ${maskToken(config.slack_app_token)}`);
    console.log(`   Protocol Base: ${config.protocol_base || '(not set)'}`);
    console.log('');
    return;
  }

  const config = await loadConfig();
  const isNonInteractive = botToken !== undefined || appToken !== undefined;

  let finalBotToken = config.slack_bot_token;
  let finalAppToken = config.slack_app_token;

  if (isNonInteractive) {
    if (botToken !== undefined) finalBotToken = botToken;
    if (appToken !== undefined) finalAppToken = appToken;
  } else {
    const responses = await prompts([
      {
        type: 'text',
        name: 'botToken',
        message: 'Enter Slack Bot Token (xoxb-...):',
        initial: config.slack_bot_token || '',
      },
      {
        type: 'text',
        name: 'appToken',
        message: 'Enter Slack App Token (xoxa-...):',
        initial: config.slack_app_token || '',
      },
    ]);

    if (responses.botToken) finalBotToken = responses.botToken;
    if (responses.appToken) finalAppToken = responses.appToken;
  }

  const updatedConfig: DevsquadConfig = {
    ...config,
    slack_bot_token: finalBotToken,
    slack_app_token: finalAppToken,
  };

  await saveConfig(updatedConfig);

  console.log('\n✅ Configuration saved to ~/.devsquad/config.json');
  console.log(`   Bot Token: ${maskToken(updatedConfig.slack_bot_token)}`);
  console.log(`   App Token: ${maskToken(updatedConfig.slack_app_token)}`);
  console.log('');
}
