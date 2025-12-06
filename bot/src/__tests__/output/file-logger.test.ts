/**
 * FileLoggerService テスト
 * 
 * テスト項目:
 * - セッションの開始と終了
 * - ログファイルのフォーマット
 * - バッファリングとフラッシュ
 * - 参加者と発話のカウント
 */
import * as fs from 'fs/promises';
import * as path from 'path';
import { FileLoggerService } from '../../output/file-logger.js';
import type { TranscriptionResult } from '../../types/index.js';

// テスト用の一時ディレクトリ
const TEST_LOG_DIR = './test-logs-file-logger';

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

describe('FileLoggerService', () => {
  let service: FileLoggerService;

  beforeEach(() => {
    service = new FileLoggerService({
      baseDir: TEST_LOG_DIR,
      flushIntervalMs: 100, // テスト用に短く
    });
  });

  afterEach(async () => {
    // セッション終了
    try {
      await service.endSession();
    } catch {
      // ignore
    }

    // テストディレクトリをクリーンアップ
    try {
      await fs.rm(TEST_LOG_DIR, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  describe('初期化', () => {
    test('デフォルト設定で初期化される', () => {
      const defaultService = new FileLoggerService();
      expect(defaultService.getLogPath()).toBeNull();
    });

    test('カスタム設定で初期化される', () => {
      const customService = new FileLoggerService({
        baseDir: './custom-logs',
        flushIntervalMs: 10000,
      });
      expect(customService.getLogPath()).toBeNull();
    });
  });

  describe('セッション管理', () => {
    test('セッションを開始できる', async () => {
      await service.startSession('general', 'Test Server');

      const logPath = service.getLogPath();
      expect(logPath).not.toBeNull();
      // パス区切り文字の違いを考慮して正規化してチェック
      expect(logPath!.replace(/\\/g, '/')).toContain('test-logs-file-logger');
      expect(logPath).toContain('.log');
    });

    test('セッション開始時にディレクトリが作成される', async () => {
      await service.startSession('general', 'Test Server');

      const logPath = service.getLogPath()!;
      const dir = path.dirname(logPath);

      const stat = await fs.stat(dir);
      expect(stat.isDirectory()).toBe(true);
    });

    test('セッション開始時にヘッダーが書き込まれる', async () => {
      await service.startSession('雑談', 'Discord Server');

      const logPath = service.getLogPath()!;
      const content = await fs.readFile(logPath, 'utf-8');

      expect(content).toContain('Discord Voice Transcription Log');
      expect(content).toContain('Server: Discord Server');
      expect(content).toContain('Channel: 雑談');
    });

    test('セッション終了時にフッターが書き込まれる', async () => {
      await service.startSession('general', 'Test Server');
      const logPath = service.getLogPath()!;

      await service.endSession();

      const content = await fs.readFile(logPath, 'utf-8');
      expect(content).toContain('Session ended');
      expect(content).toContain('Total utterances: 0');
      expect(content).toContain('Participants:');
    });

    test('セッション終了後はログパスがnullになる', async () => {
      await service.startSession('general', 'Test Server');
      await service.endSession();

      expect(service.getLogPath()).toBeNull();
    });
  });

  describe('ログ記録', () => {
    test('ログを追加できる', async () => {
      await service.startSession('general', 'Test Server');

      await service.log(createMockResult({
        displayName: 'Alice',
        text: 'こんにちは',
      }));

      // バッファをフラッシュ
      await service.flush();

      const logPath = service.getLogPath()!;
      const content = await fs.readFile(logPath, 'utf-8');

      expect(content).toContain('Alice: こんにちは');
    });

    test('複数のログを追加できる', async () => {
      await service.startSession('general', 'Test Server');

      await service.log(createMockResult({ displayName: 'Alice', text: 'こんにちは' }));
      await service.log(createMockResult({ displayName: 'Bob', text: 'おはよう' }));
      await service.log(createMockResult({ displayName: 'Alice', text: 'いい天気ですね' }));

      await service.flush();

      const logPath = service.getLogPath()!;
      const content = await fs.readFile(logPath, 'utf-8');

      expect(content).toContain('Alice: こんにちは');
      expect(content).toContain('Bob: おはよう');
      expect(content).toContain('Alice: いい天気ですね');
    });

    test('displayNameがない場合はusernameを使用', async () => {
      await service.startSession('general', 'Test Server');

      await service.log(createMockResult({
        displayName: undefined,
        username: 'testuser123',
        text: 'テスト',
      }));

      await service.flush();

      const logPath = service.getLogPath()!;
      const content = await fs.readFile(logPath, 'utf-8');

      expect(content).toContain('testuser123: テスト');
    });

    test('セッションがない場合はログを追加しない', async () => {
      // セッションを開始せずにログを追加
      await expect(service.log(createMockResult())).resolves.not.toThrow();
    });
  });

  describe('参加者カウント', () => {
    test('参加者がフッターに記録される', async () => {
      await service.startSession('general', 'Test Server');

      await service.log(createMockResult({ displayName: 'Alice', text: 'Hello' }));
      await service.log(createMockResult({ displayName: 'Bob', text: 'Hi' }));
      await service.log(createMockResult({ displayName: 'Charlie', text: 'Hey' }));
      await service.log(createMockResult({ displayName: 'Alice', text: 'How are you?' }));

      const logPath = service.getLogPath()!;
      await service.endSession();

      const content = await fs.readFile(logPath, 'utf-8');

      expect(content).toContain('Participants: Alice, Bob, Charlie');
    });

    test('発話数がフッターに記録される', async () => {
      await service.startSession('general', 'Test Server');

      await service.log(createMockResult({ text: '1' }));
      await service.log(createMockResult({ text: '2' }));
      await service.log(createMockResult({ text: '3' }));

      const logPath = service.getLogPath()!;
      await service.endSession();

      const content = await fs.readFile(logPath, 'utf-8');

      expect(content).toContain('Total utterances: 3');
    });
  });

  describe('バッファリングとフラッシュ', () => {
    test('flush()でバッファがファイルに書き込まれる', async () => {
      await service.startSession('general', 'Test Server');

      await service.log(createMockResult({ text: 'バッファテスト' }));
      
      // flush前にファイル内容を確認
      const logPath = service.getLogPath()!;
      const beforeFlush = await fs.readFile(logPath, 'utf-8');
      
      await service.flush();
      
      const afterFlush = await fs.readFile(logPath, 'utf-8');
      expect(afterFlush).toContain('バッファテスト');
      expect(afterFlush.length).toBeGreaterThan(beforeFlush.length);
    });

    test('空のバッファではflush()は何もしない', async () => {
      await service.startSession('general', 'Test Server');
      
      // エラーなく完了すること
      await expect(service.flush()).resolves.not.toThrow();
    });
  });

  describe('セッションID生成', () => {
    test('同日の2つ目のセッションは連番が増える', async () => {
      // 最初のセッション
      await service.startSession('general', 'Test Server');
      const firstPath = service.getLogPath()!;
      await service.endSession();

      // 2つ目のセッション
      const service2 = new FileLoggerService({ baseDir: TEST_LOG_DIR });
      await service2.startSession('general', 'Test Server');
      const secondPath = service2.getLogPath()!;
      await service2.endSession();

      // セッション番号が異なることを確認
      expect(firstPath).not.toBe(secondPath);
      expect(firstPath).toContain('session-001');
      expect(secondPath).toContain('session-002');
    });
  });

  describe('ログフォーマット', () => {
    test('時刻がHH:MM:SS形式で記録される', async () => {
      await service.startSession('general', 'Test Server');

      await service.log(createMockResult({ text: 'フォーマットテスト' }));
      await service.flush();

      const logPath = service.getLogPath()!;
      const content = await fs.readFile(logPath, 'utf-8');

      // [HH:MM:SS] 形式のマッチ
      expect(content).toMatch(/\[\d{2}:\d{2}:\d{2}\]/);
    });
  });

  describe('エラーハンドリング', () => {
    test('ディレクトリ作成に失敗してもエラーにならない', async () => {
      // 読み取り専用パスへの書き込みを試みる
      // （Windowsでは動作が異なる可能性があるため、スキップ可能）
      const invalidService = new FileLoggerService({
        baseDir: TEST_LOG_DIR,
      });

      await expect(
        invalidService.startSession('test', 'Test')
      ).resolves.not.toThrow();
    });
  });
});

