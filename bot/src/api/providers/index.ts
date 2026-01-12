/**
 * 文字起こしプロバイダー
 */
export { SelfHostedWhisperProvider, LocalWhisperProvider } from './local-whisper-provider.js';
export { OpenAIProvider } from './openai-provider.js';
export { GroqProvider } from './groq-provider.js';

export * from '../transcription-provider.js';

import { logger } from '../../utils/logger.js';
import type {
  TranscriptionProvider,
  ProviderConfig,
} from '../transcription-provider.js';
import { SelfHostedWhisperProvider } from './local-whisper-provider.js';
import { OpenAIProvider } from './openai-provider.js';
import { GroqProvider } from './groq-provider.js';
import { guildApiKeys } from '../../services/guild-api-keys.js';

/**
 * プロバイダーファクトリー
 *
 * 設定に基づいて適切なプロバイダーを生成
 */
export function createProvider(config: ProviderConfig): TranscriptionProvider {
  switch (config.type) {
    case 'self-hosted':
      logger.info('Creating SelfHostedWhisperProvider');
      return new SelfHostedWhisperProvider(config);

    case 'openai':
      logger.info('Creating OpenAIProvider');
      return new OpenAIProvider(config);

    case 'groq':
      logger.info('Creating GroqProvider');
      return new GroqProvider(config);

    default:
      throw new Error(`Unknown provider type: ${(config as ProviderConfig).type}`);
  }
}

/**
 * Guild別プロバイダーを生成
 *
 * Guild固有のAPIキー設定からプロバイダーを生成
 * 設定がない場合はエラーをスロー（/apikey コマンドでの設定が必須）
 *
 * @param guildId サーバーID
 * @returns 文字起こしプロバイダー
 * @throws Error APIキーが設定されていない場合
 */
export function createProviderForGuild(guildId: string): TranscriptionProvider {
  const guildConfig = guildApiKeys.getApiKeyConfig(guildId);

  if (!guildConfig) {
    throw new Error(`API key not configured for guild ${guildId}. Use /apikey set command to configure.`);
  }

  logger.info(`Using guild-specific provider for ${guildId}: ${guildConfig.provider}`);

  switch (guildConfig.provider) {
    case 'groq': {
      if (!guildConfig.apiKey) {
        throw new Error(`Groq API key not found for guild ${guildId}`);
      }
      const model = (guildConfig.model as 'whisper-large-v3' | 'whisper-large-v3-turbo') ?? 'whisper-large-v3';
      return new GroqProvider({ apiKey: guildConfig.apiKey, model });
    }

    case 'openai': {
      if (!guildConfig.apiKey) {
        throw new Error(`OpenAI API key not found for guild ${guildId}`);
      }
      return new OpenAIProvider({ apiKey: guildConfig.apiKey });
    }

    case 'self-hosted':
    default:
      return new SelfHostedWhisperProvider({
        baseUrl: guildConfig.selfHostedUrl ?? 'http://localhost:8000',
      });
  }
}
