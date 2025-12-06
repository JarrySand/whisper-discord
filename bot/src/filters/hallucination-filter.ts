/**
 * ハルシネーションフィルター - Hallucination detection and filtering
 *
 * Whisper はまれに以下のようなハルシネーションを生成する:
 * - 同じフレーズの繰り返し: 「しょうがない しょうがない しょうがない」
 * - 意味不明な繰り返しパターン
 * - 特定の定型フレーズ（字幕提供、ご視聴ありがとうございましたなど）
 */
import { logger } from '../utils/logger.js';

export interface HallucinationFilterConfig {
  enabled: boolean;
  minRepetitionCount: number;
  maxRepetitionLength: number;
}

// 定型フレーズパターン（Whisper がよく生成するハルシネーション）
const HALLUCINATION_PATTERNS: RegExp[] = [
  // 典型的なハルシネーション（無音時に頻発）
  /^ありがとうございました[。.]?$/,
  /^ありがとうございます[。.]?$/,
  /ありがとうございました[。.]?$/,  // 文末のありがとうございましたも検出
  /^字幕提供.*$/,
  /^ご視聴ありがとうございました.*$/,
  /^チャンネル登録.*$/,
  /^お疲れ様でした[。.]?$/,
  /^最後までご視聴.*$/,
  /^ご清聴ありがとうございました.*$/,
  /^おやすみなさい[。.]?$/,
  /^では[、,]?また[。.]?$/,
  /^それでは[。.]?$/,
  /^以上です[。.]?$/,
  /^\.+$/, // ドットのみ
  /^,+$/, // カンマのみ
  /^[\s\u3000]+$/, // 空白のみ
  /(?:music|♪|♫)+/i, // 音楽記号
  /\[音楽\]/,
  /\[拍手\]/,
  /^\s*お\s*$/, // 単独の「お」
  /^\s*ん\s*$/, // 単独の「ん」
  /^はい[。.]?$/, // 単独の「はい」
  /^うん[。.]?$/, // 単独の「うん」
  /^えー[っと]*[。.]?$/, // えー、えーっと
];

export interface HallucinationFilterResult {
  text: string;
  wasFiltered: boolean;
  reason: string | null;
}

/**
 * ハルシネーションフィルター
 */
export class HallucinationFilter {
  private enabled: boolean;
  private minRepetitionCount: number;
  private maxRepetitionLength: number;
  private stats = {
    totalFiltered: 0,
    repetitionFiltered: 0,
    patternFiltered: 0,
  };

  constructor(config: Partial<HallucinationFilterConfig> = {}) {
    this.enabled = config.enabled ?? true;
    this.minRepetitionCount = config.minRepetitionCount ?? 3;
    this.maxRepetitionLength = config.maxRepetitionLength ?? 20;
  }

  /**
   * 繰り返しパターンを検出
   */
  detectRepetition(text: string): { isRepetition: boolean; phrase: string | null } {
    if (!text || text.length < 6) {
      return { isRepetition: false, phrase: null };
    }

    const t = text.trim();

    // スペースで分割して同じ単語の繰り返しを検出
    const words = t.split(/\s+/);
    if (words.length >= this.minRepetitionCount) {
      const uniqueWords = new Set(words);
      if (uniqueWords.size === 1) {
        return { isRepetition: true, phrase: words[0] };
      }
    }

    // サブストリングの繰り返しを検出
    for (
      let phraseLen = 2;
      phraseLen < Math.min(this.maxRepetitionLength + 1, Math.floor(t.length / 2) + 1);
      phraseLen++
    ) {
      const phrase = t.substring(0, phraseLen);
      let count = 0;
      let pos = 0;

      while ((pos = t.indexOf(phrase, pos)) !== -1) {
        count++;
        pos += phrase.length;
      }

      if (count >= this.minRepetitionCount) {
        const expectedLen = phrase.length * count;
        // 繰り返しがテキストの80%以上を占める
        if (expectedLen / t.length >= 0.8) {
          return { isRepetition: true, phrase };
        }
      }
    }

    return { isRepetition: false, phrase: null };
  }

  /**
   * 定型フレーズパターンを検出
   */
  detectPatternHallucination(text: string): boolean {
    if (!text) {
      return false;
    }

    for (const pattern of HALLUCINATION_PATTERNS) {
      if (pattern.test(text)) {
        return true;
      }
    }

    return false;
  }

  /**
   * テキストをフィルタリング
   */
  filter(text: string): HallucinationFilterResult {
    if (!this.enabled || !text) {
      return { text, wasFiltered: false, reason: null };
    }

    // パターンマッチによるハルシネーション検出
    if (this.detectPatternHallucination(text)) {
      this.stats.totalFiltered++;
      this.stats.patternFiltered++;
      logger.debug(`Pattern hallucination detected: ${text.substring(0, 50)}...`);
      return { text: '', wasFiltered: true, reason: 'pattern_match' };
    }

    // 繰り返し検出
    const { isRepetition, phrase } = this.detectRepetition(text);
    if (isRepetition) {
      this.stats.totalFiltered++;
      this.stats.repetitionFiltered++;
      logger.debug(
        `Repetition hallucination detected: '${phrase}' in '${text.substring(0, 50)}...'`
      );

      // 繰り返されたフレーズを1つだけ残す
      if (phrase) {
        return {
          text: phrase.trim(),
          wasFiltered: true,
          reason: `repetition:${phrase}`,
        };
      }

      return { text: '', wasFiltered: true, reason: 'repetition' };
    }

    return { text, wasFiltered: false, reason: null };
  }

  /**
   * 統計を取得
   */
  getStats(): {
    enabled: boolean;
    minRepetitionCount: number;
    maxRepetitionLength: number;
    totalFiltered: number;
    repetitionFiltered: number;
    patternFiltered: number;
  } {
    return {
      enabled: this.enabled,
      minRepetitionCount: this.minRepetitionCount,
      maxRepetitionLength: this.maxRepetitionLength,
      ...this.stats,
    };
  }

  /**
   * 統計をリセット
   */
  resetStats(): void {
    this.stats = {
      totalFiltered: 0,
      repetitionFiltered: 0,
      patternFiltered: 0,
    };
  }
}

