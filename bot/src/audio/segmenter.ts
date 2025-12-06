import { v4 as uuidv4 } from 'uuid';
import fs from 'fs/promises';
import path from 'path';
import type { UserAudioBuffer, AudioSegment, SegmenterConfig } from '../types/index.js';
import { AudioEncoder } from './encoder.js';
import { Resampler } from './resampler.js';
import { logger } from '../utils/logger.js';
import { botConfig } from '../config/index.js';
import { getISODateString, getISOTimeString } from '../utils/time.js';

/**
 * 音声セグメンター
 */
export class AudioSegmenter {
  private encoder: AudioEncoder;
  private resampler: Resampler;
  private config: SegmenterConfig;

  // コスト削減統計
  private stats = {
    totalSegments: 0,
    discardedTooShort: 0,
    discardedLowEnergy: 0,
    processedSegments: 0,
  };

  constructor(config?: Partial<SegmenterConfig>) {
    this.encoder = new AudioEncoder();
    this.resampler = new Resampler();
    this.config = {
      minDuration: config?.minDuration ?? botConfig.audio.minSegmentDuration,
      maxDuration: config?.maxDuration ?? botConfig.audio.maxSegmentDuration,
      minRmsThreshold: config?.minRmsThreshold ?? botConfig.audio.minRmsThreshold,
      saveToFile: config?.saveToFile ?? false,
      segmentDir: config?.segmentDir ?? botConfig.output.segmentDir,
    };
  }

  /**
   * PCMデータのRMS（二乗平均平方根）を計算
   * 音声エネルギーレベルを測定し、無音/低エネルギーを検出
   */
  private calculateRMS(pcmData: Buffer): number {
    const samples = pcmData.length / 2;  // 16-bit = 2 bytes per sample
    if (samples === 0) return 0;

    let sumSquares = 0;
    for (let i = 0; i < samples; i++) {
      // 16-bit PCMを-1〜1の範囲に正規化
      const sample = pcmData.readInt16LE(i * 2) / 32768;
      sumSquares += sample * sample;
    }

    return Math.sqrt(sumSquares / samples);
  }

  /**
   * バッファからセグメントを作成
   */
  async createSegment(buffer: UserAudioBuffer): Promise<AudioSegment | null> {
    this.stats.totalSegments++;
    const duration = this.calculateDuration(buffer);

    // 最小長未満は破棄
    if (duration < this.config.minDuration) {
      this.stats.discardedTooShort++;
      logger.debug(
        `Segment too short (${duration}ms < ${this.config.minDuration}ms), discarding`
      );
      return null;
    }

    // PCMデータを結合
    const pcmData = Buffer.concat(buffer.chunks.map((c) => c.data));

    // 低エネルギー（ほぼ無音）セグメントは破棄（コスト削減）
    const rms = this.calculateRMS(pcmData);
    if (rms < this.config.minRmsThreshold) {
      this.stats.discardedLowEnergy++;
      logger.debug(
        `Segment too quiet (RMS=${rms.toFixed(4)} < ${this.config.minRmsThreshold}), discarding [cost saving]`
      );
      return null;
    }

    // 48kHz Stereo → 16kHz Mono にリサンプリング
    const resampledData = this.resampler.resample(pcmData);

    // OGGにエンコード（失敗時はWAV）
    let audioData: Buffer;
    let audioFormat: 'ogg' | 'wav';

    try {
      audioData = await this.encoder.encodeToOgg(resampledData);
      audioFormat = 'ogg';
    } catch (error) {
      logger.warn('OGG encoding failed, falling back to WAV:', error);
      audioData = this.encoder.encodeToWav(resampledData);
      audioFormat = 'wav';
    }

    const segment: AudioSegment = {
      id: uuidv4(),
      userId: buffer.userId,
      username: buffer.username,
      displayName: buffer.displayName,
      startTimestamp: buffer.startTimestamp!,
      endTimestamp: buffer.lastActivityTimestamp,
      duration,
      audioData,
      audioFormat,
      sampleRate: 16000,
      channels: 1,
      bitrate: 32000,
    };

    // ファイル保存（オプション）
    if (this.config.saveToFile) {
      segment.audioPath = await this.saveSegment(segment);
    }

    // 正常に処理されたセグメントをカウント
    this.stats.processedSegments++;

    return segment;
  }

  /**
   * バッファの長さを計算
   */
  private calculateDuration(buffer: UserAudioBuffer): number {
    if (!buffer.startTimestamp) return 0;
    return buffer.lastActivityTimestamp - buffer.startTimestamp;
  }

  /**
   * セグメントをファイルに保存
   */
  private async saveSegment(segment: AudioSegment): Promise<string> {
    const date = new Date(segment.startTimestamp);
    const dateStr = getISODateString(date);
    const timeStr = getISOTimeString(date);

    const dir = path.join(this.config.segmentDir, dateStr);
    await fs.mkdir(dir, { recursive: true });

    const filename = `${segment.userId}_${timeStr}_${segment.id.slice(0, 8)}.${segment.audioFormat}`;
    const filepath = path.join(dir, filename);

    await fs.writeFile(filepath, segment.audioData);
    logger.debug(`Saved segment to ${filepath}`);

    return filepath;
  }

  /**
   * 設定を更新
   */
  updateConfig(config: Partial<SegmenterConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * 現在の設定を取得
   */
  getConfig(): SegmenterConfig {
    return { ...this.config };
  }

  /**
   * コスト削減統計を取得
   * API呼び出しをどれだけ削減できたかを確認できる
   */
  getStats(): {
    totalSegments: number;
    discardedTooShort: number;
    discardedLowEnergy: number;
    processedSegments: number;
    savedApiCalls: number;
    savingsRate: string;
  } {
    const savedApiCalls = this.stats.discardedTooShort + this.stats.discardedLowEnergy;
    const savingsRate = this.stats.totalSegments > 0
      ? ((savedApiCalls / this.stats.totalSegments) * 100).toFixed(1)
      : '0.0';

    return {
      ...this.stats,
      savedApiCalls,
      savingsRate: `${savingsRate}%`,
    };
  }

  /**
   * 統計をリセット
   */
  resetStats(): void {
    this.stats = {
      totalSegments: 0,
      discardedTooShort: 0,
      discardedLowEnergy: 0,
      processedSegments: 0,
    };
  }
}

