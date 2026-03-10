import prompts from 'prompts';
import { loadConfig, saveConfig, DevsquadConfig } from '../utils/config';

function maskToken(token: string | undefined): string {
  if (!token) return '<not set>';
  if (token.length <= 10) return '***';
  return `${token.substring(0, 6)}...${token.substring(token.length - 4)}`;
}

interface ConfigOptions {
  botToken?: string;
  appToken?: string;
  view?: boolean;
}

export async function configCommand(options: ConfigOptions = {}): Promise<void> {
  const { botToken, appToken, view } = options;

  if (view) {
    const config = await loadConfig();
    console.log('\n📋 Current Configuration:\n');
    console.log(`   Port:        ${config.port}`);
    console.log(`   Log Level:   ${config.logLevel}`);
    console.log(`   Bot Token:   ${maskToken(config.slack_bot_token)}`);
    console.log(`   App Token:   ${maskToken(config.slack_app_token)}`);
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
