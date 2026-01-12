import type { UserAudioBuffer, AudioSegment } from '../types/index.js';
import { AudioSegmenter } from './segmenter.js';
import { logger } from '../utils/logger.js';
import { botConfig } from '../config/index.js';

/**
 * ユーザー別音声バッファ管理
 */
export class AudioBufferManager {
  private buffers = new Map<string, UserAudioBuffer>();
  private segmenter: AudioSegmenter;
  private readonly maxBufferDuration: number;
  private readonly silenceThreshold: number;
  
  // フラッシュ中フラグ（重複フラッシュ防止）
  private flushingUsers = new Set<string>();

  // セグメント生成時のコールバック
  private onSegmentCallback?: (segment: AudioSegment) => Promise<void>;

  constructor() {
    this.segmenter = new AudioSegmenter();
    this.maxBufferDuration = botConfig.audio.maxSegmentDuration;
    this.silenceThreshold = botConfig.audio.silenceThreshold;
  }

  /**
   * セグメント生成時のコールバックを設定
   */
  onSegment(callback: (segment: AudioSegment) => Promise<void>): void {
    this.onSegmentCallback = callback;
  }

  /**
   * 音声データを追加
   */
  appendAudio(
    userId: string,
    username: string,
    displayName: string,
    data: Buffer
  ): void {
    const buffer = this.getOrCreateBuffer(userId, username, displayName);
    const now = Date.now();

    if (buffer.startTimestamp === null) {
      buffer.startTimestamp = now;
    }

    buffer.chunks.push({ data, timestamp: now });
    buffer.lastActivityTimestamp = now;

    // 最大長に達したら強制セグメント化（フラッシュ中でなければ）
    if (!this.flushingUsers.has(userId) && this.getBufferDuration(buffer) >= this.maxBufferDuration) {
      void this.flushBuffer(userId);
    }
  }

  /**
   * バッファを取得または作成
   */
  private getOrCreateBuffer(
    userId: string,
    username: string,
    displayName: string
  ): UserAudioBuffer {
    let buffer = this.buffers.get(userId);
    if (!buffer) {
      buffer = {
        userId,
        username,
        displayName,
        chunks: [],
        startTimestamp: null,
        lastActivityTimestamp: Date.now(),
      };
      this.buffers.set(userId, buffer);
    }
    return buffer;
  }

  /**
   * バッファの長さ（ms）を取得
   */
  private getBufferDuration(buffer: UserAudioBuffer): number {
    if (!buffer.startTimestamp) return 0;
    return buffer.lastActivityTimestamp - buffer.startTimestamp;
  }

  /**
   * 無音検知でセグメント化をチェック
   */
  async checkAndFlush(userId: string): Promise<void> {
    const buffer = this.buffers.get(userId);
    if (!buffer) return;

    const silenceDuration = Date.now() - buffer.lastActivityTimestamp;
    if (silenceDuration >= this.silenceThreshold) {
      await this.flushBuffer(userId);
    }
  }

  /**
   * バッファをセグメントとして出力
   */
  async flushBuffer(userId: string): Promise<void> {
    // すでにフラッシュ中の場合はスキップ
    if (this.flushingUsers.has(userId)) {
      return;
    }
    
    const buffer = this.buffers.get(userId);
    if (!buffer || buffer.chunks.length === 0) return;

    // フラッシュ中フラグを設定
    this.flushingUsers.add(userId);

    try {
      const segment = await this.segmenter.createSegment(buffer);
      this.resetBuffer(userId);

      if (segment) {
        logger.info(
          `Created segment: ${segment.id} for user ${segment.displayName} (${segment.duration}ms)`
        );

        // コールバックを呼び出し
        if (this.onSegmentCallback) {
          await this.onSegmentCallback(segment);
        }
      }
    } catch (error) {
      logger.error(`Error flushing buffer for user ${userId}:`, error);
      this.resetBuffer(userId);
    } finally {
      // フラッシュ中フラグを解除
      this.flushingUsers.delete(userId);
    }
  }

  /**
   * バッファをリセット（メモリを積極的に解放）
   */
  private resetBuffer(userId: string): void {
    const buffer = this.buffers.get(userId);
    if (buffer) {
      // 明示的にchunksをクリアしてGCを促す
      buffer.chunks.length = 0;
      buffer.chunks = [];
      buffer.startTimestamp = null;
    }
  }

  /**
   * すべてのバッファをフラッシュ
   */
  async flushAll(): Promise<void> {
    const userIds = Array.from(this.buffers.keys());
    for (const userId of userIds) {
      await this.flushBuffer(userId);
    }
  }

  /**
   * すべてクリア
   */
  clear(): void {
    this.buffers.clear();
    this.flushingUsers.clear();
  }

  /**
   * バッファ数を取得
   */
  get size(): number {
    return this.buffers.size;
  }

  /**
   * 特定ユーザーのバッファサイズを取得
   */
  getBufferSize(userId: string): number {
    const buffer = this.buffers.get(userId);
    if (!buffer) return 0;
    return buffer.chunks.reduce((sum, chunk) => sum + chunk.data.length, 0);
  }
}

