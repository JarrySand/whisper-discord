/**
 * ハルシネーションフィルターテスト
 * 
 * テスト項目:
 * - 繰り返しパターンを検出する
 * - 定型フレーズを検出する
 * - 正常なテキストは通過させる
 * - フィルタリング後に適切なテキストを返す
 */
import { HallucinationFilter } from '../../filters/hallucination-filter.js';

describe('HallucinationFilter', () => {
  describe('初期化', () => {
    test('デフォルト設定で初期化される', () => {
      const filter = new HallucinationFilter();
      const stats = filter.getStats();

      expect(stats.enabled).toBe(true);
      expect(stats.minRepetitionCount).toBe(3);
      expect(stats.maxRepetitionLength).toBe(20);
    });

    test('カスタム設定で初期化される', () => {
      const filter = new HallucinationFilter({
        enabled: false,
        minRepetitionCount: 5,
        maxRepetitionLength: 30,
      });
      const stats = filter.getStats();

      expect(stats.enabled).toBe(false);
      expect(stats.minRepetitionCount).toBe(5);
      expect(stats.maxRepetitionLength).toBe(30);
    });
  });

  describe('繰り返しパターン検出', () => {
    let filter: HallucinationFilter;

    beforeEach(() => {
      filter = new HallucinationFilter();
    });

    test('同じ単語の繰り返しを検出する', () => {
      const result = filter.detectRepetition('しょうがない しょうがない しょうがない');
      
      expect(result.isRepetition).toBe(true);
      expect(result.phrase).toBe('しょうがない');
    });

    test('サブストリングの繰り返しを検出する', () => {
      const result = filter.detectRepetition('ああああああああああああ');
      
      expect(result.isRepetition).toBe(true);
    });

    test('短いテキストでは繰り返しを検出しない', () => {
      const result = filter.detectRepetition('うん');
      
      expect(result.isRepetition).toBe(false);
    });

    test('繰り返しでないテキストは検出しない', () => {
      const result = filter.detectRepetition('今日は良い天気ですね、明日も晴れるといいな');
      
      expect(result.isRepetition).toBe(false);
    });

    test('2回の繰り返しは閾値未満で検出しない', () => {
      const result = filter.detectRepetition('はい はい');
      
      expect(result.isRepetition).toBe(false);
    });
  });

  describe('定型フレーズパターン検出', () => {
    let filter: HallucinationFilter;

    beforeEach(() => {
      filter = new HallucinationFilter();
    });

    test('「字幕提供」を検出する', () => {
      expect(filter.detectPatternHallucination('字幕提供：ABC')).toBe(true);
    });

    test('「ご視聴ありがとうございました」を検出する', () => {
      expect(filter.detectPatternHallucination('ご視聴ありがとうございました')).toBe(true);
    });

    test('「チャンネル登録」を検出する', () => {
      expect(filter.detectPatternHallucination('チャンネル登録よろしく')).toBe(true);
    });

    test('ドットのみを検出する', () => {
      expect(filter.detectPatternHallucination('...')).toBe(true);
      expect(filter.detectPatternHallucination('........')).toBe(true);
    });

    test('音楽記号を検出する', () => {
      expect(filter.detectPatternHallucination('♪')).toBe(true);
      expect(filter.detectPatternHallucination('music')).toBe(true);
    });

    test('[音楽]を検出する', () => {
      expect(filter.detectPatternHallucination('[音楽]')).toBe(true);
    });

    test('[拍手]を検出する', () => {
      expect(filter.detectPatternHallucination('[拍手]')).toBe(true);
    });

    test('空白のみを検出する', () => {
      expect(filter.detectPatternHallucination('   ')).toBe(true);
      expect(filter.detectPatternHallucination('　　　')).toBe(true); // 全角空白
    });

    test('単独の「お」を検出する', () => {
      expect(filter.detectPatternHallucination(' お ')).toBe(true);
    });

    test('通常のテキストは検出しない', () => {
      expect(filter.detectPatternHallucination('今日の会議について話しましょう')).toBe(false);
    });
  });

  describe('filter メソッド', () => {
    let filter: HallucinationFilter;

    beforeEach(() => {
      filter = new HallucinationFilter();
    });

    test('正常なテキストはそのまま返す', () => {
      const result = filter.filter('今日は良い天気ですね');
      
      expect(result.text).toBe('今日は良い天気ですね');
      expect(result.wasFiltered).toBe(false);
      expect(result.reason).toBeNull();
    });

    test('パターンマッチでフィルタリングされる', () => {
      const result = filter.filter('字幕提供：ABC放送');
      
      expect(result.text).toBe('');
      expect(result.wasFiltered).toBe(true);
      expect(result.reason).toBe('pattern_match');
    });

    test('繰り返しは1回分だけ残す', () => {
      const result = filter.filter('しょうがない しょうがない しょうがない');
      
      expect(result.wasFiltered).toBe(true);
      expect(result.reason).toContain('repetition');
      expect(result.text).toBe('しょうがない');
    });

    test('空文字は変更しない', () => {
      const result = filter.filter('');
      
      expect(result.text).toBe('');
      expect(result.wasFiltered).toBe(false);
    });
  });

  describe('無効化', () => {
    test('enabled=falseの場合は何もフィルタリングしない', () => {
      const filter = new HallucinationFilter({ enabled: false });

      const result1 = filter.filter('しょうがない しょうがない しょうがない');
      expect(result1.wasFiltered).toBe(false);
      expect(result1.text).toBe('しょうがない しょうがない しょうがない');

      const result2 = filter.filter('字幕提供：ABC');
      expect(result2.wasFiltered).toBe(false);
    });
  });

  describe('統計', () => {
    test('フィルタリング回数をカウントする', () => {
      const filter = new HallucinationFilter();

      filter.filter('字幕提供：ABC'); // pattern
      filter.filter('ご視聴ありがとうございました'); // pattern
      filter.filter('あああああああああああ'); // repetition
      filter.filter('通常のテキスト'); // no filter

      const stats = filter.getStats();
      expect(stats.totalFiltered).toBe(3);
      expect(stats.patternFiltered).toBe(2);
      expect(stats.repetitionFiltered).toBe(1);
    });

    test('統計をリセットできる', () => {
      const filter = new HallucinationFilter();

      filter.filter('字幕提供：ABC');
      filter.filter('あああああああああああ');
      
      filter.resetStats();

      const stats = filter.getStats();
      expect(stats.totalFiltered).toBe(0);
      expect(stats.patternFiltered).toBe(0);
      expect(stats.repetitionFiltered).toBe(0);
    });
  });

  describe('minRepetitionCount設定', () => {
    test('閾値を変更すると検出感度が変わる', () => {
      const strictFilter = new HallucinationFilter({ minRepetitionCount: 5 });
      const looseFilter = new HallucinationFilter({ minRepetitionCount: 2 });

      const text = 'はい はい はい';

      // 5回未満なので検出しない
      const strictResult = strictFilter.detectRepetition(text);
      expect(strictResult.isRepetition).toBe(false);

      // 2回以上なので検出する
      const looseResult = looseFilter.detectRepetition(text);
      expect(looseResult.isRepetition).toBe(true);
    });
  });

  describe('エッジケース', () => {
    let filter: HallucinationFilter;

    beforeEach(() => {
      filter = new HallucinationFilter();
    });

    test('nullや空文字でもエラーにならない', () => {
      expect(() => filter.detectPatternHallucination('')).not.toThrow();
      expect(() => filter.detectRepetition('')).not.toThrow();
    });

    test('非常に長い繰り返しも検出する', () => {
      const longRepetition = 'テスト'.repeat(100);
      const result = filter.detectRepetition(longRepetition);
      
      expect(result.isRepetition).toBe(true);
    });

    test('部分的な繰り返しは検出しない', () => {
      // 「です」が複数回出現するが、テキストの80%未満
      const result = filter.detectRepetition('これはテストです。あれもテストです。それもテストです。');
      
      expect(result.isRepetition).toBe(false);
    });
  });
});

