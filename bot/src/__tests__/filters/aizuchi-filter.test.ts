/**
 * 相槌フィルターテスト
 * 
 * テスト項目:
 * - 基本的な相槌を検出する
 * - フィラー（言い淀み）を検出する
 * - 長いテキストは相槌とみなさない
 * - カスタムパターンを追加できる
 * - 統計情報を取得できる
 */
import { AizuchiFilter } from '../../filters/aizuchi-filter.js';

describe('AizuchiFilter', () => {
  describe('初期化', () => {
    test('デフォルト設定で初期化される', () => {
      const filter = new AizuchiFilter();
      const stats = filter.getStats();

      expect(stats.enabled).toBe(true);
      expect(stats.maxLength).toBe(15);
      expect(stats.patternCount).toBeGreaterThan(0);
    });

    test('カスタム設定で初期化される', () => {
      const filter = new AizuchiFilter({
        enabled: false,
        maxLength: 20,
      });
      const stats = filter.getStats();

      expect(stats.enabled).toBe(false);
      expect(stats.maxLength).toBe(20);
    });

    test('カスタムパターンを追加できる', () => {
      const filter = new AizuchiFilter({
        customPatterns: ['^オッケー$', '^りょ$'],
      });
      const stats = filter.getStats();

      // デフォルトパターン + カスタム2つ
      expect(stats.patternCount).toBeGreaterThan(2);
    });
  });

  describe('基本的な相槌検出', () => {
    let filter: AizuchiFilter;

    beforeEach(() => {
      filter = new AizuchiFilter();
    });

    test('「うん」を相槌として検出する', () => {
      expect(filter.isAizuchi('うん')).toBe(true);
      expect(filter.isAizuchi('うん。')).toBe(true);
    });

    test('「はい」を相槌として検出する', () => {
      expect(filter.isAizuchi('はい')).toBe(true);
      expect(filter.isAizuchi('はい。')).toBe(true);
    });

    test('「ええ」を相槌として検出する', () => {
      expect(filter.isAizuchi('ええ')).toBe(true);
    });

    test('「へー」を相槌として検出する', () => {
      expect(filter.isAizuchi('へー')).toBe(true);
      expect(filter.isAizuchi('へーー')).toBe(true);
    });

    test('「ん」を相槌として検出する', () => {
      expect(filter.isAizuchi('ん')).toBe(true);
      expect(filter.isAizuchi('んー')).toBe(true);
    });
  });

  describe('フィラー（言い淀み）検出', () => {
    let filter: AizuchiFilter;

    beforeEach(() => {
      filter = new AizuchiFilter();
    });

    test('「えーっと」を検出する', () => {
      expect(filter.isAizuchi('えーっと')).toBe(true);
      expect(filter.isAizuchi('えーと')).toBe(true);
    });

    test('「あー」を検出する', () => {
      expect(filter.isAizuchi('あー')).toBe(true);
    });

    test('「まあ」を検出する', () => {
      expect(filter.isAizuchi('まあ')).toBe(true);
    });

    test('「あのー」を検出する', () => {
      expect(filter.isAizuchi('あの')).toBe(true);
      expect(filter.isAizuchi('あのー')).toBe(true);
    });

    test('「なんか」を検出する', () => {
      expect(filter.isAizuchi('なんか')).toBe(true);
    });
  });

  describe('同意・理解の表現検出', () => {
    let filter: AizuchiFilter;

    beforeEach(() => {
      filter = new AizuchiFilter();
    });

    test('「そうですね」を検出する', () => {
      expect(filter.isAizuchi('そうですね')).toBe(true);
    });

    test('「なるほど」を検出する', () => {
      expect(filter.isAizuchi('なるほど')).toBe(true);
      expect(filter.isAizuchi('なるほどね')).toBe(true);
    });

    test('「確かに」を検出する', () => {
      expect(filter.isAizuchi('確かに')).toBe(true);
    });

    test('「そうそう」を検出する', () => {
      expect(filter.isAizuchi('そうそう')).toBe(true);
    });

    test('「そっか」を検出する', () => {
      expect(filter.isAizuchi('そっか')).toBe(true);
      expect(filter.isAizuchi('そっかー')).toBe(true);
    });
  });

  describe('感嘆・笑い検出', () => {
    let filter: AizuchiFilter;

    beforeEach(() => {
      filter = new AizuchiFilter();
    });

    test('「おー」を検出する', () => {
      expect(filter.isAizuchi('おー')).toBe(true);
    });

    test('「わー」を検出する', () => {
      expect(filter.isAizuchi('わー')).toBe(true);
    });

    test('「すごい」を検出する', () => {
      expect(filter.isAizuchi('すごい')).toBe(true);
    });

    test('笑いを検出する', () => {
      expect(filter.isAizuchi('笑')).toBe(true);
      expect(filter.isAizuchi('www')).toBe(true);
      expect(filter.isAizuchi('(笑)')).toBe(true);
    });
  });

  describe('相槌ではないテキスト', () => {
    let filter: AizuchiFilter;

    beforeEach(() => {
      filter = new AizuchiFilter();
    });

    test('通常の文章は相槌ではない', () => {
      expect(filter.isAizuchi('今日は良い天気ですね')).toBe(false);
      expect(filter.isAizuchi('そうですね、確かにその通りだと思います')).toBe(false);
    });

    test('長いテキストは相槌ではない', () => {
      expect(filter.isAizuchi('なるほど、それは良い考えですね')).toBe(false);
    });

    test('空文字は相槌ではない', () => {
      expect(filter.isAizuchi('')).toBe(false);
      expect(filter.isAizuchi('  ')).toBe(false);
    });

    test('質問は相槌ではない', () => {
      expect(filter.isAizuchi('本当ですか？')).toBe(false);
      expect(filter.isAizuchi('どう思いますか')).toBe(false);
    });
  });

  describe('filter メソッド', () => {
    let filter: AizuchiFilter;

    beforeEach(() => {
      filter = new AizuchiFilter();
    });

    test('相槌はnullを返す', () => {
      expect(filter.filter('うん')).toBeNull();
      expect(filter.filter('はい')).toBeNull();
    });

    test('相槌でないテキストはそのまま返す', () => {
      const text = 'これは重要な内容です';
      expect(filter.filter(text)).toBe(text);
    });
  });

  describe('無効化', () => {
    test('enabled=falseの場合は何も検出しない', () => {
      const filter = new AizuchiFilter({ enabled: false });

      expect(filter.isAizuchi('うん')).toBe(false);
      expect(filter.isAizuchi('はい')).toBe(false);
      expect(filter.filter('うん')).toBe('うん');
    });
  });

  describe('maxLength制限', () => {
    test('maxLengthを超えるテキストは相槌ではない', () => {
      const filter = new AizuchiFilter({ maxLength: 4 });

      expect(filter.isAizuchi('なるほどね')).toBe(false); // 5文字 > 4
      expect(filter.isAizuchi('うん')).toBe(true); // 2文字 <= 4
    });
  });

  describe('パターン追加', () => {
    test('addPatternで動的にパターンを追加できる', () => {
      const filter = new AizuchiFilter();
      
      expect(filter.isAizuchi('オッケー')).toBe(false);
      
      filter.addPattern('^オッケー$');
      
      expect(filter.isAizuchi('オッケー')).toBe(true);
    });
  });

  describe('統計', () => {
    test('フィルタリング回数をカウントする', () => {
      const filter = new AizuchiFilter();

      filter.isAizuchi('うん');
      filter.isAizuchi('はい');
      filter.isAizuchi('なるほど');
      filter.isAizuchi('通常のテキスト'); // これはカウントしない

      const stats = filter.getStats();
      expect(stats.filteredCount).toBe(3);
    });

    test('統計をリセットできる', () => {
      const filter = new AizuchiFilter();

      filter.isAizuchi('うん');
      filter.isAizuchi('はい');
      
      filter.resetStats();

      const stats = filter.getStats();
      expect(stats.filteredCount).toBe(0);
    });
  });
});

