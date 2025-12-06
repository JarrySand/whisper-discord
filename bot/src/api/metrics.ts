/**
 * メトリクス収集
 * - リクエスト統計
 * - レイテンシ計測
 * - エラー率
 */
import { logger } from '../utils/logger.js';
import type { QueueStatus, TranscriptionMetrics } from '../types/index.js';

/**
 * メトリクスコレクター
 */
export class MetricsCollector {
  private processingTimes: number[] = [];
  private queueWaitTimes: number[] = [];
  private requestCounts = {
    total: 0,
    successful: 0,
    failed: 0,
    retried: 0,
  };
  private wordCounts: number[] = [];
  private startTime = Date.now();
  private maxSamples: number;

  constructor(maxSamples = 1000) {
    this.maxSamples = maxSamples;
    logger.debug('MetricsCollector initialized', { maxSamples });
  }

  /**
   * リクエスト結果を記録
   */
  recordRequest(
    success: boolean,
    processingTimeMs: number,
    wordCount?: number
  ): void {
    this.requestCounts.total++;

    if (success) {
      this.requestCounts.successful++;
    } else {
      this.requestCounts.failed++;
    }

    this.addSample(this.processingTimes, processingTimeMs);

    if (wordCount !== undefined) {
      this.addSample(this.wordCounts, wordCount);
    }
  }

  /**
   * リトライを記録
   */
  recordRetry(): void {
    this.requestCounts.retried++;
  }

  /**
   * キュー待ち時間を記録
   */
  recordQueueWait(waitTimeMs: number): void {
    this.addSample(this.queueWaitTimes, waitTimeMs);
  }

  /**
   * サンプルを追加（最大件数を超えたら古いものを削除）
   */
  private addSample(arr: number[], value: number): void {
    arr.push(value);
    if (arr.length > this.maxSamples) {
      arr.shift();
    }
  }

  /**
   * メトリクスを取得
   */
  getMetrics(queueStatus?: QueueStatus): TranscriptionMetrics {
    const times = [...this.processingTimes].sort((a, b) => a - b);
    const waitTimes = [...this.queueWaitTimes].sort((a, b) => a - b);
    const elapsedMinutes = (Date.now() - this.startTime) / 60000;

    return {
      // カウンター
      totalRequests: this.requestCounts.total,
      successfulRequests: this.requestCounts.successful,
      failedRequests: this.requestCounts.failed,
      retriedRequests: this.requestCounts.retried,

      // レイテンシ
      avgProcessingTimeMs: this.average(times),
      minProcessingTimeMs: times[0] ?? 0,
      maxProcessingTimeMs: times[times.length - 1] ?? 0,
      p95ProcessingTimeMs: this.percentile(times, 0.95),

      // スループット
      segmentsPerMinute:
        elapsedMinutes > 0 ? this.requestCounts.successful / elapsedMinutes : 0,
      wordsPerMinute:
        elapsedMinutes > 0
          ? this.wordCounts.reduce((a, b) => a + b, 0) / elapsedMinutes
          : 0,

      // エラー率
      errorRate:
        this.requestCounts.total > 0
          ? this.requestCounts.failed / this.requestCounts.total
          : 0,

      // キュー状態
      currentQueueLength: queueStatus?.queued ?? 0,
      avgQueueWaitTimeMs: this.average(waitTimes),
    };
  }

  /**
   * 平均を計算
   */
  private average(arr: number[]): number {
    if (arr.length === 0) return 0;
    return arr.reduce((a, b) => a + b, 0) / arr.length;
  }

  /**
   * パーセンタイルを計算
   */
  private percentile(arr: number[], p: number): number {
    if (arr.length === 0) return 0;
    const index = Math.floor(arr.length * p);
    return arr[Math.min(index, arr.length - 1)];
  }

  /**
   * メトリクスをリセット
   */
  reset(): void {
    this.processingTimes = [];
    this.queueWaitTimes = [];
    this.wordCounts = [];
    this.requestCounts = {
      total: 0,
      successful: 0,
      failed: 0,
      retried: 0,
    };
    this.startTime = Date.now();
    logger.info('Metrics reset');
  }

  /**
   * サマリーをログ出力
   */
  logSummary(queueStatus?: QueueStatus): void {
    const metrics = this.getMetrics(queueStatus);
    logger.info('Transcription Metrics Summary', {
      totalRequests: metrics.totalRequests,
      successRate: `${((1 - metrics.errorRate) * 100).toFixed(1)}%`,
      avgProcessingTime: `${metrics.avgProcessingTimeMs.toFixed(0)}ms`,
      p95ProcessingTime: `${metrics.p95ProcessingTimeMs.toFixed(0)}ms`,
      segmentsPerMinute: metrics.segmentsPerMinute.toFixed(2),
      queueLength: metrics.currentQueueLength,
    });
  }
}

export default MetricsCollector;



