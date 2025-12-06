/**
 * 文字起こしプロバイダー抽象インターフェース
 *
 * ローカル Whisper API、OpenAI API、その他のサービスを
 * 統一されたインターフェースで扱えるようにする
 */

/**
 * 文字起こしリクエスト
 */
export interface TranscriptionRequest {
  audioData: Buffer;
  audioFormat: 'ogg' | 'wav' | 'mp3' | 'webm';
  language?: string;
  // メタデータ（プロバイダーによっては使用しない）
  userId?: string;
  username?: string;
  displayName?: string;
  startTs?: number;
  endTs?: number;
}

/**
 * 文字起こし結果
 */
export interface TranscriptionResponse {
  success: boolean;
  text?: string;
  language?: string;
  confidence?: number;
  processingTimeMs?: number;
  error?: {
    code: string;
    message: string;
  };
}

/**
 * プロバイダーのヘルス情報
 */
export interface ProviderHealth {
  isHealthy: boolean;
  providerName: string;
  details?: Record<string, unknown>;
}

/**
 * 文字起こしプロバイダーインターフェース
 */
export interface TranscriptionProvider {
  /**
   * プロバイダー名
   */
  readonly name: string;

  /**
   * 音声を文字起こし
   */
  transcribe(request: TranscriptionRequest): Promise<TranscriptionResponse>;

  /**
   * ヘルスチェック
   */
  healthCheck(): Promise<ProviderHealth>;

  /**
   * プロバイダーが利用可能か
   */
  isAvailable(): boolean;
}

/**
 * プロバイダー設定の基底型
 */
export interface BaseProviderConfig {
  timeout?: number;
  retryCount?: number;
  retryDelay?: number;
}

/**
 * セルフホスト Whisper API 設定
 * ローカルまたは外部サーバーの faster-whisper API に接続
 */
export interface SelfHostedWhisperConfig extends BaseProviderConfig {
  type: 'self-hosted';
  baseUrl: string;
}

/** @deprecated Use SelfHostedWhisperConfig instead */
export type LocalWhisperConfig = SelfHostedWhisperConfig;

/**
 * OpenAI API 設定
 */
export interface OpenAIConfig extends BaseProviderConfig {
  type: 'openai';
  apiKey: string;
  model?: 'whisper-1';
}

/**
 * プロバイダー設定のユニオン型
 */
export type ProviderConfig = SelfHostedWhisperConfig | OpenAIConfig;

