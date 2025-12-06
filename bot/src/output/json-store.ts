/**
 * JSONストアサービス
 * - セッションごとにJSON形式でデータを保存
 * - AI解析やデータ処理に適した構造化データ
 * - 参加者情報と統計情報を自動計算
 */
import * as fs from 'fs/promises';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { logger } from '../utils/logger.js';
import type {
  TranscriptionResult,
  JsonStoreConfig,
  TranscriptionSessionJson,
  TranscriptionSegmentJson,
  SessionStatsJson,
} from '../types/index.js';

/**
 * デフォルト設定
 */
const defaultConfig: JsonStoreConfig = {
  baseDir: './logs',
  saveIntervalMs: 10000,
  prettyPrint: true,
};

/**
 * JSONストアサービス
 */
export class JsonStoreService {
  private config: JsonStoreConfig;
  private session: TranscriptionSessionJson | null = null;
  private jsonPath: string | null = null;
  private saveTimer: NodeJS.Timeout | null = null;

  constructor(config: Partial<JsonStoreConfig> = {}) {
    this.config = { ...defaultConfig, ...config };
    logger.debug('JsonStoreService initialized', { config: this.config });
  }

  /**
   * セッションを開始
   */
  async startSession(
    guildId: string,
    guildName: string,
    channelId: string,
    channelName: string
  ): Promise<void> {
    const now = new Date();
    const sessionId = this.generateSessionId();

    this.session = {
      version: '1.0.0',
      session_id: sessionId,
      guild_id: guildId,
      guild_name: guildName,
      channel_id: channelId,
      channel_name: channelName,
      session_start: now.toISOString(),
      session_end: '',
      duration_ms: 0,
      participants: [],
      segments: [],
      stats: this.initStats(),
    };

    // ファイルパス設定
    const dateDir = path.join(this.config.baseDir, now.toISOString().split('T')[0]);
    await fs.mkdir(dateDir, { recursive: true });

    const timeStr = now.toTimeString().slice(0, 8).replace(/:/g, '-');
    this.jsonPath = path.join(dateDir, `${sessionId}-${timeStr}.json`);

    // 初期保存
    await this.save();

    // 定期保存開始
    this.startSaveTimer();

    logger.info('JsonStoreService session started', { sessionId, jsonPath: this.jsonPath });
  }

  /**
   * セグメントを追加
   */
  async addSegment(result: TranscriptionResult): Promise<void> {
    if (!this.session) {
      logger.warn('No active session for JSON store');
      return;
    }

    // セグメント追加
    const segment: TranscriptionSegmentJson = {
      id: result.segmentId || randomUUID(),
      user_id: result.userId,
      username: result.username,
      display_name: result.displayName ?? result.username,
      text: result.text,
      start_ts: result.startTs,
      end_ts: result.endTs,
      duration_ms: result.durationMs,
      confidence: result.confidence,
      language: result.language || 'ja',
    };

    this.session.segments.push(segment);

    // 参加者情報更新
    this.updateParticipant(result);

    // 統計更新
    this.updateStats(segment);
  }

  /**
   * セッションを終了
   */
  async endSession(): Promise<void> {
    if (!this.session) return;

    this.stopSaveTimer();

    // セッション終了情報
    const endTime = new Date();
    this.session.session_end = endTime.toISOString();
    this.session.duration_ms =
      endTime.getTime() - new Date(this.session.session_start).getTime();

    // 最終統計計算
    this.finalizeStats();

    // 保存
    await this.save();

    logger.info('JsonStoreService session ended', {
      sessionId: this.session.session_id,
      segments: this.session.segments.length,
    });

    this.session = null;
    this.jsonPath = null;
  }

  /**
   * 参加者情報を更新
   */
  private updateParticipant(result: TranscriptionResult): void {
    let participant = this.session!.participants.find(
      (p) => p.user_id === result.userId
    );

    if (!participant) {
      participant = {
        user_id: result.userId,
        username: result.username,
        display_name: result.displayName ?? result.username,
        avatar_url: null,
        utterance_count: 0,
        total_speaking_time_ms: 0,
      };
      this.session!.participants.push(participant);
    }

    participant.utterance_count++;
    participant.total_speaking_time_ms += result.durationMs;
  }

  /**
   * 統計を更新
   */
  private updateStats(segment: TranscriptionSegmentJson): void {
    const stats = this.session!.stats;
    stats.total_segments++;
    stats.total_duration_ms += segment.duration_ms;

    // 信頼度の移動平均
    const n = stats.total_segments;
    stats.avg_confidence =
      (stats.avg_confidence * (n - 1) + segment.confidence) / n;
  }

  /**
   * 最終統計を計算
   */
  private finalizeStats(): void {
    const stats = this.session!.stats;

    if (stats.total_segments > 0) {
      stats.avg_segment_duration_ms =
        stats.total_duration_ms / stats.total_segments;
    }

    stats.participant_count = this.session!.participants.length;

    // WPM計算（日本語は文字数ベース）
    const totalChars = this.session!.segments.reduce(
      (sum, s) => sum + s.text.length,
      0
    );
    const durationMinutes = this.session!.duration_ms / 60000;
    stats.words_per_minute =
      durationMinutes > 0 ? Math.round(totalChars / durationMinutes) : 0;
  }

  /**
   * データを保存
   */
  async save(): Promise<void> {
    if (!this.session || !this.jsonPath) return;

    try {
      const content = this.config.prettyPrint
        ? JSON.stringify(this.session, null, 2)
        : JSON.stringify(this.session);

      await fs.writeFile(this.jsonPath, content, 'utf-8');
    } catch (error) {
      logger.error('Failed to save JSON store', { error });
    }
  }

  /**
   * 定期保存タイマーを開始
   */
  private startSaveTimer(): void {
    this.saveTimer = setInterval(() => this.save(), this.config.saveIntervalMs);
  }

  /**
   * 定期保存タイマーを停止
   */
  private stopSaveTimer(): void {
    if (this.saveTimer) {
      clearInterval(this.saveTimer);
      this.saveTimer = null;
    }
  }

  /**
   * 初期統計を作成
   */
  private initStats(): SessionStatsJson {
    return {
      total_segments: 0,
      total_duration_ms: 0,
      avg_segment_duration_ms: 0,
      avg_confidence: 0,
      words_per_minute: 0,
      participant_count: 0,
    };
  }

  /**
   * セッションIDを生成
   */
  private generateSessionId(): string {
    return `session-${Date.now().toString(36)}`;
  }

  /**
   * 現在のJSONパスを取得
   */
  getJsonPath(): string | null {
    return this.jsonPath;
  }

  /**
   * 現在のセッションデータを取得
   */
  getSessionData(): TranscriptionSessionJson | null {
    return this.session;
  }
}

export default JsonStoreService;

