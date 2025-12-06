import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';

/**
 * スラッシュコマンド定義
 */
export interface Command {
  data: SlashCommandBuilder;
  execute: (interaction: ChatInputCommandInteraction) => Promise<void>;
}

/**
 * SSRC → ユーザー情報マッピング
 */
export interface SSRCUserInfo {
  userId: string;
  username: string;
  displayName: string;
  joinedAt: Date;
}

/**
 * 音声チャンク
 */
export interface AudioChunk {
  data: Buffer;
  timestamp: number;
}

/**
 * ユーザー別音声バッファ
 */
export interface UserAudioBuffer {
  userId: string;
  username: string;
  displayName: string;
  chunks: AudioChunk[];
  startTimestamp: number | null;
  lastActivityTimestamp: number;
}

/**
 * 音声セグメント
 */
export interface AudioSegment {
  id: string;
  userId: string;
  username: string;
  displayName: string;
  startTimestamp: number;
  endTimestamp: number;
  duration: number;
  audioData: Buffer;
  audioFormat: 'ogg' | 'wav';
  audioPath?: string;
  sampleRate: number;
  channels: number;
  bitrate: number;
}

/**
 * 無音検知設定
 */
export interface SilenceDetectionConfig {
  amplitudeThreshold: number;
  silenceDuration: number;
  windowSize: number;
  silenceRatio: number;
}

/**
 * セグメンター設定
 */
export interface SegmenterConfig {
  minDuration: number;
  maxDuration: number;
  minRmsThreshold: number;  // 最小RMS閾値（これ以下は無音として破棄）
  saveToFile: boolean;
  segmentDir: string;
}

/**
 * Bot設定
 */
export interface BotConfig {
  token: string;
  clientId: string;
  audio: {
    sampleRate: number;
    channels: number;
    silenceThreshold: number;
    maxSegmentDuration: number;
    minSegmentDuration: number;
    minRmsThreshold: number;  // 最小RMS閾値（コスト削減用）
  };
  whisper: {
    apiUrl: string;
    timeout: number;
    retryCount: number;
    retryDelay: number;
  };
  output: {
    logDir: string;
    segmentDir: string;
    enableDiscordPost: boolean;
    enableFileLog: boolean;
    enableJsonStore: boolean;
    enableMarkdown: boolean;
    enableSqlite: boolean;
    sqliteDbDir: string;
    sqliteCleanupDays: number;
    discord: {
      format: 'standard' | 'compact' | 'embed';
      showTimestamp: boolean;
      showConfidence: boolean;
      batchMessages: boolean;
      batchIntervalMs: number;
    };
  };
  logLevel: string;
}

/**
 * Bot エラーコード
 */
export enum BotErrorCode {
  // 接続系
  NOT_IN_VOICE_CHANNEL = 'E001',
  ALREADY_CONNECTED = 'E002',
  CONNECTION_FAILED = 'E003',
  CONNECTION_LOST = 'E004',

  // 権限系
  MISSING_PERMISSIONS = 'E101',
  BOT_NOT_INVITED = 'E102',

  // 音声処理系
  AUDIO_BUFFER_OVERFLOW = 'E201',
  ENCODING_FAILED = 'E202',

  // API系
  WHISPER_API_UNAVAILABLE = 'E301',
  WHISPER_API_TIMEOUT = 'E302',
}

/**
 * VCセッション情報
 */
export interface VoiceSession {
  guildId: string;
  channelId: string;
  outputChannelId?: string;
  startedAt: Date;
  transcriptionCount: number;
}

// =============================================================================
// Phase 3: API 統合用型定義
// =============================================================================

/**
 * Whisper クライアント設定
 */
export interface WhisperClientConfig {
  baseUrl: string;
  timeout: number;
  retryCount: number;
  retryDelay: number;
  retryBackoffMultiplier: number;
}

/**
 * 文字起こしリクエスト
 */
export interface TranscribeRequest {
  audioData: Buffer;
  audioFormat: 'ogg' | 'wav';
  userId: string;
  username: string;
  displayName?: string;
  startTs: number;
  endTs: number;
  language?: string;
}

/**
 * 文字起こしレスポンス
 */
export interface TranscribeResponse {
  success: boolean;
  data?: {
    user_id: string;
    username: string;
    display_name: string | null;
    text: string;
    start_ts: number;
    end_ts: number;
    duration_ms: number;
    language: string;
    confidence: number;
    processing_time_ms: number;
  };
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
}

/**
 * ヘルスチェックレスポンス
 */
export interface HealthCheckResponse {
  status: string;
  model_loaded: boolean;
  model_name: string;
  device: string;
  compute_type: string;
  uptime_seconds: number;
  requests_processed: number;
  avg_processing_time_ms: number;
}

/**
 * 文字起こし結果
 */
export interface TranscriptionResult {
  segmentId: string;
  userId: string;
  username: string;
  displayName?: string;
  text: string;
  startTs: number;
  endTs: number;
  durationMs: number;
  language: string;
  confidence: number;
  processingTimeMs: number;
}

/**
 * キュー設定
 */
export interface QueueConfig {
  maxSize: number;
  maxRetries: number;
  concurrency: number;
  processingTimeout: number;
}

/**
 * キューアイテム
 */
export interface QueueItem {
  id: string;
  segment: AudioSegment;
  addedAt: number;
  retryCount: number;
  priority: number;
}

/**
 * キューステータス
 */
export interface QueueStatus {
  queued: number;
  processing: number;
  isRunning: boolean;
}

/**
 * サーキットブレーカー設定
 */
export interface CircuitBreakerConfig {
  failureThreshold: number;
  successThreshold: number;
  timeout: number;
  monitoringPeriod: number;
}

/**
 * ヘルスモニター設定
 */
export interface HealthMonitorConfig {
  checkInterval: number;
  healthyThreshold: number;
  unhealthyThreshold: number;
}

/**
 * 文字起こしメトリクス
 */
export interface TranscriptionMetrics {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  retriedRequests: number;
  avgProcessingTimeMs: number;
  minProcessingTimeMs: number;
  maxProcessingTimeMs: number;
  p95ProcessingTimeMs: number;
  segmentsPerMinute: number;
  wordsPerMinute: number;
  errorRate: number;
  currentQueueLength: number;
  avgQueueWaitTimeMs: number;
}

/**
 * セッションコンテキスト
 */
export interface SessionContext {
  guildId: string;
  channelId: string;
  outputChannelId?: string;
  startedAt: Date;
  participants: Map<string, { userId: string; username: string; displayName: string }>;
}

/**
 * 文字起こしサービス設定
 */
export interface TranscriptionServiceConfig {
  whisper: Partial<WhisperClientConfig>;
  queue: Partial<QueueConfig>;
  circuitBreaker: Partial<CircuitBreakerConfig>;
  healthMonitor: Partial<HealthMonitorConfig>;
  offline: {
    directory: string;
    maxAgeMs?: number;
  };
}

/**
 * 文字起こしサービスステータス
 */
export interface TranscriptionServiceStatus {
  isRunning: boolean;
  sessionContext: SessionContext | null;
  queue: QueueStatus;
  circuitBreaker: {
    state: string;
    failures: number;
    successes: number;
    lastFailureTime: number;
    lastStateChange: number;
  };
  health: {
    isHealthy: boolean;
    lastCheck: number;
    consecutiveSuccesses: number;
    consecutiveFailures: number;
    isRunning: boolean;
  };
  offlinePending: number;
  metrics: TranscriptionMetrics;
}

// =============================================================================
// Phase 4: 出力サービス用型定義
// =============================================================================

/**
 * Discord出力フォーマット
 */
export type DiscordOutputFormat = 'standard' | 'compact' | 'embed';

/**
 * Discord出力設定
 */
export interface DiscordOutputConfig {
  format: DiscordOutputFormat;
  showTimestamp: boolean;
  showConfidence: boolean;
  batchMessages: boolean;
  batchIntervalMs: number;
}

/**
 * ファイルロガー設定
 */
export interface FileLoggerConfig {
  baseDir: string;
  encoding: BufferEncoding;
  flushIntervalMs: number;
}

/**
 * JSONストア設定
 */
export interface JsonStoreConfig {
  baseDir: string;
  saveIntervalMs: number;
  prettyPrint: boolean;
}

/**
 * Markdownライター設定
 */
export interface MarkdownWriterConfig {
  baseDir: string;
  includeStats: boolean;
  includeTimestamps: boolean;
}

/**
 * SQLiteストア設定
 */
export interface SqliteStoreConfig {
  dbDir: string;
  cleanupDays: number;
}

/**
 * 出力マネージャー設定
 */
export interface OutputManagerConfig {
  discord: {
    enabled: boolean;
    config: Partial<DiscordOutputConfig>;
  };
  fileLog: {
    enabled: boolean;
    config: Partial<FileLoggerConfig>;
  };
  jsonStore: {
    enabled: boolean;
    config: Partial<JsonStoreConfig>;
  };
  markdown: {
    enabled: boolean;
    config: Partial<MarkdownWriterConfig>;
  };
  sqlite: {
    enabled: boolean;
    config: Partial<SqliteStoreConfig>;
  };
}

/**
 * 出力用セッション情報
 */
export interface OutputSessionInfo {
  id: string;
  guildId: string;
  guildName: string;
  channelId: string;
  channelName: string;
  startTime: Date;
  participants: Map<string, ParticipantInfo>;
  utteranceCount: number;
}

/**
 * 参加者情報
 */
export interface ParticipantInfo {
  userId: string;
  username: string;
  displayName: string;
  avatarUrl?: string;
  utteranceCount: number;
  totalSpeakingTimeMs: number;
}

/**
 * JSON出力用セッションスキーマ
 */
export interface TranscriptionSessionJson {
  version: string;
  session_id: string;
  guild_id: string;
  guild_name: string;
  channel_id: string;
  channel_name: string;
  session_start: string;
  session_end: string;
  duration_ms: number;
  participants: ParticipantJson[];
  segments: TranscriptionSegmentJson[];
  stats: SessionStatsJson;
}

/**
 * JSON出力用参加者スキーマ
 */
export interface ParticipantJson {
  user_id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  utterance_count: number;
  total_speaking_time_ms: number;
}

/**
 * JSON出力用セグメントスキーマ
 */
export interface TranscriptionSegmentJson {
  id: string;
  user_id: string;
  username: string;
  display_name: string;
  text: string;
  start_ts: number;
  end_ts: number;
  duration_ms: number;
  confidence: number;
  language: string;
}

/**
 * JSON出力用統計スキーマ
 */
export interface SessionStatsJson {
  total_segments: number;
  total_duration_ms: number;
  avg_segment_duration_ms: number;
  avg_confidence: number;
  words_per_minute: number;
  participant_count: number;
}

