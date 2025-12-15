/**
 * オフラインハンドラー
 * - API接続不可時のセグメント保存
 * - 復旧時の再処理
 */
import * as fs from 'fs/promises';
import * as path from 'path';
import { logger } from '../utils/logger.js';
import type { AudioSegment } from '../types/index.js';

/**
 * オフラインセグメントデータ（保存形式）
 */
interface OfflineSegmentData {
  id: string;
  userId: string;
  username: string;
  displayName: string;
  startTimestamp: number;
  endTimestamp: number;
  duration: number;
  audioDataBase64: string;
  audioFormat: 'ogg' | 'wav';
  audioPath?: string;
  sampleRate: number;
  channels: number;
  bitrate: number;
  savedAt: number;
}

/**
 * オフラインハンドラー設定
 */
interface OfflineHandlerConfig {
  directory: string;
  maxAgeMs: number; // 最大保持期間
}

/**
 * オフラインハンドラー
 */
export class OfflineHandler {
  private config: OfflineHandlerConfig;
  private pendingCount = 0;

  constructor(config: Partial<OfflineHandlerConfig> = {}) {
    this.config = {
      directory: config.directory ?? './offline_queue',
      maxAgeMs: config.maxAgeMs ?? 24 * 60 * 60 * 1000, // 24時間
    };

    logger.debug('OfflineHandler initialized', { config: this.config });
  }

  /**
   * セグメントをオフラインキューに保存
   */
  async saveForLater(segment: AudioSegment): Promise<void> {
    await fs.mkdir(this.config.directory, { recursive: true });

    const data: OfflineSegmentData = {
      id: segment.id,
      userId: segment.userId,
      username: segment.username,
      displayName: segment.displayName,
      startTimestamp: segment.startTimestamp,
      endTimestamp: segment.endTimestamp,
      duration: segment.duration,
      audioDataBase64: segment.audioData.toString('base64'),
      audioFormat: segment.audioFormat,
      audioPath: segment.audioPath,
      sampleRate: segment.sampleRate,
      channels: segment.channels,
      bitrate: segment.bitrate,
      savedAt: Date.now(),
    };

    const filename = `${segment.id}.json`;
    const filepath = path.join(this.config.directory, filename);

    await fs.writeFile(filepath, JSON.stringify(data, null, 2), 'utf-8');
    this.pendingCount++;

    logger.info(`Segment saved for later: ${segment.id}`, {
      filepath,
      pendingCount: this.pendingCount,
    });
  }

  /**
   * 保留中のセグメントを読み込み
   */
  async loadPending(): Promise<AudioSegment[]> {
    try {
      await fs.mkdir(this.config.directory, { recursive: true });
      const files = await fs.readdir(this.config.directory);
      const segments: AudioSegment[] = [];
      const now = Date.now();

      for (const file of files) {
        if (!file.endsWith('.json')) continue;

        const filepath = path.join(this.config.directory, file);
        try {
          const content = await fs.readFile(filepath, 'utf-8');
          const data: OfflineSegmentData = JSON.parse(content);

          // 古すぎるセグメントは削除
          if (now - data.savedAt > this.config.maxAgeMs) {
            await fs.unlink(filepath);
            logger.info(`Expired segment removed: ${data.id}`);
            continue;
          }

          segments.push({
            id: data.id,
            userId: data.userId,
            username: data.username,
            displayName: data.displayName,
            startTimestamp: data.startTimestamp,
            endTimestamp: data.endTimestamp,
            duration: data.duration,
            audioData: Buffer.from(data.audioDataBase64, 'base64'),
            audioFormat: data.audioFormat,
            audioPath: data.audioPath,
            sampleRate: data.sampleRate,
            channels: data.channels,
            bitrate: data.bitrate,
          });
        } catch (error) {
          logger.error(`Failed to load offline segment: ${filepath}`, {
            error: (error as Error).message,
          });
        }
      }

      // タイムスタンプ順にソート
      segments.sort((a, b) => a.startTimestamp - b.startTimestamp);
      this.pendingCount = segments.length;

      logger.info(`Loaded ${segments.length} pending segments`);
      return segments;
    } catch (error) {
      logger.error('Failed to load pending segments', {
        error: (error as Error).message,
      });
      return [];
    }
  }

  /**
   * 処理済みとしてマーク（削除）
   */
  async markProcessed(segmentId: string): Promise<void> {
    const filepath = path.join(this.config.directory, `${segmentId}.json`);
    try {
      await fs.unlink(filepath);
      this.pendingCount = Math.max(0, this.pendingCount - 1);
      logger.debug(`Segment marked as processed: ${segmentId}`);
    } catch {
      // ファイルが存在しない場合は無視
    }
  }

  /**
   * オフラインキューを処理
   */
  async processQueue(
    processor: (segment: AudioSegment) => Promise<boolean>
  ): Promise<{ processed: number; failed: number }> {
    const segments = await this.loadPending();
    let processed = 0;
    let failed = 0;

    for (const segment of segments) {
      try {
        const success = await processor(segment);
        if (success) {
          await this.markProcessed(segment.id);
          processed++;
        } else {
          failed++;
        }
      } catch (error) {
        logger.error(`Failed to process offline segment: ${segment.id}`, {
          error: (error as Error).message,
        });
        failed++;
      }
    }

    logger.info(`Offline queue processed: ${processed} success, ${failed} failed`);
    return { processed, failed };
  }

  /**
   * 保留中のセグメント数を取得
   */
  getPendingCount(): number {
    return this.pendingCount;
  }

  /**
   * オフラインキューをクリア
   */
  async clear(): Promise<number> {
    try {
      const files = await fs.readdir(this.config.directory);
      let count = 0;

      for (const file of files) {
        if (file.endsWith('.json')) {
          await fs.unlink(path.join(this.config.directory, file));
          count++;
        }
      }

      this.pendingCount = 0;
      logger.info(`Offline queue cleared: ${count} segments removed`);
      return count;
    } catch {
      return 0;
    }
  }
}

export default OfflineHandler;





