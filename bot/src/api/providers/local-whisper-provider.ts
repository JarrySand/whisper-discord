/**
 * セルフホスト Whisper API プロバイダー
 *
 * 自前でホストした faster-whisper API を使用（ローカルまたは外部サーバー）
 */
import axios, { AxiosInstance, isAxiosError } from 'axios';
import FormData from 'form-data';
import { logger } from '../../utils/logger.js';
import type {
  TranscriptionProvider,
  TranscriptionRequest,
  TranscriptionResponse,
  ProviderHealth,
  SelfHostedWhisperConfig,
} from '../transcription-provider.js';

const DEFAULT_CONFIG: Omit<SelfHostedWhisperConfig, 'type'> = {
  baseUrl: 'http://localhost:8000',
  timeout: 60000,
  retryCount: 3,
  retryDelay: 1000,
};

/** @deprecated Use SelfHostedWhisperProvider instead */
export { SelfHostedWhisperProvider as LocalWhisperProvider };

export class SelfHostedWhisperProvider implements TranscriptionProvider {
  readonly name = 'self-hosted-whisper';

  private client: AxiosInstance;
  private config: SelfHostedWhisperConfig;
  private _isHealthy = false;
  private _lastHealthCheck = 0;

  constructor(config: Partial<SelfHostedWhisperConfig>) {
    this.config = {
      type: 'self-hosted',
      baseUrl: config.baseUrl ?? DEFAULT_CONFIG.baseUrl,
      timeout: config.timeout ?? DEFAULT_CONFIG.timeout,
      retryCount: config.retryCount ?? DEFAULT_CONFIG.retryCount,
      retryDelay: config.retryDelay ?? DEFAULT_CONFIG.retryDelay,
    };

    this.client = axios.create({
      baseURL: this.config.baseUrl,
      timeout: this.config.timeout,
    });

    logger.info(`SelfHostedWhisperProvider initialized: ${this.config.baseUrl}`);
  }

  async transcribe(request: TranscriptionRequest): Promise<TranscriptionResponse> {
    const startTime = Date.now();

    try {
      const formData = new FormData();

      // 音声ファイル
      formData.append('audio_file', request.audioData, {
        filename: `segment.${request.audioFormat}`,
        contentType: this.getContentType(request.audioFormat),
      });

      // メタデータ
      formData.append('user_id', request.userId ?? 'unknown');
      formData.append('username', request.username ?? 'unknown');
      if (request.displayName) {
        formData.append('display_name', request.displayName);
      }
      formData.append('start_ts', (request.startTs ?? Date.now()).toString());
      formData.append('end_ts', (request.endTs ?? Date.now()).toString());
      formData.append('language', request.language ?? 'ja');
      // フィルターはBot側で行うので無効化
      formData.append('filter_aizuchi', 'false');

      // プロンプト（文脈や専門用語を指定）
      if (request.prompt) {
        formData.append('prompt', request.prompt);
      }

      const response = await this.executeWithRetry(async () => {
        return await this.client.post('/transcribe', formData, {
          headers: formData.getHeaders(),
        });
      });

      const data = response.data;
      const processingTimeMs = Date.now() - startTime;

      if (data.success && data.data) {
        return {
          success: true,
          text: data.data.text,
          language: data.data.language,
          confidence: data.data.confidence,
          processingTimeMs,
        };
      }

      return {
        success: false,
        error: {
          code: data.error?.code ?? 'UNKNOWN_ERROR',
          message: data.error?.message ?? 'Unknown error',
        },
        processingTimeMs,
      };
    } catch (error) {
      const processingTimeMs = Date.now() - startTime;
      const message = error instanceof Error ? error.message : 'Unknown error';

      logger.error('SelfHostedWhisperProvider transcription failed:', { error: message });

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
    try {
      const response = await this.client.get('/health', { timeout: 5000 });
      this._isHealthy = response.data.status === 'healthy';
      this._lastHealthCheck = Date.now();

      return {
        isHealthy: this._isHealthy,
        providerName: this.name,
        details: {
          modelLoaded: response.data.model_loaded,
          modelName: response.data.model_name,
          device: response.data.device,
          uptime: response.data.uptime_seconds,
          lastCheck: this._lastHealthCheck,
        },
      };
    } catch (error) {
      this._isHealthy = false;
      this._lastHealthCheck = Date.now();

      return {
        isHealthy: false,
        providerName: this.name,
        details: {
          error: error instanceof Error ? error.message : 'Unknown error',
          lastCheck: this._lastHealthCheck,
        },
      };
    }
  }

  isAvailable(): boolean {
    return this._isHealthy;
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

        if (this.isNonRetryableError(error)) {
          throw error;
        }

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

  private isNonRetryableError(error: unknown): boolean {
    if (isAxiosError(error)) {
      const status = error.response?.status;
      if (status !== undefined && status >= 400 && status < 500) {
        return status !== 408 && status !== 429;
      }
    }
    return false;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

