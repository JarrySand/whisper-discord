/**
 * Whisper API クライアント
 * - 環境変数に基づいてプロバイダーを選択
 * - self-hosted, groq, openai をサポート
 */
import axios, { AxiosInstance, isAxiosError } from 'axios';
import FormData from 'form-data';
import { logger } from '../utils/logger.js';
import { botConfig } from '../config/index.js';
import { createProviderFromEnv, createProviderForGuild } from './providers/index.js';
import type {
  TranscriptionProvider,
  TranscriptionRequest,
  TranscriptionResponse,
} from './transcription-provider.js';
import type {
  WhisperClientConfig,
  TranscribeRequest,
  TranscribeResponse,
  HealthCheckResponse,
} from '../types/index.js';

/**
 * Whisper APIクライアント
 * 
 * 環境変数 TRANSCRIPTION_PROVIDER に基づいてプロバイダーを選択:
 * - "self-hosted" または未設定: セルフホスト Whisper API
 * - "groq": Groq Whisper API
 * - "openai": OpenAI Whisper API
 */
export class WhisperClient {
  private client: AxiosInstance | null = null;
  private config: WhisperClientConfig;
  private isHealthy = true;
  private lastHealthCheck = 0;
  
  // 新しいプロバイダーシステム
  private provider: TranscriptionProvider | null = null;
  private providerType: string;

  constructor(config: Partial<WhisperClientConfig> = {}, guildId?: string) {
    this.providerType = process.env.TRANSCRIPTION_PROVIDER ?? 'self-hosted';

    this.config = {
      baseUrl: config.baseUrl ?? botConfig.whisper.apiUrl,
      timeout: config.timeout ?? botConfig.whisper.timeout,
      retryCount: config.retryCount ?? botConfig.whisper.retryCount,
      retryDelay: config.retryDelay ?? botConfig.whisper.retryDelay,
      retryBackoffMultiplier: config.retryBackoffMultiplier ?? 2,
    };

    // Guild別プロバイダーを使用（guildIdが指定されている場合）
    if (guildId) {
      this.provider = createProviderForGuild(guildId);
      this.providerType = this.provider.constructor.name.replace('Provider', '').toLowerCase();
      logger.info(`WhisperClient initialized with guild-specific provider for ${guildId}: ${this.providerType}`);
    } else if (this.providerType === 'groq' || this.providerType === 'openai') {
      // guildIdがない場合は環境変数から判断
      this.provider = createProviderFromEnv();
      logger.info(`WhisperClient initialized with ${this.providerType} provider`);
    } else {
      // セルフホスト Whisper API を使用
      this.client = axios.create({
        baseURL: this.config.baseUrl,
        timeout: this.config.timeout,
      });
      logger.info(`WhisperClient initialized: ${this.config.baseUrl}`);
    }
  }

  /**
   * 単一セグメントを文字起こし
   */
  async transcribe(request: TranscribeRequest): Promise<TranscribeResponse> {
    // クラウドプロバイダーを使用する場合
    if (this.provider) {
      return this.transcribeWithProvider(request);
    }

    // セルフホスト Whisper API を使用する場合
    return this.transcribeWithSelfHosted(request);
  }

  /**
   * クラウドプロバイダーで文字起こし
   */
  private async transcribeWithProvider(request: TranscribeRequest): Promise<TranscribeResponse> {
    if (!this.provider) {
      throw new Error('Provider not initialized');
    }

    const providerRequest: TranscriptionRequest = {
      audioData: request.audioData,
      audioFormat: request.audioFormat,
      language: request.language ?? 'ja',
      userId: request.userId,
      username: request.username,
    };

    const startTime = Date.now();
    const response: TranscriptionResponse = await this.provider.transcribe(providerRequest);
    const processingTime = Date.now() - startTime;

    if (response.success) {
      return {
        success: true,
        data: {
          user_id: request.userId,
          username: request.username,
          display_name: request.displayName ?? null,
          text: response.text ?? '',
          start_ts: request.startTs,
          end_ts: request.endTs,
          duration_ms: request.endTs - request.startTs,
          language: response.language ?? 'ja',
          confidence: response.confidence ?? 0.9,
          processing_time_ms: processingTime,
        },
      };
    } else {
      return {
        success: false,
        error: {
          code: response.error?.code ?? 'TRANSCRIPTION_FAILED',
          message: response.error?.message ?? 'Transcription failed',
        },
      };
    }
  }

  /**
   * セルフホスト Whisper API で文字起こし
   */
  private async transcribeWithSelfHosted(request: TranscribeRequest): Promise<TranscribeResponse> {
    if (!this.client) {
      throw new Error('HTTP client not initialized');
    }

    const formData = new FormData();

    // 音声ファイル
    formData.append('audio_file', request.audioData, {
      filename: `segment.${request.audioFormat}`,
      contentType: `audio/${request.audioFormat === 'ogg' ? 'ogg' : 'wav'}`,
    });

    // メタデータ
    formData.append('user_id', request.userId);
    formData.append('username', request.username);
    if (request.displayName) {
      formData.append('display_name', request.displayName);
    }
    formData.append('start_ts', request.startTs.toString());
    formData.append('end_ts', request.endTs.toString());
    formData.append('language', request.language ?? 'ja');

    return this.executeWithRetry(async () => {
      const response = await this.client!.post<TranscribeResponse>(
        '/transcribe',
        formData,
        {
          headers: formData.getHeaders(),
        }
      );
      return response.data;
    });
  }

  /**
   * 複数セグメントをバッチ処理
   */
  async transcribeBatch(requests: TranscribeRequest[]): Promise<TranscribeResponse[]> {
    if (requests.length === 0) {
      return [];
    }

    // クラウドプロバイダーの場合は順次処理
    if (this.provider) {
      const results: TranscribeResponse[] = [];
      for (const request of requests) {
        const result = await this.transcribe(request);
        results.push(result);
      }
      return results;
    }

    // セルフホスト API の場合はバッチ処理
    if (!this.client) {
      throw new Error('HTTP client not initialized');
    }

    const formData = new FormData();
    const metadata: Array<{
      user_id: string;
      username: string;
      display_name?: string;
      start_ts: number;
      end_ts: number;
      language: string;
    }> = [];

    // 複数の音声ファイルを追加
    requests.forEach((request, index) => {
      formData.append('files', request.audioData, {
        filename: `segment_${index}.${request.audioFormat}`,
        contentType: `audio/${request.audioFormat === 'ogg' ? 'ogg' : 'wav'}`,
      });

      metadata.push({
        user_id: request.userId,
        username: request.username,
        display_name: request.displayName,
        start_ts: request.startTs,
        end_ts: request.endTs,
        language: request.language ?? 'ja',
      });
    });

    formData.append('metadata', JSON.stringify(metadata));

    return this.executeWithRetry(async () => {
      const response = await this.client!.post<{
        success: boolean;
        data: { results: TranscribeResponse[] };
      }>('/transcribe/batch', formData, {
        headers: formData.getHeaders(),
        timeout: this.config.timeout * requests.length,
      });
      return response.data.data.results;
    });
  }

  /**
   * APIヘルスチェック
   */
  async healthCheck(): Promise<HealthCheckResponse> {
    // クラウドプロバイダーの場合
    if (this.provider) {
      const health = await this.provider.healthCheck();
      this.isHealthy = health.isHealthy;
      this.lastHealthCheck = Date.now();
      return {
        status: health.isHealthy ? 'healthy' : 'unhealthy',
        model_loaded: true,
        model_name: (health.details?.model as string) ?? this.providerType,
        device: 'cloud',
        compute_type: 'api',
        uptime_seconds: 0,
        requests_processed: 0,
        avg_processing_time_ms: 0,
      };
    }

    // セルフホスト API の場合
    if (!this.client) {
      throw new Error('HTTP client not initialized');
    }

    try {
      const response = await this.client.get<HealthCheckResponse>('/health', {
        timeout: 5000,
      });
      this.isHealthy = response.data.status === 'healthy';
      this.lastHealthCheck = Date.now();
      return response.data;
    } catch (error) {
      this.isHealthy = false;
      this.lastHealthCheck = Date.now();
      throw error;
    }
  }

  /**
   * リトライ付きで操作を実行
   */
  private async executeWithRetry<T>(operation: () => Promise<T>): Promise<T> {
    let lastError: Error | null = null;
    let delay = this.config.retryDelay;

    for (let attempt = 0; attempt <= this.config.retryCount; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error as Error;

        // リトライ不可のエラー
        if (this.isNonRetryableError(error)) {
          logger.error('Non-retryable error:', error);
          throw error;
        }

        // 最後の試行
        if (attempt === this.config.retryCount) {
          break;
        }

        // 待機してリトライ
        logger.warn(
          `Retry attempt ${attempt + 1}/${this.config.retryCount} after ${delay}ms`,
          { error: (error as Error).message }
        );
        await this.sleep(delay);
        delay *= this.config.retryBackoffMultiplier;
      }
    }

    logger.error(`All ${this.config.retryCount} retries exhausted`, {
      error: lastError?.message,
    });
    throw lastError;
  }

  /**
   * リトライ不可のエラーかチェック
   */
  private isNonRetryableError(error: unknown): boolean {
    if (isAxiosError(error)) {
      const status = error.response?.status;
      // 4xx エラーはリトライしない（400, 401, 403, 404等）
      // ただし 408 (Request Timeout) と 429 (Too Many Requests) は除く
      if (status !== undefined && status >= 400 && status < 500) {
        return status !== 408 && status !== 429;
      }
    }
    return false;
  }

  /**
   * スリープ
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * 現在のヘルス状態を取得
   */
  getHealthStatus(): { isHealthy: boolean; lastCheck: number } {
    return {
      isHealthy: this.isHealthy,
      lastCheck: this.lastHealthCheck,
    };
  }

  /**
   * 設定を取得
   */
  getConfig(): WhisperClientConfig {
    return { ...this.config };
  }

  /**
   * プロバイダータイプを取得
   */
  getProviderType(): string {
    return this.providerType;
  }
}

export default WhisperClient;
