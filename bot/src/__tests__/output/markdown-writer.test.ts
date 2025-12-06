/**
 * MarkdownWriterService テスト
 * 
 * テスト項目:
 * - セッション管理
 * - Markdownフォーマット生成
 * - 統計セクション
 * - セッション情報テーブル
 */
import * as fs from 'fs/promises';
import * as path from 'path';
import { MarkdownWriterService } from '../../output/markdown-writer.js';
import type { TranscriptionResult } from '../../types/index.js';

// テスト用の一時ディレクトリ
const TEST_LOG_DIR = './test-logs-markdown';

/**
 * モックのTranscriptionResultを作成
 */
function createMockResult(overrides: Partial<TranscriptionResult> = {}): TranscriptionResult {
  const now = Date.now();
  return {
    segmentId: `seg-${Math.random().toString(36).slice(2, 10)}`,
    userId: 'user-1',
    username: 'testuser',
    displayName: 'Test User',
    text: 'テストメッセージです。',
    startTs: now - 3000,
    endTs: now,
    durationMs: 3000,
    language: 'ja',
    confidence: 0.95,
    processingTimeMs: 500,
    ...overrides,
  };
}

describe('MarkdownWriterService', () => {
  let service: MarkdownWriterService;

  beforeEach(() => {
    service = new MarkdownWriterService({
      baseDir: TEST_LOG_DIR,
      includeStats: true,
      includeTimestamps: true,
    });
  });

  afterEach(async () => {
    try {
      await service.endSession();
    } catch {
      // ignore
    }

    try {
      await fs.rm(TEST_LOG_DIR, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  describe('初期化', () => {
    test('デフォルト設定で初期化される', () => {
      const defaultService = new MarkdownWriterService();
      expect(defaultService.getMdPath()).toBeNull();
    });

    test('カスタム設定で初期化される', () => {
      const customService = new MarkdownWriterService({
        baseDir: './custom-md',
        includeStats: false,
        includeTimestamps: false,
      });
      expect(customService.getMdPath()).toBeNull();
    });
  });

  describe('セッション管理', () => {
    test('セッションを開始できる', async () => {
      await service.startSession('general', 'Test Server');

      expect(service.getMdPath()).not.toBeNull();
      expect(service.getMdPath()).toContain('.md');
    });

    test('セッション開始時にディレクトリが作成される', async () => {
      await service.startSession('general', 'Test Server');

      const mdPath = service.getMdPath()!;
      const dir = path.dirname(mdPath);

      const stat = await fs.stat(dir);
      expect(stat.isDirectory()).toBe(true);
    });

    test('セッション終了時にMarkdownファイルが書き込まれる', async () => {
      await service.startSession('general', 'Test Server');
      const mdPath = service.getMdPath()!;

      await service.endSession();

      const content = await fs.readFile(mdPath, 'utf-8');
      expect(content).toContain('# 会議メモ');
    });

    test('セッション終了後はパスがnullになる', async () => {
      await service.startSession('general', 'Test Server');
      await service.endSession();

      expect(service.getMdPath()).toBeNull();
    });
  });

  describe('セグメント追加', () => {
    test('セグメントを追加できる', async () => {
      await service.startSession('general', 'Test Server');

      service.addSegment(createMockResult({
        displayName: 'Alice',
        text: 'こんにちは',
      }));

      const mdPath = service.getMdPath()!;
      await service.endSession();

      const content = await fs.readFile(mdPath, 'utf-8');
      expect(content).toContain('Alice');
      expect(content).toContain('こんにちは');
    });

    test('複数のセグメントを追加できる', async () => {
      await service.startSession('general', 'Test Server');

      service.addSegment(createMockResult({ displayName: 'Alice', text: '1つ目' }));
      service.addSegment(createMockResult({ displayName: 'Bob', text: '2つ目' }));
      service.addSegment(createMockResult({ displayName: 'Charlie', text: '3つ目' }));

      const mdPath = service.getMdPath()!;
      await service.endSession();

      const content = await fs.readFile(mdPath, 'utf-8');
      expect(content).toContain('1つ目');
      expect(content).toContain('2つ目');
      expect(content).toContain('3つ目');
    });

    test('セッションがない場合はセグメントを追加しない', () => {
      expect(() => service.addSegment(createMockResult())).not.toThrow();
    });
  });

  describe('Markdownフォーマット', () => {
    test('タイトルが日付を含む', async () => {
      await service.startSession('general', 'Test Server');
      const mdPath = service.getMdPath()!;
      await service.endSession();

      const content = await fs.readFile(mdPath, 'utf-8');
      // 日付パターン: YYYY/MM/DD
      expect(content).toMatch(/# 会議メモ - \d{4}\/\d{2}\/\d{2}/);
    });

    test('セッション情報テーブルが含まれる', async () => {
      await service.startSession('雑談', 'Discord Server');
      const mdPath = service.getMdPath()!;
      await service.endSession();

      const content = await fs.readFile(mdPath, 'utf-8');
      expect(content).toContain('## 📋 セッション情報');
      expect(content).toContain('| 項目 | 内容 |');
      expect(content).toContain('| サーバー | Discord Server |');
      expect(content).toContain('| チャンネル | 雑談 |');
    });

    test('会話ログセクションが含まれる', async () => {
      await service.startSession('general', 'Test Server');
      service.addSegment(createMockResult({ displayName: 'Alice', text: 'テスト' }));
      const mdPath = service.getMdPath()!;
      await service.endSession();

      const content = await fs.readFile(mdPath, 'utf-8');
      expect(content).toContain('## 💬 会話ログ');
    });

    test('発話がない場合はメッセージが表示される', async () => {
      await service.startSession('general', 'Test Server');
      const mdPath = service.getMdPath()!;
      await service.endSession();

      const content = await fs.readFile(mdPath, 'utf-8');
      expect(content).toContain('*発話記録がありません*');
    });
  });

  describe('タイムスタンプ設定', () => {
    test('includeTimestamps=trueで時刻が含まれる', async () => {
      const timestampService = new MarkdownWriterService({
        baseDir: TEST_LOG_DIR,
        includeTimestamps: true,
      });

      await timestampService.startSession('general', 'Test Server');
      timestampService.addSegment(createMockResult({ displayName: 'Alice', text: 'テスト' }));
      const mdPath = timestampService.getMdPath()!;
      await timestampService.endSession();

      const content = await fs.readFile(mdPath, 'utf-8');
      // HH:MM:SS - Name 形式
      expect(content).toMatch(/### \d{2}:\d{2}:\d{2} - Alice/);
    });

    test('includeTimestamps=falseで時刻が含まれない', async () => {
      const noTimestampService = new MarkdownWriterService({
        baseDir: TEST_LOG_DIR,
        includeTimestamps: false,
      });

      await noTimestampService.startSession('general', 'Test Server');
      noTimestampService.addSegment(createMockResult({ displayName: 'Alice', text: 'テスト' }));
      const mdPath = noTimestampService.getMdPath()!;
      await noTimestampService.endSession();

      const content = await fs.readFile(mdPath, 'utf-8');
      // 時刻なしで名前のみ
      expect(content).toContain('### Alice');
      expect(content).not.toMatch(/### \d{2}:\d{2}:\d{2} - Alice/);
    });
  });

  describe('統計セクション', () => {
    test('includeStats=trueで統計が含まれる', async () => {
      const statsService = new MarkdownWriterService({
        baseDir: TEST_LOG_DIR,
        includeStats: true,
      });

      await statsService.startSession('general', 'Test Server');
      statsService.addSegment(createMockResult({ confidence: 0.90, durationMs: 1000 }));
      statsService.addSegment(createMockResult({ confidence: 0.80, durationMs: 2000 }));
      const mdPath = statsService.getMdPath()!;
      await statsService.endSession();

      const content = await fs.readFile(mdPath, 'utf-8');
      expect(content).toContain('## 📊 統計');
      expect(content).toContain('| 発話数 | 2件 |');
      expect(content).toContain('| 平均信頼度 | 85% |');
    });

    test('includeStats=falseで統計が含まれない', async () => {
      const noStatsService = new MarkdownWriterService({
        baseDir: TEST_LOG_DIR,
        includeStats: false,
      });

      await noStatsService.startSession('general', 'Test Server');
      noStatsService.addSegment(createMockResult());
      const mdPath = noStatsService.getMdPath()!;
      await noStatsService.endSession();

      const content = await fs.readFile(mdPath, 'utf-8');
      expect(content).not.toContain('## 📊 統計');
    });
  });

  describe('参加者情報', () => {
    test('参加者がセッション情報に記録される', async () => {
      await service.startSession('general', 'Test Server');
      service.addSegment(createMockResult({ displayName: 'Alice' }));
      service.addSegment(createMockResult({ displayName: 'Bob' }));
      service.addSegment(createMockResult({ displayName: 'Alice' })); // 重複
      const mdPath = service.getMdPath()!;
      await service.endSession();

      const content = await fs.readFile(mdPath, 'utf-8');
      expect(content).toContain('| 参加者 | Alice, Bob |');
    });

    test('参加者がいない場合は「なし」と表示される', async () => {
      await service.startSession('general', 'Test Server');
      const mdPath = service.getMdPath()!;
      await service.endSession();

      const content = await fs.readFile(mdPath, 'utf-8');
      expect(content).toContain('| 参加者 | なし |');
    });
  });

  describe('displayNameフォールバック', () => {
    test('displayNameがない場合はusernameを使用', async () => {
      await service.startSession('general', 'Test Server');
      service.addSegment(createMockResult({
        displayName: undefined,
        username: 'testuser123',
        text: 'テスト',
      }));
      const mdPath = service.getMdPath()!;
      await service.endSession();

      const content = await fs.readFile(mdPath, 'utf-8');
      expect(content).toContain('testuser123');
    });
  });

  describe('時間フォーマット', () => {
    test('セッション時間がH:MM:SS形式で表示される', async () => {
      await service.startSession('general', 'Test Server');
      service.addSegment(createMockResult({ durationMs: 60000 })); // 1分
      const mdPath = service.getMdPath()!;
      await service.endSession();

      const content = await fs.readFile(mdPath, 'utf-8');
      // セッション時間と総発話時間
      expect(content).toMatch(/\d+:\d{2}:\d{2}/);
    });
  });

  describe('信頼度計算', () => {
    test('平均信頼度が正しく計算される', async () => {
      await service.startSession('general', 'Test Server');
      service.addSegment(createMockResult({ confidence: 1.00 }));
      service.addSegment(createMockResult({ confidence: 0.50 }));
      const mdPath = service.getMdPath()!;
      await service.endSession();

      const content = await fs.readFile(mdPath, 'utf-8');
      expect(content).toContain('| 平均信頼度 | 75% |');
    });

    test('発話がない場合は信頼度0%', async () => {
      await service.startSession('general', 'Test Server');
      const mdPath = service.getMdPath()!;
      await service.endSession();

      const content = await fs.readFile(mdPath, 'utf-8');
      expect(content).toContain('| 平均信頼度 | 0% |');
    });
  });

  describe('参加者数', () => {
    test('参加者数が統計に含まれる', async () => {
      await service.startSession('general', 'Test Server');
      // displayNameで参加者を識別するため、異なるdisplayNameを使用
      service.addSegment(createMockResult({ userId: 'user-1', displayName: 'Alice' }));
      service.addSegment(createMockResult({ userId: 'user-2', displayName: 'Bob' }));
      service.addSegment(createMockResult({ userId: 'user-3', displayName: 'Charlie' }));
      const mdPath = service.getMdPath()!;
      await service.endSession();

      const content = await fs.readFile(mdPath, 'utf-8');
      expect(content).toContain('| 参加者数 | 3人 |');
    });
  });
});

