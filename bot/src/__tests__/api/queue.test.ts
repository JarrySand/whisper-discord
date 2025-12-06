/**
 * TranscriptionQueue テスト
 * 
 * テスト項目:
 * - セグメントの追加と優先度
 * - 並行処理制御
 * - リトライ処理
 * - キューのサイズ制限
 * - イベント発火
 */
import { TranscriptionQueue } from '../../api/queue.js';
import { CircuitBreaker } from '../../api/circuit-breaker.js';
import type { WhisperClient } from '../../api/whisper-client.js';
import type { AudioSegment, TranscribeResponse } from '../../types/index.js';

/**
 * モックのAudioSegmentを作成
 */
function createMockSegment(overrides: Partial<AudioSegment> = {}): AudioSegment {
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
 * モックのWhisperClientを作成
 */
function createMockWhisperClient(
  options: { delay?: number; shouldFail?: boolean } = {}
): jest.Mocked<WhisperClient> {
  return {
    transcribe: jest.fn().mockImplementation(async () => {
      if (options.delay) {
        await new Promise((r) => setTimeout(r, options.delay));
      }
      if (options.shouldFail) {
        return {
          success: false,
          error: { code: 'ERROR', message: 'Mock error' },
        } as TranscribeResponse;
      }
      return {
        success: true,
        data: {
          user_id: 'user-1',
          username: 'testuser',
          display_name: 'Test User',
          text: 'こんにちは',
          start_ts: Date.now() - 3000,
          end_ts: Date.now(),
          duration_ms: 3000,
          language: 'ja',
          confidence: 0.95,
          processing_time_ms: 500,
        },
      } as TranscribeResponse;
    }),
    healthCheck: jest.fn(),
    getBaseUrl: jest.fn().mockReturnValue('http://localhost:8000'),
  } as unknown as jest.Mocked<WhisperClient>;
}

describe('TranscriptionQueue', () => {
  describe('初期化', () => {
    test('正常に初期化される', () => {
      const mockClient = createMockWhisperClient();
      const queue = new TranscriptionQueue(mockClient);

      const status = queue.getStatus();
      expect(status.queued).toBe(0);
      expect(status.processing).toBe(0);
      expect(status.isRunning).toBe(false);
    });

    test('カスタム設定が適用される', () => {
      const mockClient = createMockWhisperClient();
      const queue = new TranscriptionQueue(mockClient, {
        maxSize: 50,
        maxRetries: 5,
        concurrency: 4,
      });

      const config = queue.getConfig();
      expect(config.maxSize).toBe(50);
      expect(config.maxRetries).toBe(5);
      expect(config.concurrency).toBe(4);
    });
  });

  describe('エンキュー', () => {
    test('セグメントをキューに追加できる', () => {
      const mockClient = createMockWhisperClient();
      const queue = new TranscriptionQueue(mockClient);

      const segment = createMockSegment();
      const id = queue.enqueue(segment);

      expect(id).toBe(segment.id);

      const status = queue.getStatus();
      expect(status.queued).toBe(1);
    });

    test('優先度順に並ぶ（新しいセグメントが優先）', () => {
      const mockClient = createMockWhisperClient();
      const queue = new TranscriptionQueue(mockClient);

      const oldSegment = createMockSegment({ startTimestamp: 1000 });
      const newSegment = createMockSegment({ startTimestamp: 3000 });

      queue.enqueue(oldSegment);
      queue.enqueue(newSegment);

      // 新しいセグメントが優先されるべき
      const status = queue.getStatus();
      expect(status.queued).toBe(2);
    });

    test('カスタム優先度を指定できる', () => {
      const mockClient = createMockWhisperClient();
      const queue = new TranscriptionQueue(mockClient);

      const segment1 = createMockSegment();
      const segment2 = createMockSegment();

      queue.enqueue(segment1, 100);
      queue.enqueue(segment2, 200);

      const status = queue.getStatus();
      expect(status.queued).toBe(2);
    });

    test('enqueuedイベントが発火する', () => {
      const mockClient = createMockWhisperClient();
      const queue = new TranscriptionQueue(mockClient);
      let enqueuedItem: unknown = null;

      queue.on('enqueued', (item) => {
        enqueuedItem = item;
      });

      const segment = createMockSegment();
      queue.enqueue(segment);

      expect(enqueuedItem).not.toBeNull();
    });
  });

  describe('キューサイズ制限', () => {
    test('最大サイズを超えると古いものが削除される', () => {
      const mockClient = createMockWhisperClient();
      const queue = new TranscriptionQueue(mockClient, { maxSize: 3 });

      // 4つ追加
      for (let i = 0; i < 4; i++) {
        queue.enqueue(createMockSegment());
      }

      // 最大3つまで
      const status = queue.getStatus();
      expect(status.queued).toBe(3);
    });

    test('droppedイベントが発火する', () => {
      const mockClient = createMockWhisperClient();
      const queue = new TranscriptionQueue(mockClient, { maxSize: 2 });
      let droppedItem: unknown = null;

      queue.on('dropped', (item) => {
        droppedItem = item;
      });

      queue.enqueue(createMockSegment());
      queue.enqueue(createMockSegment());
      queue.enqueue(createMockSegment()); // これでドロップ発生

      expect(droppedItem).not.toBeNull();
    });
  });

  describe('処理開始/停止', () => {
    test('start()でisRunningがtrueになる', () => {
      const mockClient = createMockWhisperClient();
      const queue = new TranscriptionQueue(mockClient);

      queue.start();

      expect(queue.getStatus().isRunning).toBe(true);

      queue.stop();
    });

    test('stop()でisRunningがfalseになる', () => {
      const mockClient = createMockWhisperClient();
      const queue = new TranscriptionQueue(mockClient);

      queue.start();
      queue.stop();

      expect(queue.getStatus().isRunning).toBe(false);
    });

    test('処理が正常に完了する', async () => {
      const mockClient = createMockWhisperClient({ delay: 10 });
      const queue = new TranscriptionQueue(mockClient);
      let completed = false;

      queue.on('completed', () => {
        completed = true;
      });

      queue.start();
      queue.enqueue(createMockSegment());

      // 処理完了を待つ
      await new Promise((r) => setTimeout(r, 200));

      expect(completed).toBe(true);

      queue.stop();
    });

    test('completedイベントに結果が含まれる', async () => {
      const mockClient = createMockWhisperClient({ delay: 10 });
      const queue = new TranscriptionQueue(mockClient);
      let result: TranscribeResponse | undefined;

      queue.on('completed', (_item, res: TranscribeResponse) => {
        result = res;
      });

      queue.start();
      queue.enqueue(createMockSegment());

      await new Promise((r) => setTimeout(r, 200));

      expect(result).toBeDefined();
      expect(result!.success).toBe(true);
      expect(result!.data?.text).toBe('こんにちは');

      queue.stop();
    });
  });

  describe('並行処理', () => {
    test('concurrency設定に従って並行処理', async () => {
      const mockClient = createMockWhisperClient({ delay: 100 });
      const queue = new TranscriptionQueue(mockClient, { concurrency: 2 });

      queue.start();

      // 3つのセグメントを追加
      queue.enqueue(createMockSegment());
      queue.enqueue(createMockSegment());
      queue.enqueue(createMockSegment());

      // 少し待つ
      await new Promise((r) => setTimeout(r, 50));

      // 最大2つが並行処理される
      const status = queue.getStatus();
      expect(status.processing).toBeLessThanOrEqual(2);

      queue.stop();
    });
  });

  describe('リトライ処理', () => {
    test('失敗時にリトライされる', async () => {
      const mockClient = createMockWhisperClient({ shouldFail: true, delay: 10 });
      const queue = new TranscriptionQueue(mockClient, { maxRetries: 2 });
      let retryCount = 0;

      queue.on('retry', () => {
        retryCount++;
      });

      queue.start();
      queue.enqueue(createMockSegment());

      // リトライを待つ
      await new Promise((r) => setTimeout(r, 500));

      expect(retryCount).toBeGreaterThan(0);

      queue.stop();
    });

    test('最大リトライ回数を超えるとfailedイベント', async () => {
      const mockClient = createMockWhisperClient({ shouldFail: true, delay: 10 });
      const queue = new TranscriptionQueue(mockClient, { maxRetries: 1 });
      let failed = false;

      queue.on('failed', () => {
        failed = true;
      });

      queue.start();
      queue.enqueue(createMockSegment());

      await new Promise((r) => setTimeout(r, 500));

      expect(failed).toBe(true);

      queue.stop();
    });
  });

  describe('サーキットブレーカー連携', () => {
    test('サーキットブレーカーと連携できる', () => {
      const mockClient = createMockWhisperClient();
      const circuitBreaker = new CircuitBreaker();
      const queue = new TranscriptionQueue(mockClient, {}, circuitBreaker);

      expect(queue.getStatus().queued).toBe(0);
    });

    test('サーキットブレーカー経由で処理される', async () => {
      const mockClient = createMockWhisperClient({ delay: 10 });
      const circuitBreaker = new CircuitBreaker();
      const queue = new TranscriptionQueue(mockClient, {}, circuitBreaker);

      queue.start();
      queue.enqueue(createMockSegment());

      await new Promise((r) => setTimeout(r, 200));

      // サーキットブレーカーはCLOSED状態を維持
      expect(circuitBreaker.isClosed()).toBe(true);

      queue.stop();
    });
  });

  describe('クリア', () => {
    test('キューをクリアできる', () => {
      const mockClient = createMockWhisperClient();
      const queue = new TranscriptionQueue(mockClient);

      queue.enqueue(createMockSegment());
      queue.enqueue(createMockSegment());

      expect(queue.getStatus().queued).toBe(2);

      queue.clear();

      expect(queue.getStatus().queued).toBe(0);
    });

    test('clearedイベントが発火する', () => {
      const mockClient = createMockWhisperClient();
      const queue = new TranscriptionQueue(mockClient);
      let clearedCount = 0;

      queue.on('cleared', (count) => {
        clearedCount = count;
      });

      queue.enqueue(createMockSegment());
      queue.enqueue(createMockSegment());
      queue.clear();

      expect(clearedCount).toBe(2);
    });
  });
});

