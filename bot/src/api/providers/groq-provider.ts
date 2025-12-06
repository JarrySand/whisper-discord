/**
 * Groq Whisper API プロバイダー
 *
 * Groq の Whisper API を使用（OpenAI 互換）
 * https://api.groq.com/openai/v1/audio/transcriptions
 *
 * 特徴:
 * - 超高速レスポンス（数百ms）
 * - whisper-large-v3 対応
 * - OpenAI 互換 API
 */
import axios, { AxiosInstance } from 'axios';
import FormData from 'form-data';
import { logger } from '../../utils/logger.js';
import type {
  TranscriptionProvider,
  TranscriptionRequest,
  TranscriptionResponse,
  ProviderHealth,
  BaseProviderConfig,
} from '../transcription-provider.js';

const GROQ_API_URL = 'https://api.groq.com/openai/v1';

export interface GroqConfig extends BaseProviderConfig {
  type: 'groq';
  apiKey: string;
  model?: 'whisper-large-v3' | 'whisper-large-v3-turbo';
}

const DEFAULT_CONFIG: Omit<GroqConfig, 'type' | 'apiKey'> = {
  model: 'whisper-large-v3',
  timeout: 30000,  // 30秒タイムアウト
  retryCount: 1,   // リトライ1回のみ（レート制限対策）
  retryDelay: 2000, // 2秒待機
};

export class GroqProvider implements TranscriptionProvider {
  readonly name = 'groq';

  private client: AxiosInstance;
  private config: GroqConfig;
  private isHealthy = true;

  constructor(config: Partial<GroqConfig> & { apiKey: string }) {
    if (!config.apiKey) {
      throw new Error('Groq API key is required');
    }

    this.config = {
      type: 'groq',
      apiKey: config.apiKey,
      model: config.model ?? DEFAULT_CONFIG.model,
      timeout: config.timeout ?? DEFAULT_CONFIG.timeout,
      retryCount: config.retryCount ?? DEFAULT_CONFIG.retryCount,
      retryDelay: config.retryDelay ?? DEFAULT_CONFIG.retryDelay,
    };

    this.client = axios.create({
      baseURL: GROQ_API_URL,
      timeout: this.config.timeout,
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
      },
    });

    logger.info(`GroqProvider initialized (model=${this.config.model})`);
  }

  async transcribe(request: TranscriptionRequest): Promise<TranscriptionResponse> {
    const startTime = Date.now();

    logger.info(`Groq transcribe called`, {
      audioSize: request.audioData.length,
      format: request.audioFormat,
      language: request.language,
    });

    try {
      const formData = new FormData();

      // 音声ファイル
      formData.append('file', request.audioData, {
        filename: `audio.${request.audioFormat}`,
        contentType: this.getContentType(request.audioFormat),
      });

      // モデル（必須）
      formData.append('model', this.config.model ?? 'whisper-large-v3');

      // 言語（オプション）
      if (request.language) {
        formData.append('language', request.language);
      }

      // レスポンス形式
      formData.append('response_format', 'verbose_json');

      logger.debug('Sending request to Groq API...');
      const response = await this.executeWithRetry(async () => {
        return await this.client.post('/audio/transcriptions', formData, {
          headers: formData.getHeaders(),
        });
      });

      const data = response.data;
      const processingTimeMs = Date.now() - startTime;

      logger.info(`Groq transcription completed in ${processingTimeMs}ms`, {
        textLength: data.text?.length,
        text: data.text?.substring(0, 50),
      });

      return {
        success: true,
        text: data.text,
        language: data.language,
        confidence: this.estimateConfidence(data.segments),
        processingTimeMs,
      };
    } catch (error) {
      const processingTimeMs = Date.now() - startTime;
      const message = error instanceof Error ? error.message : 'Unknown error';
      
      // レート制限エラーの検出
      const axiosError = error as { response?: { status?: number; data?: unknown } };
      if (axiosError.response?.status === 429) {
        logger.error('Groq API rate limit exceeded!', {
          status: 429,
          data: axiosError.response.data,
        });
      } else {
        logger.error('GroqProvider transcription failed:', { 
          error: message,
          status: axiosError.response?.status,
        });
      }

      return {
        success: false,
        error: {
          code: axiosError.response?.status === 429 ? 'RATE_LIMIT' : 'TRANSCRIPTION_FAILED',
          message,
        },
        processingTimeMs,
      };
    }
  }

  async healthCheck(): Promise<ProviderHealth> {
    try {
      // Groq API の models エンドポイントで確認
      await this.client.get('/models', { timeout: 5000 });
      this.isHealthy = true;

      return {
        isHealthy: true,
        providerName: this.name,
        details: {
          model: this.config.model,
        },
      };
    } catch (error) {
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
   * segments から confidence を推定
   */
  private estimateConfidence(
    segments?: Array<{ avg_logprob?: number }>
  ): number {
    if (!segments || segments.length === 0) {
      return 0.85; // Groq + large-v3 は高精度
    }

    const avgLogprob =
      segments.reduce((sum, s) => sum + (s.avg_logprob ?? -0.3), 0) /
      segments.length;

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

        logger.warn(`Groq retry attempt ${attempt + 1}`, { error: lastError.message });
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

