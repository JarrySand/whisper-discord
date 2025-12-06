# 📘 Bot⇔API 連携 詳細仕様書

> **関連**: [spec.md](../spec.md) - 全体概要 | [01-discord-bot.md](./01-discord-bot.md) - Bot仕様 | [03-whisper-api.md](./03-whisper-api.md) - API仕様

---

## 1. 概要

Discord Bot と Whisper API サーバー間の通信・連携の詳細仕様。

### 通信フロー

```
┌─────────────┐    HTTP POST     ┌─────────────────┐
│ Discord Bot │ ───────────────→ │ Whisper API     │
│ (TypeScript)│ multipart/form  │ (Python/FastAPI)│
│             │ ←─────────────── │                 │
│             │   JSON response  │                 │
└─────────────┘                  └─────────────────┘
```

---

## 2. Whisper クライアント実装

### 2.1 基本クライアント

```typescript
// api/whisper-client.ts
import axios, { AxiosInstance, AxiosError } from 'axios';
import FormData from 'form-data';
import { Readable } from 'stream';

interface WhisperClientConfig {
  baseUrl: string;
  timeout: number;
  retryCount: number;
  retryDelay: number;
  retryBackoffMultiplier: number;
}

interface TranscribeRequest {
  audioData: Buffer;
  audioFormat: string;
  userId: string;
  username: string;
  displayName?: string;
  startTs: number;
  endTs: number;
  language?: string;
}

interface TranscribeResponse {
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
    details?: any;
  };
}

class WhisperClient {
  private client: AxiosInstance;
  private config: WhisperClientConfig;
  private isHealthy = true;
  private lastHealthCheck = 0;

  constructor(config: Partial<WhisperClientConfig> = {}) {
    this.config = {
      baseUrl: process.env.WHISPER_API_URL || 'http://localhost:8000',
      timeout: 60000,
      retryCount: 3,
      retryDelay: 1000,
      retryBackoffMultiplier: 2,
      ...config,
    };

    this.client = axios.create({
      baseURL: this.config.baseUrl,
      timeout: this.config.timeout,
    });
  }

  async transcribe(request: TranscribeRequest): Promise<TranscribeResponse> {
    const formData = new FormData();
    
    // 音声ファイル
    formData.append('audio_file', request.audioData, {
      filename: `segment.${request.audioFormat}`,
      contentType: `audio/${request.audioFormat}`,
    });
    
    // メタデータ
    formData.append('user_id', request.userId);
    formData.append('username', request.username);
    if (request.displayName) {
      formData.append('display_name', request.displayName);
    }
    formData.append('start_ts', request.startTs.toString());
    formData.append('end_ts', request.endTs.toString());
    formData.append('language', request.language || 'ja');

    return this.executeWithRetry(async () => {
      const response = await this.client.post<TranscribeResponse>(
        '/transcribe',
        formData,
        {
          headers: formData.getHeaders(),
        }
      );
      return response.data;
    });
  }

  async transcribeBatch(requests: TranscribeRequest[]): Promise<TranscribeResponse[]> {
    const formData = new FormData();
    const metadata: any[] = [];

    // 複数の音声ファイルを追加
    requests.forEach((request, index) => {
      formData.append('files', request.audioData, {
        filename: `segment_${index}.${request.audioFormat}`,
        contentType: `audio/${request.audioFormat}`,
      });

      metadata.push({
        user_id: request.userId,
        username: request.username,
        display_name: request.displayName,
        start_ts: request.startTs,
        end_ts: request.endTs,
        language: request.language || 'ja',
      });
    });

    formData.append('metadata', JSON.stringify(metadata));

    return this.executeWithRetry(async () => {
      const response = await this.client.post<{ success: boolean; data: { results: TranscribeResponse[] } }>(
        '/transcribe/batch',
        formData,
        {
          headers: formData.getHeaders(),
          timeout: this.config.timeout * requests.length, // バッチサイズに応じてタイムアウト延長
        }
      );
      return response.data.data.results;
    });
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await this.client.get('/health', {
        timeout: 5000,
      });
      this.isHealthy = response.data.status === 'healthy';
      this.lastHealthCheck = Date.now();
      return this.isHealthy;
    } catch {
      this.isHealthy = false;
      return false;
    }
  }

  private async executeWithRetry<T>(
    operation: () => Promise<T>,
  ): Promise<T> {
    let lastError: Error | null = null;
    let delay = this.config.retryDelay;

    for (let attempt = 0; attempt <= this.config.retryCount; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error as Error;
        
        // リトライ不可のエラー
        if (this.isNonRetryableError(error)) {
          throw error;
        }

        // 最後の試行
        if (attempt === this.config.retryCount) {
          break;
        }

        // 待機してリトライ
        console.warn(`Retry attempt ${attempt + 1}/${this.config.retryCount} after ${delay}ms`);
        await this.sleep(delay);
        delay *= this.config.retryBackoffMultiplier;
      }
    }

    throw lastError;
  }

  private isNonRetryableError(error: any): boolean {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      // 4xx エラーはリトライしない（400, 401, 403, 404等）
      return status !== undefined && status >= 400 && status < 500;
    }
    return false;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
```

---

## 3. キュー管理

### 3.1 処理キュー

```typescript
// api/queue.ts
import { EventEmitter } from 'events';

interface QueueItem {
  id: string;
  segment: AudioSegment;
  addedAt: number;
  retryCount: number;
  priority: number;
}

interface QueueConfig {
  maxSize: number;
  maxRetries: number;
  concurrency: number;
  processingTimeout: number;
}

class TranscriptionQueue extends EventEmitter {
  private queue: QueueItem[] = [];
  private processing = new Map<string, QueueItem>();
  private config: QueueConfig;
  private whisperClient: WhisperClient;
  private isRunning = false;

  constructor(
    whisperClient: WhisperClient,
    config: Partial<QueueConfig> = {},
  ) {
    super();
    this.whisperClient = whisperClient;
    this.config = {
      maxSize: 100,
      maxRetries: 3,
      concurrency: 2,
      processingTimeout: 120000,
      ...config,
    };
  }

  enqueue(segment: AudioSegment): string {
    if (this.queue.length >= this.config.maxSize) {
      // 古いアイテムを削除
      const removed = this.queue.shift();
      this.emit('dropped', removed);
    }

    const item: QueueItem = {
      id: segment.id,
      segment,
      addedAt: Date.now(),
      retryCount: 0,
      priority: this.calculatePriority(segment),
    };

    // 優先度順に挿入
    const insertIndex = this.queue.findIndex(q => q.priority < item.priority);
    if (insertIndex === -1) {
      this.queue.push(item);
    } else {
      this.queue.splice(insertIndex, 0, item);
    }

    this.emit('enqueued', item);
    this.processNext();

    return item.id;
  }

  private calculatePriority(segment: AudioSegment): number {
    // 新しいセグメントほど優先度高
    return segment.startTimestamp;
  }

  private async processNext(): Promise<void> {
    if (!this.isRunning) return;
    if (this.processing.size >= this.config.concurrency) return;
    if (this.queue.length === 0) return;

    const item = this.queue.shift()!;
    this.processing.set(item.id, item);

    try {
      const result = await this.processItem(item);
      this.emit('completed', item, result);
    } catch (error) {
      await this.handleError(item, error as Error);
    } finally {
      this.processing.delete(item.id);
      this.processNext();
    }
  }

  private async processItem(item: QueueItem): Promise<TranscribeResponse> {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(
        () => reject(new Error('Processing timeout')),
        this.config.processingTimeout,
      );
    });

    const transcribePromise = this.whisperClient.transcribe({
      audioData: item.segment.audioData,
      audioFormat: item.segment.audioFormat,
      userId: item.segment.userId,
      username: item.segment.username,
      displayName: item.segment.displayName,
      startTs: item.segment.startTimestamp,
      endTs: item.segment.endTimestamp,
    });

    return Promise.race([transcribePromise, timeoutPromise]);
  }

  private async handleError(item: QueueItem, error: Error): Promise<void> {
    item.retryCount++;

    if (item.retryCount <= this.config.maxRetries) {
      // リキュー
      this.queue.unshift(item);
      this.emit('retry', item, error);
    } else {
      // 失敗として処理
      this.emit('failed', item, error);
    }
  }

  start(): void {
    this.isRunning = true;
    // キュー内のアイテムを処理開始
    for (let i = 0; i < this.config.concurrency; i++) {
      this.processNext();
    }
  }

  stop(): void {
    this.isRunning = false;
  }

  getStatus(): QueueStatus {
    return {
      queued: this.queue.length,
      processing: this.processing.size,
      isRunning: this.isRunning,
    };
  }
}
```

---

## 4. サーキットブレーカー

### 4.1 実装

```typescript
// api/circuit-breaker.ts
enum CircuitState {
  CLOSED = 'CLOSED',     // 正常稼働
  OPEN = 'OPEN',         // 遮断中
  HALF_OPEN = 'HALF_OPEN', // 試験中
}

interface CircuitBreakerConfig {
  failureThreshold: number;     // 開放する失敗回数
  successThreshold: number;     // 閉じる成功回数
  timeout: number;              // 開放時間 (ms)
  monitoringPeriod: number;     // 監視期間 (ms)
}

class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private failures = 0;
  private successes = 0;
  private lastFailureTime = 0;
  private config: CircuitBreakerConfig;

  constructor(config: Partial<CircuitBreakerConfig> = {}) {
    this.config = {
      failureThreshold: 5,
      successThreshold: 3,
      timeout: 30000,
      monitoringPeriod: 60000,
      ...config,
    };
  }

  async execute<T>(operation: () => Promise<T>): Promise<T> {
    if (this.state === CircuitState.OPEN) {
      if (this.shouldAttemptReset()) {
        this.state = CircuitState.HALF_OPEN;
      } else {
        throw new CircuitBreakerOpenError('Circuit breaker is open');
      }
    }

    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess(): void {
    this.failures = 0;
    
    if (this.state === CircuitState.HALF_OPEN) {
      this.successes++;
      if (this.successes >= this.config.successThreshold) {
        this.state = CircuitState.CLOSED;
        this.successes = 0;
        console.log('Circuit breaker closed');
      }
    }
  }

  private onFailure(): void {
    this.failures++;
    this.lastFailureTime = Date.now();
    this.successes = 0;

    if (
      this.state === CircuitState.CLOSED &&
      this.failures >= this.config.failureThreshold
    ) {
      this.state = CircuitState.OPEN;
      console.warn('Circuit breaker opened');
    } else if (this.state === CircuitState.HALF_OPEN) {
      this.state = CircuitState.OPEN;
      console.warn('Circuit breaker re-opened');
    }
  }

  private shouldAttemptReset(): boolean {
    return Date.now() - this.lastFailureTime >= this.config.timeout;
  }

  getState(): CircuitState {
    return this.state;
  }
}

class CircuitBreakerOpenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CircuitBreakerOpenError';
  }
}
```

---

## 5. ヘルスチェック

### 5.1 定期ヘルスチェック

```typescript
// api/health-monitor.ts
import { EventEmitter } from 'events';

interface HealthMonitorConfig {
  checkInterval: number;      // チェック間隔 (ms)
  healthyThreshold: number;   // 正常判定の連続成功回数
  unhealthyThreshold: number; // 異常判定の連続失敗回数
}

class HealthMonitor extends EventEmitter {
  private config: HealthMonitorConfig;
  private whisperClient: WhisperClient;
  private timer: NodeJS.Timeout | null = null;
  private consecutiveSuccesses = 0;
  private consecutiveFailures = 0;
  private isHealthy = false;

  constructor(
    whisperClient: WhisperClient,
    config: Partial<HealthMonitorConfig> = {},
  ) {
    super();
    this.whisperClient = whisperClient;
    this.config = {
      checkInterval: 30000,
      healthyThreshold: 2,
      unhealthyThreshold: 3,
      ...config,
    };
  }

  start(): void {
    this.check();
    this.timer = setInterval(
      () => this.check(),
      this.config.checkInterval,
    );
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async check(): Promise<void> {
    try {
      const healthy = await this.whisperClient.healthCheck();
      
      if (healthy) {
        this.consecutiveSuccesses++;
        this.consecutiveFailures = 0;
        
        if (!this.isHealthy && 
            this.consecutiveSuccesses >= this.config.healthyThreshold) {
          this.isHealthy = true;
          this.emit('healthy');
        }
      } else {
        throw new Error('Health check returned unhealthy');
      }
    } catch (error) {
      this.consecutiveFailures++;
      this.consecutiveSuccesses = 0;
      
      if (this.isHealthy && 
          this.consecutiveFailures >= this.config.unhealthyThreshold) {
        this.isHealthy = false;
        this.emit('unhealthy', error);
      }
    }
  }

  getStatus(): { isHealthy: boolean; lastCheck: number } {
    return {
      isHealthy: this.isHealthy,
      lastCheck: Date.now(),
    };
  }
}
```

---

## 6. メッセージング統合

### 6.1 TranscriptionService

```typescript
// services/transcription-service.ts
import { EventEmitter } from 'events';

class TranscriptionService extends EventEmitter {
  private whisperClient: WhisperClient;
  private queue: TranscriptionQueue;
  private circuitBreaker: CircuitBreaker;
  private healthMonitor: HealthMonitor;
  private outputManager: OutputManager;

  constructor(config: TranscriptionServiceConfig) {
    super();
    
    this.whisperClient = new WhisperClient(config.whisper);
    this.circuitBreaker = new CircuitBreaker(config.circuitBreaker);
    this.healthMonitor = new HealthMonitor(this.whisperClient, config.healthMonitor);
    this.queue = new TranscriptionQueue(this.whisperClient, config.queue);
    this.outputManager = new OutputManager(config.output);

    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    // キュー完了イベント
    this.queue.on('completed', async (item, result) => {
      if (result.success && result.data) {
        await this.outputManager.output(result.data);
        this.emit('transcribed', result.data);
      }
    });

    // キュー失敗イベント
    this.queue.on('failed', (item, error) => {
      console.error(`Transcription failed for segment ${item.id}:`, error);
      this.emit('error', { segment: item.segment, error });
    });

    // ヘルスモニターイベント
    this.healthMonitor.on('unhealthy', () => {
      console.warn('Whisper API is unhealthy');
      this.emit('apiUnhealthy');
    });

    this.healthMonitor.on('healthy', () => {
      console.log('Whisper API is healthy');
      this.emit('apiHealthy');
    });
  }

  async start(sessionContext: SessionContext): Promise<void> {
    await this.outputManager.startSession(sessionContext);
    this.healthMonitor.start();
    this.queue.start();
  }

  async stop(): Promise<void> {
    this.queue.stop();
    this.healthMonitor.stop();
    await this.outputManager.endSession();
  }

  async transcribe(segment: AudioSegment): Promise<void> {
    // サーキットブレーカーチェック
    if (this.circuitBreaker.getState() === 'OPEN') {
      // オフライン処理（ローカル保存のみ）
      this.emit('queued_offline', segment);
      return;
    }

    this.queue.enqueue(segment);
  }

  getStatus(): ServiceStatus {
    return {
      queue: this.queue.getStatus(),
      circuitBreaker: this.circuitBreaker.getState(),
      health: this.healthMonitor.getStatus(),
    };
  }
}
```

---

## 7. エラーリカバリー

### 7.1 オフラインモード

```typescript
// api/offline-handler.ts
import * as fs from 'fs/promises';
import * as path from 'path';

class OfflineHandler {
  private offlineDir: string;
  private pendingSegments: AudioSegment[] = [];

  constructor(offlineDir = './offline_queue') {
    this.offlineDir = offlineDir;
  }

  async saveForLater(segment: AudioSegment): Promise<void> {
    await fs.mkdir(this.offlineDir, { recursive: true });
    
    const filename = `${segment.id}.json`;
    const filepath = path.join(this.offlineDir, filename);
    
    // 音声データはBase64エンコード
    const data = {
      ...segment,
      audioData: segment.audioData.toString('base64'),
    };
    
    await fs.writeFile(filepath, JSON.stringify(data), 'utf-8');
    this.pendingSegments.push(segment);
  }

  async loadPending(): Promise<AudioSegment[]> {
    try {
      const files = await fs.readdir(this.offlineDir);
      const segments: AudioSegment[] = [];
      
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        
        const filepath = path.join(this.offlineDir, file);
        const content = await fs.readFile(filepath, 'utf-8');
        const data = JSON.parse(content);
        
        segments.push({
          ...data,
          audioData: Buffer.from(data.audioData, 'base64'),
        });
      }
      
      return segments.sort((a, b) => a.startTimestamp - b.startTimestamp);
    } catch {
      return [];
    }
  }

  async markProcessed(segmentId: string): Promise<void> {
    const filepath = path.join(this.offlineDir, `${segmentId}.json`);
    await fs.unlink(filepath).catch(() => {});
  }

  async processOfflineQueue(
    transcriptionService: TranscriptionService,
  ): Promise<void> {
    const segments = await this.loadPending();
    
    for (const segment of segments) {
      try {
        await transcriptionService.transcribe(segment);
        await this.markProcessed(segment.id);
      } catch (error) {
        console.error(`Failed to process offline segment ${segment.id}:`, error);
      }
    }
  }
}
```

---

## 8. メトリクス収集

### 8.1 統計情報

```typescript
// api/metrics.ts
interface TranscriptionMetrics {
  // カウンター
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  retriedRequests: number;
  
  // レイテンシ
  avgProcessingTimeMs: number;
  minProcessingTimeMs: number;
  maxProcessingTimeMs: number;
  p95ProcessingTimeMs: number;
  
  // スループット
  segmentsPerMinute: number;
  wordsPerMinute: number;
  
  // エラー率
  errorRate: number;
  
  // キュー状態
  currentQueueLength: number;
  avgQueueWaitTimeMs: number;
}

class MetricsCollector {
  private processingTimes: number[] = [];
  private requestCounts = {
    total: 0,
    successful: 0,
    failed: 0,
    retried: 0,
  };
  private startTime = Date.now();

  recordRequest(success: boolean, processingTimeMs: number): void {
    this.requestCounts.total++;
    
    if (success) {
      this.requestCounts.successful++;
    } else {
      this.requestCounts.failed++;
    }
    
    this.processingTimes.push(processingTimeMs);
    
    // 直近1000件のみ保持
    if (this.processingTimes.length > 1000) {
      this.processingTimes.shift();
    }
  }

  recordRetry(): void {
    this.requestCounts.retried++;
  }

  getMetrics(queueStatus: QueueStatus): TranscriptionMetrics {
    const times = [...this.processingTimes].sort((a, b) => a - b);
    const elapsedMinutes = (Date.now() - this.startTime) / 60000;
    
    return {
      totalRequests: this.requestCounts.total,
      successfulRequests: this.requestCounts.successful,
      failedRequests: this.requestCounts.failed,
      retriedRequests: this.requestCounts.retried,
      
      avgProcessingTimeMs: this.average(times),
      minProcessingTimeMs: times[0] || 0,
      maxProcessingTimeMs: times[times.length - 1] || 0,
      p95ProcessingTimeMs: this.percentile(times, 0.95),
      
      segmentsPerMinute: elapsedMinutes > 0 
        ? this.requestCounts.successful / elapsedMinutes 
        : 0,
      wordsPerMinute: 0, // TODO: 計算
      
      errorRate: this.requestCounts.total > 0
        ? this.requestCounts.failed / this.requestCounts.total
        : 0,
      
      currentQueueLength: queueStatus.queued,
      avgQueueWaitTimeMs: 0, // TODO: 計算
    };
  }

  private average(arr: number[]): number {
    if (arr.length === 0) return 0;
    return arr.reduce((a, b) => a + b, 0) / arr.length;
  }

  private percentile(arr: number[], p: number): number {
    if (arr.length === 0) return 0;
    const index = Math.floor(arr.length * p);
    return arr[Math.min(index, arr.length - 1)];
  }
}
```

---

## 9. 設定パラメータ

```typescript
// config/integration.ts
export const integrationConfig = {
  whisper: {
    baseUrl: process.env.WHISPER_API_URL || 'http://localhost:8000',
    timeout: parseInt(process.env.WHISPER_TIMEOUT || '60000'),
    retryCount: parseInt(process.env.WHISPER_RETRY_COUNT || '3'),
    retryDelay: parseInt(process.env.WHISPER_RETRY_DELAY || '1000'),
    retryBackoffMultiplier: 2,
  },
  
  queue: {
    maxSize: parseInt(process.env.QUEUE_MAX_SIZE || '100'),
    maxRetries: parseInt(process.env.QUEUE_MAX_RETRIES || '3'),
    concurrency: parseInt(process.env.QUEUE_CONCURRENCY || '2'),
    processingTimeout: parseInt(process.env.QUEUE_PROCESSING_TIMEOUT || '120000'),
  },
  
  circuitBreaker: {
    failureThreshold: 5,
    successThreshold: 3,
    timeout: 30000,
    monitoringPeriod: 60000,
  },
  
  healthMonitor: {
    checkInterval: 30000,
    healthyThreshold: 2,
    unhealthyThreshold: 3,
  },
  
  offline: {
    enabled: true,
    directory: './offline_queue',
    processOnReconnect: true,
  },
};
```

---

## 10. シーケンス図

```
┌──────────┐     ┌───────────┐     ┌────────────┐     ┌────────────┐
│  Voice   │     │   Audio   │     │Transcription│    │  Whisper  │
│ Receiver │     │ Segmenter │     │  Service   │     │   API     │
└────┬─────┘     └─────┬─────┘     └──────┬─────┘     └─────┬─────┘
     │                 │                   │                 │
     │ audio chunk     │                   │                 │
     │────────────────>│                   │                 │
     │                 │                   │                 │
     │                 │ segment created   │                 │
     │                 │──────────────────>│                 │
     │                 │                   │                 │
     │                 │                   │ enqueue         │
     │                 │                   │────────┐        │
     │                 │                   │        │        │
     │                 │                   │<───────┘        │
     │                 │                   │                 │
     │                 │                   │ POST /transcribe│
     │                 │                   │────────────────>│
     │                 │                   │                 │
     │                 │                   │                 │ whisper
     │                 │                   │                 │ inference
     │                 │                   │                 │────┐
     │                 │                   │                 │    │
     │                 │                   │                 │<───┘
     │                 │                   │                 │
     │                 │                   │    JSON response│
     │                 │                   │<────────────────│
     │                 │                   │                 │
     │                 │                   │ emit 'completed'│
     │                 │                   │────────┐        │
     │                 │                   │        │        │
     │                 │                   │<───────┘        │
     │                 │                   │                 │
```

---

## 11. 次のドキュメント

- [06-config-env.md](./06-config-env.md) - 環境変数・ディレクトリ構造

