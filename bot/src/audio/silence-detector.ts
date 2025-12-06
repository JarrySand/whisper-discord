import type { SilenceDetectionConfig } from '../types/index.js';

/**
 * デフォルトの無音検知設定
 */
const defaultConfig: SilenceDetectionConfig = {
  amplitudeThreshold: 500, // 16-bit PCM の絶対値
  silenceDuration: 600, // 600ms
  windowSize: 160, // 10ms @ 16kHz
  silenceRatio: 0.9, // 90% が無音なら無音判定
};

/**
 * 無音検知クラス
 */
export class SilenceDetector {
  private config: SilenceDetectionConfig;
  private silenceStartTime: number | null = null;
  private readonly bytesPerSample = 2;

  constructor(config: Partial<SilenceDetectionConfig> = {}) {
    this.config = { ...defaultConfig, ...config };
  }

  /**
   * PCMデータを分析し、無音継続時間を返す
   * @returns 無音継続時間 (ms)、無音でなければ 0
   */
  analyze(pcmData: Buffer): number {
    const samples = pcmData.length / this.bytesPerSample;
    const windowSamples = Math.min(this.config.windowSize, samples);

    if (windowSamples === 0) {
      return this.silenceStartTime ? Date.now() - this.silenceStartTime : 0;
    }

    let silentSamples = 0;

    // 末尾のwindowを分析
    const startOffset = pcmData.length - windowSamples * this.bytesPerSample;
    for (let i = 0; i < windowSamples; i++) {
      const offset = startOffset + i * this.bytesPerSample;
      const amplitude = Math.abs(pcmData.readInt16LE(offset));

      if (amplitude < this.config.amplitudeThreshold) {
        silentSamples++;
      }
    }

    const silenceRatio = silentSamples / windowSamples;
    const isSilent = silenceRatio >= this.config.silenceRatio;

    const now = Date.now();

    if (isSilent) {
      if (this.silenceStartTime === null) {
        this.silenceStartTime = now;
      }
      return now - this.silenceStartTime;
    } else {
      this.silenceStartTime = null;
      return 0;
    }
  }

  /**
   * セグメント区切りが必要か判定
   */
  shouldSegment(): boolean {
    if (this.silenceStartTime === null) return false;
    return Date.now() - this.silenceStartTime >= this.config.silenceDuration;
  }

  /**
   * リセット
   */
  reset(): void {
    this.silenceStartTime = null;
  }

  /**
   * 設定を更新
   */
  updateConfig(config: Partial<SilenceDetectionConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * 現在の設定を取得
   */
  getConfig(): SilenceDetectionConfig {
    return { ...this.config };
  }
}

/**
 * RMS（二乗平均平方根）による高度な無音検知
 */
export class RMSSilenceDetector {
  private silenceStartTime: number | null = null;
  private readonly rmsThreshold: number;
  private readonly silenceDuration: number;

  constructor(rmsThreshold = 0.02, silenceDuration = 600) {
    this.rmsThreshold = rmsThreshold;
    this.silenceDuration = silenceDuration;
  }

  /**
   * RMS値を計算して無音判定
   */
  analyzeRMS(pcmData: Buffer): number {
    const samples = pcmData.length / 2;
    if (samples === 0) {
      return this.silenceStartTime ? Date.now() - this.silenceStartTime : 0;
    }

    let sumSquares = 0;

    for (let i = 0; i < samples; i++) {
      const sample = pcmData.readInt16LE(i * 2) / 32768; // 正規化 (-1 to 1)
      sumSquares += sample * sample;
    }

    const rms = Math.sqrt(sumSquares / samples);
    const isSilent = rms < this.rmsThreshold;

    const now = Date.now();

    if (isSilent) {
      if (this.silenceStartTime === null) {
        this.silenceStartTime = now;
      }
      return now - this.silenceStartTime;
    } else {
      this.silenceStartTime = null;
      return 0;
    }
  }

  /**
   * セグメント区切りが必要か判定
   */
  shouldSegment(): boolean {
    if (this.silenceStartTime === null) return false;
    return Date.now() - this.silenceStartTime >= this.silenceDuration;
  }

  /**
   * リセット
   */
  reset(): void {
    this.silenceStartTime = null;
  }
}

