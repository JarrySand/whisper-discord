/**
 * 処理キュー
 * - 優先度付きキュー
 * - 並行処理制御
 * - リトライ処理
 */
import { EventEmitter } from 'events';
import { logger } from '../utils/logger.js';
import type { WhisperClient } from './whisper-client.js';
import type { CircuitBreaker } from './circuit-breaker.js';
import type {
  AudioSegment,
  QueueConfig,
  QueueItem,
  QueueStatus,
  TranscribeResponse,
} from '../types/index.js';

/**
 * ホットワード取得関数の型
 */
export type HotwordsProvider = () => string[];

/**
 * 文字起こしキュー
 */
export class TranscriptionQueue extends EventEmitter {
  private queue: QueueItem[] = [];
  private processing = new Map<string, QueueItem>();
  private config: QueueConfig;
  private whisperClient: WhisperClient;
  private circuitBreaker: CircuitBreaker | null;
  private hotwordsProvider: HotwordsProvider | null;
  private isRunning = false;

  // レート制限対策: 最後のリクエスト時刻
  private lastRequestTime = 0;
  private readonly minRequestInterval = 3500; // 3.5秒間隔 (20リクエスト/分以下)

  constructor(
    whisperClient: WhisperClient,
    config: Partial<QueueConfig> = {},
    circuitBreaker: CircuitBreaker | null = null,
    hotwordsProvider: HotwordsProvider | null = null
  ) {
    super();
    this.whisperClient = whisperClient;
    this.circuitBreaker = circuitBreaker;
    this.hotwordsProvider = hotwordsProvider;
    this.config = {
      maxSize: config.maxSize ?? 100,
      maxRetries: config.maxRetries ?? 3,
      concurrency: config.concurrency ?? 1,  // レート制限対策: 1つずつ処理
      processingTimeout: config.processingTimeout ?? 60000,  // タイムアウト短縮
    };

    logger.debug('TranscriptionQueue initialized', { config: this.config });
  }

  /**
   * セグメントをキューに追加
   */
  enqueue(segment: AudioSegment, priority?: number): string {
    // キューサイズチェック
    if (this.queue.length >= this.config.maxSize) {
      const removed = this.queue.shift();
      if (removed) {
        logger.warn(`Queue full, dropping oldest segment: ${removed.id}`);
        this.emit('dropped', removed);
      }
    }

    const item: QueueItem = {
      id: segment.id,
      segment,
      addedAt: Date.now(),
      retryCount: 0,
      priority: priority ?? this.calculatePriority(segment),
    };

    // 優先度順に挿入（高い方が先）
    const insertIndex = this.queue.findIndex((q) => q.priority < item.priority);
    if (insertIndex === -1) {
      this.queue.push(item);
    } else {
      this.queue.splice(insertIndex, 0, item);
    }

    logger.debug(`Segment enqueued: ${item.id}`, {
      queueLength: this.queue.length,
      priority: item.priority,
    });
    this.emit('enqueued', item);

    // 処理開始
    this.processNext();

    return item.id;
  }

  /**
   * 優先度を計算（新しいセグメントほど高い）
   */
  private calculatePriority(segment: AudioSegment): number {
    return segment.startTimestamp;
  }

  /**
   * 次のアイテムを処理
   */
  private async processNext(): Promise<void> {
    if (!this.isRunning) {
      logger.debug('Queue not running, skipping processNext');
      return;
    }
    if (this.processing.size >= this.config.concurrency) {
      logger.debug(`Queue at max concurrency (${this.processing.size}/${this.config.concurrency}), waiting`);
      return;
    }
    if (this.queue.length === 0) {
      return;
    }

    const item = this.queue.shift()!;
    this.processing.set(item.id, item);

    // レート制限対策: 前回リクエストから最低間隔を待つ
    const now = Date.now();
    const elapsed = now - this.lastRequestTime;
    if (elapsed < this.minRequestInterval) {
      const waitTime = this.minRequestInterval - elapsed;
      logger.debug(`Rate limit: waiting ${waitTime}ms before next request`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
    this.lastRequestTime = Date.now();

    logger.info(`Processing segment: ${item.id}`, {
      processingCount: this.processing.size,
      queueLength: this.queue.length,
    });

    try {
      const result = await this.processItem(item);
      this.processing.delete(item.id);

      if (result.success) {
        logger.info(`Transcription completed: ${item.id}`, {
          text: result.data?.text.substring(0, 50),
          processingTime: result.data?.processing_time_ms,
        });
        this.emit('completed', item, result);
      } else {
        throw new Error(result.error?.message ?? 'Unknown error');
      }
    } catch (error) {
      this.processing.delete(item.id);
      await this.handleError(item, error as Error);
    }

    // 次の処理を開始
    setImmediate(() => this.processNext());
  }

  /**
   * アイテムを処理
   */
  private async processItem(item: QueueItem): Promise<TranscribeResponse> {
    // タイムアウト設定
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(
        () => reject(new Error('Processing timeout')),
        this.config.processingTimeout
      );
    });

    // ホットワードを取得
    const hotwords = this.hotwordsProvider ? this.hotwordsProvider() : undefined;

    // サーキットブレーカー経由で実行
    const transcribeOperation = async (): Promise<TranscribeResponse> => {
      return this.whisperClient.transcribe({
        audioData: item.segment.audioData,
        audioFormat: item.segment.audioFormat,
        userId: item.segment.userId,
        username: item.segment.username,
        displayName: item.segment.displayName,
        startTs: item.segment.startTimestamp,
        endTs: item.segment.endTimestamp,
        hotwords,
      });
    };

    // サーキットブレーカーがあれば経由
    if (this.circuitBreaker) {
      return Promise.race([
        this.circuitBreaker.execute(transcribeOperation),
        timeoutPromise,
      ]);
    }

    return Promise.race([transcribeOperation(), timeoutPromise]);
  }

  /**
   * エラー処理
   */
  private async handleError(item: QueueItem, error: Error): Promise<void> {
    item.retryCount++;

    if (item.retryCount <= this.config.maxRetries) {
      // リキュー（先頭に）
      this.queue.unshift(item);
      logger.warn(
        `Retrying segment: ${item.id} (${item.retryCount}/${this.config.maxRetries})`,
        { error: error.message }
      );
      this.emit('retry', item, error);
    } else {
      // 最終失敗
      logger.error(`Segment failed permanently: ${item.id}`, {
        error: error.message,
        retries: item.retryCount,
      });
      this.emit('failed', item, error);
    }
  }

  /**
   * キュー処理開始
   */
  start(): void {
    if (this.isRunning) {
      logger.warn('TranscriptionQueue is already running');
      return;
    }

    this.isRunning = true;
    logger.info('TranscriptionQueue started');

    // 並行処理を開始
    for (let i = 0; i < this.config.concurrency; i++) {
      this.processNext();
    }
  }

  /**
   * キュー処理停止
   */
  stop(): void {
    this.isRunning = false;
    logger.info('TranscriptionQueue stopped');
  }

  /**
   * キューをクリア
   */
  clear(): void {
    const count = this.queue.length;
    this.queue = [];
    logger.info(`Queue cleared: ${count} items removed`);
    this.emit('cleared', count);
  }

  /**
   * ステータス取得
   */
  getStatus(): QueueStatus {
    return {
      queued: this.queue.length,
      processing: this.processing.size,
      isRunning: this.isRunning,
    };
  }

  /**
   * 設定取得
   */
  getConfig(): QueueConfig {
    return { ...this.config };
  }
}

export default TranscriptionQueue;



