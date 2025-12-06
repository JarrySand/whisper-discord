/**
 * 相槌フィルター - Aizuchi (filler word) filter for Japanese transcription
 *
 * VC会話では「うん」「はい」「なるほど」などの相槌が大量に発生する。
 * これらは議事録としてはノイズとなるため、文字起こし結果から除去する。
 */
import { logger } from '../utils/logger.js';

export interface AizuchiFilterConfig {
  enabled: boolean;
  maxLength: number;
  customPatterns?: string[];
}

const DEFAULT_PATTERNS: RegExp[] = [
  // 基本的な相槌
  /^うん[。．、]*$/,
  /^ん[ー〜]*[。．、]*$/,
  /^はい[。．、]*$/,
  /^ええ[。．、]*$/,
  /^へー[ー]*[。．、]*$/,

  // フィラー（言い淀み）
  /^えー[っと]*[。．、]*$/,
  /^あー[。．、]*$/,
  /^まあ[。．、]*$/,
  /^えっと[。．、]*$/,
  /^あのー*[。．、]*$/,
  /^その[ー]*[。．、]*$/,
  /^なんか[。．、]*$/,

  // 同意・理解
  /^そうですね[。．、]*$/,
  /^なるほど[ね]*[。．、]*$/,
  /^確かに[。．、]*$/,
  /^そうそう[。．、]*$/,
  /^そっか[ー]*[。．、]*$/,
  /^そうだね[。．、]*$/,
  /^だね[。．、]*$/,
  /^ね[ー]*[。．、]*$/,

  // 感嘆
  /^おー[。．、]*$/,
  /^わー[。．、]*$/,
  /^すごい[。．、]*$/,
  /^ふーん[。．、]*$/,
  /^ほー[。．、]*$/,

  // 笑い
  /^[笑わはw]+[。．、]*$/,
  /^\(笑\)[。．、]*$/,
  /^ふふ[ふ]*[。．、]*$/,
  /^あは[は]*[。．、]*$/,
];

/**
 * 相槌フィルター
 */
export class AizuchiFilter {
  private patterns: RegExp[];
  private maxLength: number;
  private enabled: boolean;
  private filteredCount: number = 0;

  constructor(config: Partial<AizuchiFilterConfig> = {}) {
    this.enabled = config.enabled ?? true;
    this.maxLength = config.maxLength ?? 15;

    // デフォルトパターン + カスタムパターン
    this.patterns = [...DEFAULT_PATTERNS];
    if (config.customPatterns) {
      for (const pattern of config.customPatterns) {
        this.patterns.push(new RegExp(pattern));
      }
    }

    logger.debug(
      `AizuchiFilter initialized: enabled=${this.enabled}, ` +
        `patterns=${this.patterns.length}, maxLength=${this.maxLength}`
    );
  }

  /**
   * テキストが相槌かどうか判定
   */
  isAizuchi(text: string): boolean {
    if (!this.enabled) {
      return false;
    }

    const t = text.trim();

    // 長いテキストは相槌ではない
    if (t.length > this.maxLength) {
      return false;
    }

    // 空文字は相槌ではない（別途処理）
    if (t.length === 0) {
      return false;
    }

    // パターンマッチ
    for (const pattern of this.patterns) {
      if (pattern.test(t)) {
        logger.debug(`Aizuchi detected: '${t}'`);
        this.filteredCount++;
        return true;
      }
    }

    return false;
  }

  /**
   * 相槌をフィルタリング
   * @returns null if aizuchi, otherwise original text
   */
  filter(text: string): string | null {
    if (this.isAizuchi(text)) {
      return null;
    }
    return text;
  }

  /**
   * パターンを追加
   */
  addPattern(pattern: string): void {
    this.patterns.push(new RegExp(pattern));
  }

  /**
   * 統計を取得
   */
  getStats(): {
    enabled: boolean;
    patternCount: number;
    maxLength: number;
    filteredCount: number;
  } {
    return {
      enabled: this.enabled,
      patternCount: this.patterns.length,
      maxLength: this.maxLength,
      filteredCount: this.filteredCount,
    };
  }

  /**
   * フィルターをリセット
   */
  resetStats(): void {
    this.filteredCount = 0;
  }
}

