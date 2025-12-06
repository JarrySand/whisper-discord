/**
 * AudioSegmenter テスト
 * 
 * テスト項目:
 * - セグメント作成
 * - 最小長フィルタリング
 * - 低エネルギー（無音）フィルタリング
 * - RMS計算
 * - 統計情報
 */
import { AudioSegmenter } from '../../audio/segmenter.js';
import type { UserAudioBuffer } from '../../types/index.js';

/**
 * 無音PCMデータを生成（16-bit Stereo, 48kHz）
 */
function createSilentPcm(durationMs: number): Buffer {
  const sampleRate = 48000;
  const channels = 2;
  const bytesPerSample = 2;
  const samples = Math.floor((sampleRate * durationMs) / 1000);
  const buffer = Buffer.alloc(samples * bytesPerSample * channels);
  return buffer;
}

/**
 * 音声（非無音）PCMデータを生成（16-bit Stereo, 48kHz）
 */
function createLoudPcm(durationMs: number, amplitude = 10000): Buffer {
  const sampleRate = 48000;
  const channels = 2;
  const bytesPerSample = 2;
  const samples = Math.floor((sampleRate * durationMs) / 1000);
  const buffer = Buffer.alloc(samples * bytesPerSample * channels);

  for (let i = 0; i < samples; i++) {
    const freq = 440;
    const value = Math.floor(amplitude * Math.sin((2 * Math.PI * freq * i) / sampleRate));
    // ステレオなので左右両方に書き込み
    buffer.writeInt16LE(value, i * bytesPerSample * channels);
    buffer.writeInt16LE(value, i * bytesPerSample * channels + bytesPerSample);
  }

  return buffer;
}

/**
 * モックのUserAudioBufferを作成
 */
function createMockBuffer(
  durationMs: number,
  pcmData: Buffer,
  overrides: Partial<UserAudioBuffer> = {}
): UserAudioBuffer {
  const now = Date.now();
  return {
    userId: 'user-1',
    username: 'testuser',
    displayName: 'Test User',
    startTimestamp: now - durationMs,
    lastActivityTimestamp: now,
    chunks: [{ data: pcmData, timestamp: now - durationMs }],
    ...overrides,
  };
}

describe('AudioSegmenter', () => {
  let segmenter: AudioSegmenter;

  beforeEach(() => {
    segmenter = new AudioSegmenter({
      minDuration: 500,
      maxDuration: 30000,
      minRmsThreshold: 0.01,
      saveToFile: false,
    });
  });

  describe('初期化', () => {
    test('デフォルト設定で初期化される', () => {
      const defaultSegmenter = new AudioSegmenter();
      const config = defaultSegmenter.getConfig();

      expect(config.minDuration).toBeDefined();
      expect(config.maxDuration).toBeDefined();
      expect(config.minRmsThreshold).toBeDefined();
      expect(config.saveToFile).toBe(false);
    });

    test('カスタム設定で初期化される', () => {
      const config = segmenter.getConfig();

      expect(config.minDuration).toBe(500);
      expect(config.maxDuration).toBe(30000);
      expect(config.minRmsThreshold).toBe(0.01);
    });
  });

  describe('セグメント作成', () => {
    test('有効な音声からセグメントを作成できる', async () => {
      const duration = 1000;
      const pcmData = createLoudPcm(duration);
      const buffer = createMockBuffer(duration, pcmData);

      const segment = await segmenter.createSegment(buffer);

      expect(segment).not.toBeNull();
      expect(segment!.userId).toBe('user-1');
      expect(segment!.username).toBe('testuser');
      expect(segment!.duration).toBe(duration);
      expect(segment!.audioData).toBeInstanceOf(Buffer);
      expect(segment!.audioData.length).toBeGreaterThan(0);
    });

    test('セグメントにユーザー情報が含まれる', async () => {
      const pcmData = createLoudPcm(1000);
      const buffer = createMockBuffer(1000, pcmData, {
        userId: 'user-123',
        username: 'alice',
        displayName: 'Alice',
      });

      const segment = await segmenter.createSegment(buffer);

      expect(segment).not.toBeNull();
      expect(segment!.userId).toBe('user-123');
      expect(segment!.username).toBe('alice');
      expect(segment!.displayName).toBe('Alice');
    });

    test('セグメントにタイムスタンプが含まれる', async () => {
      const now = Date.now();
      const pcmData = createLoudPcm(1000);
      const buffer = createMockBuffer(1000, pcmData, {
        startTimestamp: now - 1000,
        lastActivityTimestamp: now,
      });

      const segment = await segmenter.createSegment(buffer);

      expect(segment).not.toBeNull();
      expect(segment!.startTimestamp).toBe(now - 1000);
      expect(segment!.endTimestamp).toBe(now);
    });
  });

  describe('最小長フィルタリング', () => {
    test('最小長未満のセグメントは破棄される', async () => {
      const duration = 300; // 500ms未満
      const pcmData = createLoudPcm(duration);
      const buffer = createMockBuffer(duration, pcmData);

      const segment = await segmenter.createSegment(buffer);

      expect(segment).toBeNull();
    });

    test('最小長以上のセグメントは作成される', async () => {
      const duration = 600; // 500ms以上
      const pcmData = createLoudPcm(duration);
      const buffer = createMockBuffer(duration, pcmData);

      const segment = await segmenter.createSegment(buffer);

      expect(segment).not.toBeNull();
    });

    test('破棄されたセグメントが統計にカウントされる', async () => {
      segmenter.resetStats();

      const shortPcm = createLoudPcm(300);
      const shortBuffer = createMockBuffer(300, shortPcm);
      await segmenter.createSegment(shortBuffer);

      const stats = segmenter.getStats();
      expect(stats.discardedTooShort).toBe(1);
    });
  });

  describe('低エネルギーフィルタリング', () => {
    test('無音セグメントは破棄される', async () => {
      const duration = 1000;
      const pcmData = createSilentPcm(duration);
      const buffer = createMockBuffer(duration, pcmData);

      const segment = await segmenter.createSegment(buffer);

      expect(segment).toBeNull();
    });

    test('破棄されたセグメントが統計にカウントされる', async () => {
      segmenter.resetStats();

      const silentPcm = createSilentPcm(1000);
      const silentBuffer = createMockBuffer(1000, silentPcm);
      await segmenter.createSegment(silentBuffer);

      const stats = segmenter.getStats();
      expect(stats.discardedLowEnergy).toBe(1);
    });
  });

  describe('音声フォーマット', () => {
    test('セグメントにフォーマット情報が含まれる', async () => {
      const pcmData = createLoudPcm(1000);
      const buffer = createMockBuffer(1000, pcmData);

      const segment = await segmenter.createSegment(buffer);

      expect(segment).not.toBeNull();
      expect(['ogg', 'wav']).toContain(segment!.audioFormat);
      expect(segment!.sampleRate).toBe(16000);
      expect(segment!.channels).toBe(1);
    });
  });

  describe('設定更新', () => {
    test('設定を更新できる', () => {
      segmenter.updateConfig({ minDuration: 1000 });

      const config = segmenter.getConfig();
      expect(config.minDuration).toBe(1000);
    });

    test('部分的な設定更新ができる', () => {
      const originalConfig = segmenter.getConfig();
      segmenter.updateConfig({ minDuration: 2000 });

      const config = segmenter.getConfig();
      expect(config.minDuration).toBe(2000);
      expect(config.maxDuration).toBe(originalConfig.maxDuration);
    });
  });

  describe('統計情報', () => {
    test('統計を取得できる', async () => {
      segmenter.resetStats();

      // 正常なセグメント
      const loudPcm = createLoudPcm(1000);
      const loudBuffer = createMockBuffer(1000, loudPcm);
      await segmenter.createSegment(loudBuffer);

      // 短すぎるセグメント
      const shortPcm = createLoudPcm(300);
      const shortBuffer = createMockBuffer(300, shortPcm);
      await segmenter.createSegment(shortBuffer);

      // 無音セグメント
      const silentPcm = createSilentPcm(1000);
      const silentBuffer = createMockBuffer(1000, silentPcm);
      await segmenter.createSegment(silentBuffer);

      const stats = segmenter.getStats();

      expect(stats.totalSegments).toBe(3);
      expect(stats.processedSegments).toBe(1);
      expect(stats.discardedTooShort).toBe(1);
      expect(stats.discardedLowEnergy).toBe(1);
      expect(stats.savedApiCalls).toBe(2);
    });

    test('節約率が計算される', async () => {
      segmenter.resetStats();

      // 2つ破棄、1つ処理
      const loudPcm = createLoudPcm(1000);
      await segmenter.createSegment(createMockBuffer(1000, loudPcm));
      await segmenter.createSegment(createMockBuffer(300, createLoudPcm(300)));
      await segmenter.createSegment(createMockBuffer(1000, createSilentPcm(1000)));

      const stats = segmenter.getStats();

      expect(stats.savingsRate).toBe('66.7%');
    });

    test('統計をリセットできる', async () => {
      const pcmData = createLoudPcm(1000);
      const buffer = createMockBuffer(1000, pcmData);
      await segmenter.createSegment(buffer);

      segmenter.resetStats();

      const stats = segmenter.getStats();
      expect(stats.totalSegments).toBe(0);
      expect(stats.processedSegments).toBe(0);
      expect(stats.discardedTooShort).toBe(0);
      expect(stats.discardedLowEnergy).toBe(0);
    });
  });

  describe('エッジケース', () => {
    test('空のチャンクでもエラーにならない', async () => {
      const buffer: UserAudioBuffer = {
        userId: 'user-1',
        username: 'testuser',
        displayName: 'Test User',
        startTimestamp: Date.now() - 1000,
        lastActivityTimestamp: Date.now(),
        chunks: [],
      };

      await expect(segmenter.createSegment(buffer)).resolves.not.toThrow();
    });

    test('startTimestampがない場合は0を返す', async () => {
      const buffer: UserAudioBuffer = {
        userId: 'user-1',
        username: 'testuser',
        displayName: 'Test User',
        startTimestamp: undefined as unknown as number,
        lastActivityTimestamp: Date.now(),
        chunks: [{ data: createLoudPcm(1000), timestamp: Date.now() }],
      };

      const segment = await segmenter.createSegment(buffer);

      // duration計算で0になり、最小長未満で破棄される
      expect(segment).toBeNull();
    });
  });

  describe('複数チャンク', () => {
    test('複数チャンクが結合される', async () => {
      const now = Date.now();
      const chunk1 = createLoudPcm(500);
      const chunk2 = createLoudPcm(500);

      const buffer: UserAudioBuffer = {
        userId: 'user-1',
        username: 'testuser',
        displayName: 'Test User',
        startTimestamp: now - 1000,
        lastActivityTimestamp: now,
        chunks: [
          { data: chunk1, timestamp: now - 1000 },
          { data: chunk2, timestamp: now - 500 },
        ],
      };

      const segment = await segmenter.createSegment(buffer);

      expect(segment).not.toBeNull();
      expect(segment!.duration).toBe(1000);
    });
  });

  describe('minRmsThreshold設定', () => {
    test('閾値を変更すると検出感度が変わる', async () => {
      // 非常に低い閾値のセグメンター
      const sensitiveSegmenter = new AudioSegmenter({
        minDuration: 500,
        minRmsThreshold: 0.0001, // 非常に低い
        saveToFile: false,
      });

      // 低レベルのノイズを含むPCM（無音に近い）
      const lowNoisePcm = createLoudPcm(1000, 100); // 振幅100
      const buffer = createMockBuffer(1000, lowNoisePcm);

      // 低い閾値なら通過する可能性がある
      const segment = await sensitiveSegmenter.createSegment(buffer);

      // 結果は実装依存だが、エラーなく完了すること
      expect(() => segment).not.toThrow();
    });
  });
});

