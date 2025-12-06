/**
 * 文字起こしプロバイダー
 */
export { SelfHostedWhisperProvider, LocalWhisperProvider } from './local-whisper-provider.js';
export { OpenAIProvider } from './openai-provider.js';

export * from '../transcription-provider.js';

import { logger } from '../../utils/logger.js';
import type {
  TranscriptionProvider,
  ProviderConfig,
} from '../transcription-provider.js';
import { SelfHostedWhisperProvider } from './local-whisper-provider.js';
import { OpenAIProvider } from './openai-provider.js';

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

    default:
      throw new Error(`Unknown provider type: ${(config as ProviderConfig).type}`);
  }
}

/**
 * 環境変数からプロバイダーを生成
 *
 * TRANSCRIPTION_PROVIDER の値:
 *   - "self-hosted" または "local": セルフホスト Whisper API (ローカルまたは外部サーバー)
 *   - "openai": OpenAI Whisper API
 */
export function createProviderFromEnv(): TranscriptionProvider {
  const providerType = process.env.TRANSCRIPTION_PROVIDER ?? 'self-hosted';

  switch (providerType) {
    case 'openai': {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) {
        throw new Error('OPENAI_API_KEY is required for OpenAI provider');
      }
      return new OpenAIProvider({ apiKey });
    }

    case 'self-hosted':
    case 'local': // 後方互換性のため
    default:
      return new SelfHostedWhisperProvider({
        baseUrl: process.env.WHISPER_API_URL ?? 'http://localhost:8000',
      });
  }
}

