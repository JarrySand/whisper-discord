/**
 * 文字起こしサービス
 * - Whisper API、キュー、サーキットブレーカー、ヘルスモニターの統合
 * - オフラインハンドリング
 * - メトリクス収集
 * - 出力マネージャー統合
 */
import { EventEmitter } from 'events';
import { TextChannel } from 'discord.js';
import { logger } from '../utils/logger.js';
import { WhisperClient } from '../api/whisper-client.js';
import { TranscriptionQueue } from '../api/queue.js';
import { CircuitBreaker, CircuitState } from '../api/circuit-breaker.js';
import { HealthMonitor } from '../api/health-monitor.js';
import { OfflineHandler } from '../api/offline-handler.js';
import { MetricsCollector } from '../api/metrics.js';
import { OutputManager } from '../output/manager.js';
import { AizuchiFilter } from '../filters/aizuchi-filter.js';
import { HallucinationFilter } from '../filters/hallucination-filter.js';
import type {
  AudioSegment,
  TranscriptionServiceConfig,
  TranscriptionServiceStatus,
  SessionContext,
  TranscriptionResult,
  OutputManagerConfig,
} from '../types/index.js';
import { guildPrompts } from './guild-prompt.js';

/**
 * 拡張セッションコンテキスト（出力チャンネル情報を含む）
 */
export interface ExtendedSessionContext extends SessionContext {
  guildName: string;
  channelName: string;
  outputChannel?: TextChannel;
}

/**
 * 文字起こしサービス設定（出力設定を含む）
 */
export interface ExtendedTranscriptionServiceConfig extends TranscriptionServiceConfig {
  output?: Partial<OutputManagerConfig>;
}

/**
 * 文字起こしサービス
 */
export class TranscriptionService extends EventEmitter {
  private whisperClient: WhisperClient;
  private queue: TranscriptionQueue;
  private circuitBreaker: CircuitBreaker;
  private healthMonitor: HealthMonitor;
  private offlineHandler: OfflineHandler;
  private metricsCollector: MetricsCollector;
  private outputManager: OutputManager | null = null;
  private sessionContext: ExtendedSessionContext | null = null;
  private isRunning = false;

  // フィルター（Bot側で後処理）
  private aizuchiFilter: AizuchiFilter;
  private hallucinationFilter: HallucinationFilter;

  constructor(config: Partial<ExtendedTranscriptionServiceConfig> = {}, guildId?: string) {
    super();

    // プロンプト取得関数（guildIdがある場合のみ）
    const promptProvider = guildId
      ? () => guildPrompts.getPrompt(guildId)
      : null;

    // コンポーネント初期化（Guild別APIキー対応）
    this.whisperClient = new WhisperClient(config.whisper, guildId);
    this.circuitBreaker = new CircuitBreaker(config.circuitBreaker);
    this.healthMonitor = new HealthMonitor(this.whisperClient, config.healthMonitor);
    this.queue = new TranscriptionQueue(
      this.whisperClient,
      config.queue,
      this.circuitBreaker,
      promptProvider
    );
    this.offlineHandler = new OfflineHandler(config.offline);
    this.metricsCollector = new MetricsCollector();

    // フィルター初期化
    this.aizuchiFilter = new AizuchiFilter({ enabled: true, maxLength: 15 });
    this.hallucinationFilter = new HallucinationFilter({
      enabled: true,
      minRepetitionCount: 3,
      maxRepetitionLength: 20,
    });

    // 出力マネージャー初期化
    if (config.output) {
      this.outputManager = new OutputManager(config.output);
    }

    this.setupEventHandlers();

    logger.info('TranscriptionService initialized', {
      outputEnabled: !!this.outputManager,
      filtersEnabled: true,
    });
  }

  /**
   * イベントハンドラのセットアップ
   */
  private setupEventHandlers(): void {
    // キュー完了イベント
    this.queue.on('completed', (item, result) => {
      logger.debug('Queue completed event received', {
        segmentId: item.id,
        success: result.success,
        hasData: !!result.data,
        text: result.data?.text?.substring(0, 100),
      });

      if (result.success && result.data) {
        // 空結果をスキップ（品質向上: QUALITY_IMPROVEMENT.md Phase 1.3）
        let text = result.data.text?.trim() ?? '';
        if (!text) {
          logger.info('Skipping empty transcription result', {
            segmentId: item.id,
            userId: result.data.user_id,
            username: result.data.username,
          });
          // メトリクスには記録（空結果の追跡用）
          this.metricsCollector.recordRequest(true, result.data.processing_time_ms, 0);
          return;
        }

        // ハルシネーションフィルター適用
        const hallucinationResult = this.hallucinationFilter.filter(text);
        if (hallucinationResult.wasFiltered) {
          logger.info('Hallucination filtered', {
            segmentId: item.id,
            reason: hallucinationResult.reason,
            originalText: text.substring(0, 50),
          });
          text = hallucinationResult.text;
        }

        // 相槌フィルター適用
        if (this.aizuchiFilter.isAizuchi(text)) {
          logger.info('Aizuchi filtered', {
            segmentId: item.id,
            text: text,
          });
          // 相槌はスキップ
          this.metricsCollector.recordRequest(true, result.data.processing_time_ms, 0);
          return;
        }

        // フィルタリング後に空になった場合はスキップ
        if (!text) {
          logger.debug('Skipping empty result after filtering', {
            segmentId: item.id,
          });
          this.metricsCollector.recordRequest(true, result.data.processing_time_ms, 0);
          return;
        }

        const transcriptionResult: TranscriptionResult = {
          segmentId: item.id,
          userId: result.data.user_id,
          username: result.data.username,
          displayName: result.data.display_name ?? undefined,
          text: text,
          startTs: result.data.start_ts,
          endTs: result.data.end_ts,
          durationMs: result.data.duration_ms,
          language: result.data.language,
          confidence: result.data.confidence,
          processingTimeMs: result.data.processing_time_ms,
        };

        // メトリクス記録
        this.metricsCollector.recordRequest(
          true,
          result.data.processing_time_ms,
          text.split(/\s+/).length
        );

        // キュー待ち時間記録
        const waitTime = Date.now() - item.addedAt;
        this.metricsCollector.recordQueueWait(waitTime);

        // 出力マネージャーに送信
        if (this.outputManager) {
          logger.info('Sending to OutputManager', {
            segmentId: transcriptionResult.segmentId,
            text: transcriptionResult.text.substring(0, 50),
            displayName: transcriptionResult.displayName,
          });
          this.outputManager.output(transcriptionResult).catch((err) => {
            logger.error('Output failed', { error: err });
          });
        } else {
          logger.warn('OutputManager is null, skipping output');
        }

        this.emit('transcribed', transcriptionResult);
      }
    });

    // キュー失敗イベント
    this.queue.on('failed', (item, error) => {
      this.metricsCollector.recordRequest(false, 0);
      logger.error(`Transcription failed: ${item.id}`, { error: error.message });

      // オフラインに保存
      this.offlineHandler.saveForLater(item.segment).catch((err) => {
        logger.error('Failed to save segment for later', { error: err.message });
      });

      this.emit('failed', { segment: item.segment, error });
    });

    // キューリトライイベント
    this.queue.on('retry', () => {
      this.metricsCollector.recordRetry();
    });

    // ヘルスモニターイベント
    this.healthMonitor.on('unhealthy', () => {
      logger.warn('Whisper API is unhealthy');
      this.emit('apiUnhealthy');
    });

    this.healthMonitor.on('healthy', () => {
      logger.info('Whisper API is healthy');
      this.emit('apiHealthy');

      // オフラインキューを処理
      this.processOfflineQueue();
    });

    // サーキットブレーカーイベント
    this.circuitBreaker.on('open', () => {
      logger.warn('Circuit breaker opened');
      this.emit('circuitOpen');
    });

    this.circuitBreaker.on('close', () => {
      logger.info('Circuit breaker closed');
      this.emit('circuitClose');
    });
  }

  /**
   * サービス開始
   */
  async start(sessionContext: ExtendedSessionContext): Promise<void> {
    if (this.isRunning) {
      logger.warn('TranscriptionService is already running');
      return;
    }

    this.sessionContext = sessionContext;
    this.isRunning = true;

    // ヘルスモニタリング開始
    this.healthMonitor.start();

    // キュー処理開始
    this.queue.start();

    // 出力マネージャーのセッション開始
    if (this.outputManager) {
      await this.outputManager.startSession({
        guildId: sessionContext.guildId,
        guildName: sessionContext.guildName,
        channelId: sessionContext.channelId,
        channelName: sessionContext.channelName,
        outputChannel: sessionContext.outputChannel,
      });
    }

    logger.info('TranscriptionService started', {
      guildId: sessionContext.guildId,
      channelId: sessionContext.channelId,
    });

    this.emit('started', sessionContext);
  }

  /**
   * サービス停止
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    // キュー停止
    this.queue.stop();

    // ヘルスモニタリング停止
    this.healthMonitor.stop();

    // 出力マネージャーのセッション終了
    if (this.outputManager) {
      await this.outputManager.endSession();
    }

    // メトリクスサマリー出力
    this.metricsCollector.logSummary(this.queue.getStatus());

    this.isRunning = false;
    logger.info('TranscriptionService stopped');

    this.emit('stopped', this.sessionContext);
    this.sessionContext = null;
  }

  /**
   * キューが空になるまで待機（処理中のアイテムも含む）
   * @param timeoutMs 最大待機時間（デフォルト: 30秒）
   */
  async waitForQueueDrain(timeoutMs: number = 30000): Promise<void> {
    const startTime = Date.now();
    const checkInterval = 500; // 500msごとにチェック

    while (Date.now() - startTime < timeoutMs) {
      const status = this.queue.getStatus();
      if (status.queued === 0 && status.processing === 0) {
        logger.debug('Queue drained successfully');
        return;
      }

      logger.debug(`Waiting for queue drain: ${status.queued} queued, ${status.processing} processing`);
      await new Promise(resolve => setTimeout(resolve, checkInterval));
    }

    const finalStatus = this.queue.getStatus();
    logger.warn(`Queue drain timeout after ${timeoutMs}ms`, {
      queued: finalStatus.queued,
      processing: finalStatus.processing,
    });
  }

  /**
   * セグメントを文字起こしキューに追加
   */
  async transcribe(segment: AudioSegment): Promise<void> {
    if (!this.isRunning) {
      logger.warn('TranscriptionService is not running');
      return;
    }

    // サーキットブレーカーがOPENの場合はオフラインに保存
    if (this.circuitBreaker.getState() === CircuitState.OPEN) {
      logger.debug(`Circuit is open, saving segment for later: ${segment.id}`);
      await this.offlineHandler.saveForLater(segment);
      this.emit('queuedOffline', segment);
      return;
    }

    this.queue.enqueue(segment);
  }

  /**
   * オフラインキューを処理
   */
  private async processOfflineQueue(): Promise<void> {
    const pendingCount = this.offlineHandler.getPendingCount();
    if (pendingCount === 0) {
      return;
    }

    logger.info(`Processing ${pendingCount} offline segments`);

    const result = await this.offlineHandler.processQueue(async (segment) => {
      try {
        this.queue.enqueue(segment);
        return true;
      } catch {
        return false;
      }
    });

    logger.info(`Offline queue processing complete`, result);
  }

  /**
   * ステータス取得
   */
  getStatus(): TranscriptionServiceStatus & { outputPaths?: { log: string | null; json: string | null; markdown: string | null; sqliteDir: string | null } } {
    return {
      isRunning: this.isRunning,
      sessionContext: this.sessionContext,
      queue: this.queue.getStatus(),
      circuitBreaker: this.circuitBreaker.getStatus(),
      health: this.healthMonitor.getStatus(),
      offlinePending: this.offlineHandler.getPendingCount(),
      metrics: this.metricsCollector.getMetrics(this.queue.getStatus()),
      outputPaths: this.outputManager?.getOutputPaths(),
    };
  }

  /**
   * 出力マネージャー取得
   */
  getOutputManager(): OutputManager | null {
    return this.outputManager;
  }

  /**
   * 出力マネージャー設定
   */
  setOutputManager(outputManager: OutputManager): void {
    this.outputManager = outputManager;
  }

  /**
   * メトリクス取得
   */
  getMetrics() {
    return this.metricsCollector.getMetrics(this.queue.getStatus());
  }

  /**
   * キューステータス取得
   */
  getQueueStatus() {
    return this.queue.getStatus();
  }

  /**
   * ヘルスステータス取得
   */
  getHealthStatus() {
    return this.healthMonitor.getStatus();
  }
}

export default TranscriptionService;

