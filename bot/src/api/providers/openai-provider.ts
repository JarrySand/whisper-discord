/**
 * OpenAI Whisper API プロバイダー
 *
 * OpenAI の Whisper API を使用（https://api.openai.com/v1/audio/transcriptions）
 */
import axios, { AxiosInstance } from 'axios';
import FormData from 'form-data';
import { logger } from '../../utils/logger.js';
import type {
  TranscriptionProvider,
  TranscriptionRequest,
  TranscriptionResponse,
  ProviderHealth,
  OpenAIConfig,
} from '../transcription-provider.js';

const OPENAI_API_URL = 'https://api.openai.com/v1';

const DEFAULT_CONFIG: Omit<OpenAIConfig, 'type' | 'apiKey'> = {
  model: 'whisper-1',
  timeout: 60000,
  retryCount: 3,
  retryDelay: 1000,
};

export class OpenAIProvider implements TranscriptionProvider {
  readonly name = 'openai';

  private client: AxiosInstance;
  private config: OpenAIConfig;
  private isHealthy = true; // OpenAI は常に利用可能と仮定

  constructor(config: Partial<OpenAIConfig> & { apiKey: string }) {
    if (!config.apiKey) {
      throw new Error('OpenAI API key is required');
    }

    this.config = {
      type: 'openai',
      apiKey: config.apiKey,
      model: config.model ?? DEFAULT_CONFIG.model,
      timeout: config.timeout ?? DEFAULT_CONFIG.timeout,
      retryCount: config.retryCount ?? DEFAULT_CONFIG.retryCount,
      retryDelay: config.retryDelay ?? DEFAULT_CONFIG.retryDelay,
    };

    this.client = axios.create({
      baseURL: OPENAI_API_URL,
      timeout: this.config.timeout,
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
      },
    });

    logger.info('OpenAIProvider initialized');
  }

  async transcribe(request: TranscriptionRequest): Promise<TranscriptionResponse> {
    const startTime = Date.now();

    try {
      const formData = new FormData();

      // 音声ファイル
      formData.append('file', request.audioData, {
        filename: `audio.${request.audioFormat}`,
        contentType: this.getContentType(request.audioFormat),
      });

      // モデル（必須）
      formData.append('model', this.config.model ?? 'whisper-1');

      // 言語（オプション）
      if (request.language) {
        formData.append('language', request.language);
      }

      // ホットワード（promptパラメータで渡す）
      if (request.hotwords && request.hotwords.length > 0) {
        const prompt = request.language === 'ja'
          ? `これは日本語の会話です。用語: ${request.hotwords.join(', ')}`
          : request.hotwords.join(', ');
        formData.append('prompt', prompt);
      }

      // レスポンス形式
      formData.append('response_format', 'verbose_json');

      const response = await this.executeWithRetry(async () => {
        return await this.client.post('/audio/transcriptions', formData, {
          headers: formData.getHeaders(),
        });
      });

      const data = response.data;
      const processingTimeMs = Date.now() - startTime;

      return {
        success: true,
        text: data.text,
        language: data.language,
        // OpenAI は confidence を返さないので、segments から推定
        confidence: this.estimateConfidence(data.segments),
        processingTimeMs,
      };
    } catch (error) {
      const processingTimeMs = Date.now() - startTime;
      const message = error instanceof Error ? error.message : 'Unknown error';

      logger.error('OpenAIProvider transcription failed:', { error: message });

      return {
        success: false,
        error: {
          code: 'TRANSCRIPTION_FAILED',
          message,
        },
        processingTimeMs,
      };
    }
  }

  async healthCheck(): Promise<ProviderHealth> {
    // OpenAI API は models エンドポイントで確認
    try {
      await this.client.get('/models/whisper-1', { timeout: 5000 });
      this.isHealthy = true;

      return {
        isHealthy: true,
        providerName: this.name,
        details: {
          model: this.config.model,
        },
      };
    } catch (error) {
      // API キーが無効などの場合
      this.isHealthy = false;

      return {
        isHealthy: false,
        providerName: this.name,
        details: {
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      };
    }
  }

  isAvailable(): boolean {
    return this.isHealthy;
  }

  private getContentType(format: string): string {
    switch (format) {
      case 'ogg':
        return 'audio/ogg';
      case 'mp3':
        return 'audio/mpeg';
      case 'webm':
        return 'audio/webm';
      default:
        return 'audio/wav';
    }
  }

  /**
   * OpenAI の segments から confidence を推定
   */
  private estimateConfidence(
    segments?: Array<{ avg_logprob?: number }>
  ): number {
    if (!segments || segments.length === 0) {
      return 0.8; // デフォルト
    }

    const avgLogprob =
      segments.reduce((sum, s) => sum + (s.avg_logprob ?? -0.5), 0) /
      segments.length;

    // log probability を 0-1 のスケールに変換
    return Math.min(1.0, Math.max(0.0, 1.0 + avgLogprob / 3));
  }

  private async executeWithRetry<T>(
    operation: () => Promise<T>
  ): Promise<T> {
    let lastError: Error | null = null;
    let delay = this.config.retryDelay ?? 1000;

    for (let attempt = 0; attempt <= (this.config.retryCount ?? 3); attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error as Error;

        if (attempt === (this.config.retryCount ?? 3)) {
          break;
        }

        logger.warn(`Retry attempt ${attempt + 1}`, { error: lastError.message });
        await this.sleep(delay);
        delay *= 2;
      }
    }

    throw lastError;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

