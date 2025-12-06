import { config } from 'dotenv';
import type { BotConfig } from '../types/index.js';

// .env ファイルを読み込む
config();

/**
 * 環境変数から設定値を取得（必須）
 */
function getEnvOrThrow(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Environment variable ${key} is required but not set`);
  }
  return value;
}

/**
 * 環境変数から設定値を取得（デフォルト値あり）
 */
function getEnvOrDefault(key: string, defaultValue: string): string {
  return process.env[key] ?? defaultValue;
}

/**
 * 環境変数から数値を取得
 */
function getEnvNumberOrDefault(key: string, defaultValue: number): number {
  const value = process.env[key];
  if (!value) return defaultValue;
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? defaultValue : parsed;
}

/**
 * 環境変数からブール値を取得
 */
function getEnvBooleanOrDefault(key: string, defaultValue: boolean): boolean {
  const value = process.env[key];
  if (!value) return defaultValue;
  return value.toLowerCase() === 'true';
}

/**
 * Bot設定
 */
export const botConfig: BotConfig = {
  // Discord
  token: getEnvOrThrow('DISCORD_BOT_TOKEN'),
  clientId: getEnvOrThrow('DISCORD_CLIENT_ID'),

  // 音声処理
  audio: {
    sampleRate: 48000,
    channels: 2,
    silenceThreshold: getEnvNumberOrDefault('AUDIO_SILENCE_THRESHOLD', 1500),  // 1.5秒沈黙で区切り
    maxSegmentDuration: getEnvNumberOrDefault('AUDIO_MAX_SEGMENT_DURATION', 30000),  // 30秒セグメント
    minSegmentDuration: getEnvNumberOrDefault('AUDIO_MIN_SEGMENT_DURATION', 1000),
    minRmsThreshold: parseFloat(process.env['AUDIO_MIN_RMS_THRESHOLD'] ?? '0.01'),  // 低エネルギーセグメント除去（コスト削減・ハルシネーション防止）
  },

  // Whisper API
  whisper: {
    apiUrl: getEnvOrDefault('WHISPER_API_URL', 'http://localhost:8000'),
    timeout: getEnvNumberOrDefault('WHISPER_API_TIMEOUT', 60000),
    retryCount: 3,
    retryDelay: 1000,
  },

  // 出力
  output: {
    logDir: getEnvOrDefault('OUTPUT_LOG_DIR', './logs'),
    segmentDir: getEnvOrDefault('OUTPUT_SEGMENT_DIR', './segments'),
    enableDiscordPost: getEnvBooleanOrDefault('OUTPUT_ENABLE_DISCORD_POST', true),
    enableFileLog: getEnvBooleanOrDefault('OUTPUT_ENABLE_FILE_LOG', true),
    enableJsonStore: getEnvBooleanOrDefault('OUTPUT_ENABLE_JSON_STORE', true),
    enableMarkdown: getEnvBooleanOrDefault('OUTPUT_ENABLE_MARKDOWN', true),
    enableSqlite: getEnvBooleanOrDefault('ENABLE_SQLITE', false),
    sqliteDbDir: getEnvOrDefault('SQLITE_DB_DIR', './data'),
    sqliteCleanupDays: getEnvNumberOrDefault('SQLITE_CLEANUP_DAYS', 30),
    discord: {
      format: (getEnvOrDefault('OUTPUT_DISCORD_FORMAT', 'standard') as 'standard' | 'compact' | 'embed'),
      showTimestamp: getEnvBooleanOrDefault('OUTPUT_DISCORD_SHOW_TIMESTAMP', true),
      showConfidence: getEnvBooleanOrDefault('OUTPUT_DISCORD_SHOW_CONFIDENCE', false),
      batchMessages: getEnvBooleanOrDefault('OUTPUT_DISCORD_BATCH_MESSAGES', true),
      batchIntervalMs: getEnvNumberOrDefault('OUTPUT_DISCORD_BATCH_INTERVAL_MS', 3000),
    },
  },

  // ログレベル
  logLevel: getEnvOrDefault('LOG_LEVEL', 'info'),
};

export default botConfig;

