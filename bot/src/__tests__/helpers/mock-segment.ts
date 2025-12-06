/**
 * テスト用のモックセグメント・レスポンス生成ヘルパー
 */
import type {
  AudioSegment,
  TranscribeResponse,
  TranscriptionResult,
} from '../../types/index.js';

/**
 * モックのAudioSegmentを作成
 */
export function createMockSegment(overrides: Partial<AudioSegment> = {}): AudioSegment {
  const now = Date.now();
  return {
    id: `seg-${Math.random().toString(36).slice(2, 10)}`,
    userId: 'user-1',
    username: 'testuser',
    displayName: 'Test User',
    startTimestamp: overrides.startTimestamp ?? now - 3000,
    endTimestamp: overrides.endTimestamp ?? now,
    duration: overrides.duration ?? 3000,
    audioData: Buffer.from('mock-audio'),
    audioFormat: 'ogg',
    sampleRate: 16000,
    channels: 1,
    bitrate: 32000,
    ...overrides,
  };
}

/**
 * モックの成功レスポンスを作成
 */
export function createMockSuccessResponse(overrides: Partial<TranscribeResponse['data']> = {}): TranscribeResponse {
  const now = Date.now();
  return {
    success: true,
    data: {
      user_id: 'user-1',
      username: 'testuser',
      display_name: 'Test User',
      text: 'こんにちは、テストです。',
      start_ts: now - 3000,
      end_ts: now,
      duration_ms: 3000,
      language: 'ja',
      confidence: 0.95,
      processing_time_ms: 500,
      ...overrides,
    },
  };
}

/**
 * モックの失敗レスポンスを作成
 */
export function createMockErrorResponse(
  code = 'ERROR',
  message = 'Mock error'
): TranscribeResponse {
  return {
    success: false,
    error: { code, message },
  };
}

/**
 * モックのTranscriptionResultを作成
 */
export function createMockResult(overrides: Partial<TranscriptionResult> = {}): TranscriptionResult {
  const now = Date.now();
  return {
    segmentId: `seg-${Math.random().toString(36).slice(2, 10)}`,
    userId: 'user-1',
    username: 'testuser',
    displayName: 'Test User',
    text: 'こんにちは、テストです。',
    startTs: now - 3000,
    endTs: now,
    durationMs: 3000,
    language: 'ja',
    confidence: 0.95,
    processingTimeMs: 500,
    ...overrides,
  };
}

