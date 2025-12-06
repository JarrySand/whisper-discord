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
 * 環境変数からプロバイダーを生成
 *
 * TRANSCRIPTION_PROVIDER の値:
 *   - "self-hosted" または "local": セルフホスト Whisper API (ローカルまたは外部サーバー)
 *   - "openai": OpenAI Whisper API
 *   - "groq": Groq Whisper API (whisper-large-v3, 超高速)
 */
export function createProviderFromEnv(): TranscriptionProvider {
  const providerType = process.env.TRANSCRIPTION_PROVIDER ?? 'self-hosted';

  switch (providerType) {
    case 'groq': {
      const apiKey = process.env.GROQ_API_KEY;
      if (!apiKey) {
        throw new Error('GROQ_API_KEY is required for Groq provider');
      }
      const model = (process.env.GROQ_MODEL as 'whisper-large-v3' | 'whisper-large-v3-turbo') ?? 'whisper-large-v3';
      return new GroqProvider({ apiKey, model });
    }

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

