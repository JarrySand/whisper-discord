/**
 * T-4: 全体遅延テスト
 * 
 * 目的: 3〜30秒以内で安定
 * 
 * テスト項目:
 * - 30秒以内に文字起こし完了
 * - 連続セグメントで安定した遅延
 * - サーキットブレーカー連携時のパフォーマンス
 * 
 * 注意: これらのテストは実際のWhisper APIを使用しないモックテストです。
 *       実際のAPIを使用したテストは手動で行う必要があります。
 */
import { TranscriptionQueue } from '../../api/queue.js';
import { CircuitBreaker } from '../../api/circuit-breaker.js';
import type { WhisperClient } from '../../api/whisper-client.js';
import type { AudioSegment, TranscribeResponse } from '../../types/index.js';

/**
 * モックのAudioSegmentを作成
 */
function createMockSegment(duration = 3000): AudioSegment {
  const now = Date.now();
  return {
    id: `seg-${Math.random().toString(36).slice(2, 10)}`,
    userId: 'user-1',
    username: 'testuser',
    displayName: 'Test User',
    startTimestamp: now - duration,
    endTimestamp: now,
    duration,
    audioData: Buffer.from('mock-audio'),
    audioFormat: 'ogg',
    sampleRate: 16000,
    channels: 1,
    bitrate: 32000,
  };
}

/**
 * 遅延をシミュレートするWhisperClientモック
 */
function createTimedMockWhisperClient(processingDelayMs: number): jest.Mocked<WhisperClient> {
  return {
    transcribe: jest.fn().mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, processingDelayMs));
      return {
        success: true,
        data: {
          user_id: 'user-1',
          username: 'testuser',
          display_name: 'Test User',
          text: 'これはテストメッセージです。',
          start_ts: Date.now() - 3000,
          end_ts: Date.now(),
          duration_ms: 3000,
          language: 'ja',
          confidence: 0.95,
          processing_time_ms: processingDelayMs,
        },
      } as TranscribeResponse;
    }),
    healthCheck: jest.fn(),
    getBaseUrl: jest.fn().mockReturnValue('http://localhost:8000'),
  } as unknown as jest.Mocked<WhisperClient>;
}

describe('T-4: 全体遅延テスト', () => {
  describe('30秒以内に完了', () => {
    test('シミュレートされたAPI遅延で30秒以内に完了', async () => {
      // 5秒の処理遅延をシミュレート
      const mockClient = createTimedMockWhisperClient(5000);
      const queue = new TranscriptionQueue(mockClient);

      const segment = createMockSegment(5000);
      const startTime = Date.now();

      const resultPromise = new Promise<TranscribeResponse>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Timeout after 30 seconds')), 30000);

        queue.on('completed', (_item, result: TranscribeResponse) => {
          clearTimeout(timeout);
          resolve(result);
        });

        queue.on('failed', (_item, error) => {
          clearTimeout(timeout);
          reject(error);
        });
      });

      queue.start();
      queue.enqueue(segment);

      const result = await resultPromise;
      const elapsed = Date.now() - startTime;

      expect(result.success).toBe(true);
      expect(result.data?.text).toBeDefined();
      expect(elapsed).toBeLessThan(30000);

      console.log(`遅延: ${elapsed}ms`);

      queue.stop();
    });
  });

  describe('連続セグメントの安定性', () => {
    test('連続10セグメントで安定した遅延', async () => {
      // 1秒の処理遅延をシミュレート
      const mockClient = createTimedMockWhisperClient(1000);
      const queue = new TranscriptionQueue(mockClient, { concurrency: 2 });
      const latencies: number[] = [];

      let completedCount = 0;
      const totalSegments = 10;

      const allCompletedPromise = new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Timeout')), 60000);

        queue.on('completed', () => {
          completedCount++;
          if (completedCount >= totalSegments) {
            clearTimeout(timeout);
            resolve();
          }
        });
      });

      queue.start();

      // 10セグメントを順次追加
      for (let i = 0; i < totalSegments; i++) {
        const segment = createMockSegment(3000);
        const startTime = Date.now();

        queue.once('completed', () => {
          latencies.push(Date.now() - startTime);
        });

        queue.enqueue(segment);
      }

      await allCompletedPromise;

      const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;
      const maxLatency = Math.max(...latencies);
      const minLatency = Math.min(...latencies);

      expect(avgLatency).toBeLessThan(15000);
      expect(maxLatency).toBeLessThan(30000);

      console.log('遅延統計:');
      console.log(`  平均: ${Math.round(avgLatency)}ms`);
      console.log(`  最大: ${maxLatency}ms`);
      console.log(`  最小: ${minLatency}ms`);
      console.log(`  完了数: ${completedCount}/${totalSegments}`);

      queue.stop();
    });

    test('並行処理で高速化される', async () => {
      const mockClient = createTimedMockWhisperClient(500);

      // concurrency=1の場合
      const queueSerial = new TranscriptionQueue(mockClient, { concurrency: 1 });

      // concurrency=4の場合
      const queueParallel = new TranscriptionQueue(mockClient, { concurrency: 4 });

      const measureTime = async (queue: TranscriptionQueue, count: number): Promise<number> => {
        let completed = 0;
        const startTime = Date.now();

        const donePromise = new Promise<number>((resolve) => {
          queue.on('completed', () => {
            completed++;
            if (completed >= count) {
              resolve(Date.now() - startTime);
            }
          });
        });

        queue.start();

        for (let i = 0; i < count; i++) {
          queue.enqueue(createMockSegment());
        }

        const elapsed = await donePromise;
        queue.stop();
        return elapsed;
      };

      const serialTime = await measureTime(queueSerial, 4);
      const parallelTime = await measureTime(queueParallel, 4);

      console.log(`シリアル処理 (concurrency=1): ${serialTime}ms`);
      console.log(`並列処理 (concurrency=4): ${parallelTime}ms`);

      // 並列処理の方が速い（少なくとも同等以上）
      expect(parallelTime).toBeLessThanOrEqual(serialTime * 1.1); // 10%マージン
    });
  });

  describe('サーキットブレーカー連携', () => {
    test('サーキットブレーカーがオーバーヘッドを最小化', async () => {
      const mockClient = createTimedMockWhisperClient(100);
      const circuitBreaker = new CircuitBreaker();
      const queue = new TranscriptionQueue(mockClient, {}, circuitBreaker);

      const startTime = Date.now();
      let completed = false;

      const donePromise = new Promise<void>((resolve) => {
        queue.on('completed', () => {
          completed = true;
          resolve();
        });
      });

      queue.start();
      queue.enqueue(createMockSegment());

      await donePromise;
      const elapsed = Date.now() - startTime;

      expect(completed).toBe(true);
      expect(circuitBreaker.isClosed()).toBe(true);

      // サーキットブレーカーのオーバーヘッドは最小限
      expect(elapsed).toBeLessThan(500); // 100ms処理 + オーバーヘッド

      console.log(`サーキットブレーカー連携時の遅延: ${elapsed}ms`);

      queue.stop();
    });
  });

  describe('パフォーマンスメトリクス', () => {
    test('処理時間の統計を収集できる', async () => {
      const processingTimes = [100, 200, 150, 180, 120];
      let callIndex = 0;

      const variableClient: jest.Mocked<WhisperClient> = {
        transcribe: jest.fn().mockImplementation(async () => {
          const delay = processingTimes[callIndex % processingTimes.length];
          callIndex++;
          await new Promise((r) => setTimeout(r, delay));
          return {
            success: true,
            data: {
              user_id: 'user-1',
              username: 'testuser',
              display_name: 'Test User',
              text: 'テスト',
              start_ts: Date.now() - 3000,
              end_ts: Date.now(),
              duration_ms: 3000,
              language: 'ja',
              confidence: 0.95,
              processing_time_ms: delay,
            },
          } as TranscribeResponse;
        }),
        healthCheck: jest.fn(),
        getBaseUrl: jest.fn().mockReturnValue('http://localhost:8000'),
      } as unknown as jest.Mocked<WhisperClient>;

      const queue = new TranscriptionQueue(variableClient, { concurrency: 1 });
      const recordedTimes: number[] = [];

      queue.on('completed', (_item, result: TranscribeResponse) => {
        if (result.data?.processing_time_ms) {
          recordedTimes.push(result.data.processing_time_ms);
        }
      });

      let completed = 0;
      const donePromise = new Promise<void>((resolve) => {
        queue.on('completed', () => {
          completed++;
          if (completed >= processingTimes.length) {
            resolve();
          }
        });
      });

      queue.start();

      for (let i = 0; i < processingTimes.length; i++) {
        queue.enqueue(createMockSegment());
      }

      await donePromise;

      const avg = recordedTimes.reduce((a, b) => a + b, 0) / recordedTimes.length;
      const max = Math.max(...recordedTimes);
      const min = Math.min(...recordedTimes);

      console.log('処理時間メトリクス:');
      console.log(`  サンプル数: ${recordedTimes.length}`);
      console.log(`  平均: ${avg.toFixed(2)}ms`);
      console.log(`  最大: ${max}ms`);
      console.log(`  最小: ${min}ms`);

      expect(recordedTimes).toHaveLength(processingTimes.length);

      queue.stop();
    });
  });
});

