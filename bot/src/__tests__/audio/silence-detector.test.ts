/**
 * T-2: 無音検知テスト - SilenceDetector
 * 
 * 目的: 誤分割が起きないか確認
 * 
 * テスト項目:
 * - 無音を正しく検出する
 * - 音声後に無音を検出するとセグメント化
 * - 短い無音では誤分割しない
 * - RMSSilenceDetector のテスト
 */
import { SilenceDetector, RMSSilenceDetector } from '../../audio/silence-detector.js';

/**
 * 無音PCMデータを生成（16-bit, 16kHz）
 */
function createSilentPcm(durationMs: number): Buffer {
  const sampleRate = 16000;
  const bytesPerSample = 2;
  const samples = Math.floor((sampleRate * durationMs) / 1000);
  const buffer = Buffer.alloc(samples * bytesPerSample);
  // 0で初期化されているので無音
  return buffer;
}

/**
 * ノイズを含む無音PCMデータを生成（閾値以下のランダムノイズ）
 */
function createLowNoisepcm(durationMs: number, maxAmplitude = 300): Buffer {
  const sampleRate = 16000;
  const bytesPerSample = 2;
  const samples = Math.floor((sampleRate * durationMs) / 1000);
  const buffer = Buffer.alloc(samples * bytesPerSample);

  for (let i = 0; i < samples; i++) {
    const value = Math.floor(Math.random() * maxAmplitude * 2) - maxAmplitude;
    buffer.writeInt16LE(value, i * bytesPerSample);
  }

  return buffer;
}

/**
 * 音声（非無音）PCMデータを生成
 */
function createLoudPcm(durationMs: number, amplitude = 10000): Buffer {
  const sampleRate = 16000;
  const bytesPerSample = 2;
  const samples = Math.floor((sampleRate * durationMs) / 1000);
  const buffer = Buffer.alloc(samples * bytesPerSample);

  for (let i = 0; i < samples; i++) {
    // サイン波を生成（440Hz）
    const freq = 440;
    const value = Math.floor(amplitude * Math.sin((2 * Math.PI * freq * i) / sampleRate));
    buffer.writeInt16LE(value, i * bytesPerSample);
  }

  return buffer;
}

describe('SilenceDetector', () => {
  describe('T-2: 無音検知テスト', () => {
    test('無音を正しく検出する', async () => {
      const detector = new SilenceDetector({ amplitudeThreshold: 500 });

      // 最初の呼び出しで無音開始を記録
      const silentPcm = createSilentPcm(100);
      detector.analyze(silentPcm);

      // 少し待ってから2回目の呼び出し
      await new Promise((r) => setTimeout(r, 50));
      const silenceDuration = detector.analyze(silentPcm);

      expect(silenceDuration).toBeGreaterThan(0);
    });

    test('純粋な無音バッファでの検出', async () => {
      const detector = new SilenceDetector({
        amplitudeThreshold: 500,
        silenceRatio: 0.9,
      });

      // 完全な無音 - 最初の呼び出しで無音開始を記録
      const silentPcm = createSilentPcm(100);
      detector.analyze(silentPcm);

      // 少し待ってから2回目
      await new Promise((r) => setTimeout(r, 50));
      const result = detector.analyze(silentPcm);

      expect(result).toBeGreaterThan(0);
    });

    test('閾値以下のノイズも無音として検出する', async () => {
      const detector = new SilenceDetector({
        amplitudeThreshold: 500,
        silenceRatio: 0.9,
      });

      // 閾値以下のノイズ - 最初の呼び出しで無音開始を記録
      const lowNoisePcm = createLowNoisepcm(100, 300);
      detector.analyze(lowNoisePcm);

      // 少し待ってから2回目
      await new Promise((r) => setTimeout(r, 50));
      const result = detector.analyze(lowNoisePcm);

      expect(result).toBeGreaterThan(0);
    });

    test('音声は無音として検出しない', () => {
      const detector = new SilenceDetector({ amplitudeThreshold: 500 });

      const loudPcm = createLoudPcm(100, 10000);
      const result = detector.analyze(loudPcm);

      expect(result).toBe(0);
    });

    test('音声後に無音を検出するとセグメント化判定可能', async () => {
      const detector = new SilenceDetector({
        amplitudeThreshold: 500,
        silenceDuration: 600, // 600ms
        silenceRatio: 0.9,
      });

      // まず音声を入力
      detector.analyze(createLoudPcm(500));
      expect(detector.shouldSegment()).toBe(false);

      // 600ms以上の無音を入力
      // 無音検知は時間ベースなので、連続で呼び出す
      detector.analyze(createSilentPcm(100));
      await new Promise((r) => setTimeout(r, 700)); // 無音継続を待つ
      detector.analyze(createSilentPcm(100));

      expect(detector.shouldSegment()).toBe(true);
    });

    test('短い無音では誤分割しない', () => {
      const detector = new SilenceDetector({
        amplitudeThreshold: 500,
        silenceDuration: 600, // 600ms
        silenceRatio: 0.9,
      });

      // 音声を入力
      detector.analyze(createLoudPcm(1000));

      // 短い無音（300ms）
      detector.analyze(createSilentPcm(100));

      // 600ms未満なのでセグメント化しない
      expect(detector.shouldSegment()).toBe(false);
    });

    test('リセットで無音計測がクリアされる', () => {
      const detector = new SilenceDetector({
        amplitudeThreshold: 500,
        silenceDuration: 100,
      });

      // 無音を検出
      detector.analyze(createSilentPcm(100));

      // リセット
      detector.reset();

      // 直後はセグメント化されない
      expect(detector.shouldSegment()).toBe(false);
    });
  });

  describe('設定管理', () => {
    test('設定を更新できる', () => {
      const detector = new SilenceDetector();
      const originalConfig = detector.getConfig();

      detector.updateConfig({ amplitudeThreshold: 1000 });
      const updatedConfig = detector.getConfig();

      expect(updatedConfig.amplitudeThreshold).toBe(1000);
      expect(updatedConfig.silenceDuration).toBe(originalConfig.silenceDuration);
    });

    test('現在の設定を取得できる', () => {
      const detector = new SilenceDetector({
        amplitudeThreshold: 1000,
        silenceDuration: 800,
        windowSize: 320,
        silenceRatio: 0.95,
      });

      const config = detector.getConfig();

      expect(config.amplitudeThreshold).toBe(1000);
      expect(config.silenceDuration).toBe(800);
      expect(config.windowSize).toBe(320);
      expect(config.silenceRatio).toBe(0.95);
    });

    test('デフォルト設定が適用される', () => {
      const detector = new SilenceDetector();
      const config = detector.getConfig();

      expect(config.amplitudeThreshold).toBe(500);
      expect(config.silenceDuration).toBe(600);
      expect(config.windowSize).toBe(160);
      expect(config.silenceRatio).toBe(0.9);
    });
  });

  describe('エッジケース', () => {
    test('空のバッファを処理できる', () => {
      const detector = new SilenceDetector();
      const emptyBuffer = Buffer.alloc(0);

      // エラーが発生しないこと
      expect(() => detector.analyze(emptyBuffer)).not.toThrow();
    });

    test('非常に短いバッファを処理できる', () => {
      const detector = new SilenceDetector();
      const shortBuffer = Buffer.alloc(4); // 2サンプル

      expect(() => detector.analyze(shortBuffer)).not.toThrow();
    });

    test('連続的な分析で正確な時間追跡', async () => {
      const detector = new SilenceDetector({
        amplitudeThreshold: 500,
        silenceDuration: 200,
      });

      // 無音を連続して分析
      detector.analyze(createSilentPcm(100));
      const t1 = detector.analyze(createSilentPcm(100));

      await new Promise((r) => setTimeout(r, 50));

      const t2 = detector.analyze(createSilentPcm(100));

      // 時間が増加していることを確認
      expect(t2).toBeGreaterThan(t1);
    });
  });
});

describe('RMSSilenceDetector', () => {
  test('RMS計算による無音検出', async () => {
    const detector = new RMSSilenceDetector(0.02, 600);

    // 最初の呼び出しで無音開始を記録
    const silentPcm = createSilentPcm(100);
    detector.analyzeRMS(silentPcm);

    // 少し待ってから2回目
    await new Promise((r) => setTimeout(r, 50));
    const result = detector.analyzeRMS(silentPcm);

    expect(result).toBeGreaterThan(0);
  });

  test('音声はRMSで無音として検出しない', () => {
    const detector = new RMSSilenceDetector(0.02, 600);

    const loudPcm = createLoudPcm(100, 10000);
    const result = detector.analyzeRMS(loudPcm);

    expect(result).toBe(0);
  });

  test('セグメント化判定', async () => {
    const detector = new RMSSilenceDetector(0.02, 200);

    // 無音を検出開始
    detector.analyzeRMS(createSilentPcm(100));
    await new Promise((r) => setTimeout(r, 250));
    detector.analyzeRMS(createSilentPcm(100));

    expect(detector.shouldSegment()).toBe(true);
  });

  test('リセット', () => {
    const detector = new RMSSilenceDetector(0.02, 100);

    detector.analyzeRMS(createSilentPcm(100));
    detector.reset();

    expect(detector.shouldSegment()).toBe(false);
  });

  test('空バッファの処理', () => {
    const detector = new RMSSilenceDetector();
    const emptyBuffer = Buffer.alloc(0);

    expect(() => detector.analyzeRMS(emptyBuffer)).not.toThrow();
  });
});

