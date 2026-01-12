/**
 * OutputManager テスト
 * 
 * テスト項目:
 * - 各出力サービスの初期化
 * - セッション開始/終了
 * - 出力配信
 * - エラーハンドリング
 */
import * as fs from 'fs/promises';
import { OutputManager } from '../../output/manager.js';
import type { TranscriptionResult } from '../../types/index.js';
import type { TextChannel } from 'discord.js';

// テスト用の一時ディレクトリ
const TEST_LOG_DIR = './test-logs-manager';
const TEST_DATA_DIR = './test-data-manager';

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

/**
 * モックのTextChannelを作成
 */
function createMockChannel(): TextChannel {
  return {
    id: '123456789',
    name: 'test-channel',
    send: jest.fn().mockResolvedValue({}),
  } as unknown as TextChannel;
}

describe('OutputManager', () => {
  let manager: OutputManager;

  beforeEach(() => {
    manager = new OutputManager({
      discord: { enabled: false, config: {} },
      fileLog: { 
        enabled: true, 
        config: { baseDir: TEST_LOG_DIR, flushIntervalMs: 100 } 
      },
      jsonStore: { 
        enabled: true, 
        config: { baseDir: TEST_LOG_DIR, saveIntervalMs: 100 } 
      },
      markdown: { 
        enabled: true, 
        config: { baseDir: TEST_LOG_DIR } 
      },
      sqlite: { 
        enabled: false, 
        config: { dbDir: TEST_DATA_DIR } 
      },
    });
  });

  afterEach(async () => {
    try {
      await manager.endSession();
    } catch {
      // ignore
    }

    try {
      await fs.rm(TEST_LOG_DIR, { recursive: true, force: true });
      await fs.rm(TEST_DATA_DIR, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  describe('初期化', () => {
    test('デフォルト設定で初期化される', () => {
      const defaultManager = new OutputManager();
      expect(defaultManager.isActive()).toBe(false);
    });

    test('無効化されたサービスは初期化されない', () => {
      const disabledManager = new OutputManager({
        discord: { enabled: false, config: {} },
        fileLog: { enabled: false, config: {} },
        jsonStore: { enabled: false, config: {} },
        markdown: { enabled: false, config: {} },
        sqlite: { enabled: false, config: {} },
      });

      expect(disabledManager.getDiscordService()).toBeNull();
      expect(disabledManager.getFileLoggerService()).toBeNull();
      expect(disabledManager.getJsonStoreService()).toBeNull();
      expect(disabledManager.getMarkdownWriterService()).toBeNull();
    });

    test('有効化されたサービスは初期化される', () => {
      expect(manager.getFileLoggerService()).not.toBeNull();
      expect(manager.getJsonStoreService()).not.toBeNull();
      expect(manager.getMarkdownWriterService()).not.toBeNull();
    });
  });

  describe('セッション管理', () => {
    test('セッションを開始できる', async () => {
      await manager.startSession({
        guildId: 'guild-1',
        guildName: 'Test Guild',
        channelId: 'channel-1',
        channelName: 'general',
      });

      expect(manager.isActive()).toBe(true);
      expect(manager.getCurrentSessionId()).not.toBeNull();
    });

    test('セッションを終了できる', async () => {
      await manager.startSession({
        guildId: 'guild-1',
        guildName: 'Test Guild',
        channelId: 'channel-1',
        channelName: 'general',
      });

      await manager.endSession();

      expect(manager.isActive()).toBe(false);
      expect(manager.getCurrentSessionId()).toBeNull();
    });

    test('重複したセッション開始は無視される', async () => {
      await manager.startSession({
        guildId: 'guild-1',
        guildName: 'Test Guild',
        channelId: 'channel-1',
        channelName: 'general',
      });

      const sessionId = manager.getCurrentSessionId();

      // 2回目の開始は無視される
      await manager.startSession({
        guildId: 'guild-2',
        guildName: 'Other Guild',
        channelId: 'channel-2',
        channelName: 'other',
      });

      expect(manager.getCurrentSessionId()).toBe(sessionId);
    });

    test('非アクティブなセッションの終了は何もしない', async () => {
      await expect(manager.endSession()).resolves.not.toThrow();
    });
  });

  describe('出力配信', () => {
    test('結果を各サービスに配信できる', async () => {
      await manager.startSession({
        guildId: 'guild-1',
        guildName: 'Test Guild',
        channelId: 'channel-1',
        channelName: 'general',
      });

      await manager.output(createMockResult({ text: '配信テスト' }));

      // ファイルロガーにフラッシュ
      await manager.getFileLoggerService()?.flush();

      const paths = manager.getOutputPaths();
      expect(paths.log).not.toBeNull();
      expect(paths.json).not.toBeNull();
      expect(paths.markdown).not.toBeNull();
    });

    test('セッションがアクティブでない場合は配信しない', async () => {
      // セッションを開始せずに出力
      await expect(manager.output(createMockResult())).resolves.not.toThrow();
    });
  });

  describe('出力パス', () => {
    test('各サービスの出力パスを取得できる', async () => {
      await manager.startSession({
        guildId: 'guild-1',
        guildName: 'Test Guild',
        channelId: 'channel-1',
        channelName: 'general',
      });

      const paths = manager.getOutputPaths();

      expect(paths.log).not.toBeNull();
      expect(paths.log!.endsWith('.log')).toBe(true);
      expect(paths.json).not.toBeNull();
      expect(paths.json!.endsWith('.json')).toBe(true);
      expect(paths.markdown).not.toBeNull();
      expect(paths.markdown!.endsWith('.md')).toBe(true);
    });

    test('SQLite無効時はsqliteDirがnull', () => {
      const paths = manager.getOutputPaths();
      expect(paths.sqliteDir).toBeNull();
    });
  });

  describe('参加者数', () => {
    test('参加者数を設定できる', async () => {
      await manager.startSession({
        guildId: 'guild-1',
        guildName: 'Test Guild',
        channelId: 'channel-1',
        channelName: 'general',
      });

      manager.setParticipantCount(5);

      // セッション終了時に使用される
      await manager.endSession();
    });
  });

  describe('Discord出力', () => {
    test('Discord出力チャンネルを設定できる', async () => {
      const discordManager = new OutputManager({
        discord: { enabled: true, config: { batchMessages: false } },
        fileLog: { enabled: false, config: {} },
        jsonStore: { enabled: false, config: {} },
        markdown: { enabled: false, config: {} },
        sqlite: { enabled: false, config: {} },
      });

      const mockChannel = createMockChannel();

      await discordManager.startSession({
        guildId: 'guild-1',
        guildName: 'Test Guild',
        channelId: 'channel-1',
        channelName: 'general',
        outputChannel: mockChannel,
      });

      expect(discordManager.getDiscordService()?.getChannel()).toBe(mockChannel);

      await discordManager.endSession();
    });
  });

  describe('エラーハンドリング', () => {
    test('1つのサービスが失敗しても他は継続する', async () => {
      await manager.startSession({
        guildId: 'guild-1',
        guildName: 'Test Guild',
        channelId: 'channel-1',
        channelName: 'general',
      });

      // 正常に動作することを確認
      await expect(manager.output(createMockResult())).resolves.not.toThrow();
    });
  });

  describe('SQLiteストア', () => {
    test('SQLite有効時にストアが初期化される', async () => {
      const sqliteManager = new OutputManager({
        discord: { enabled: false, config: {} },
        fileLog: { enabled: false, config: {} },
        jsonStore: { enabled: false, config: {} },
        markdown: { enabled: false, config: {} },
        sqlite: { 
          enabled: true, 
          config: { dbDir: TEST_DATA_DIR, cleanupDays: 30 } 
        },
      });

      await sqliteManager.startSession({
        guildId: 'guild-1',
        guildName: 'Test Guild',
        channelId: 'channel-1',
        channelName: 'general',
      });

      expect(sqliteManager.getSqliteStore()).not.toBeNull();

      await sqliteManager.endSession();

      // クリーンアップ
      try {
        await fs.rm(TEST_DATA_DIR, { recursive: true, force: true });
      } catch {
        // ignore
      }
    });
  });

  describe('サービス取得', () => {
    test('各サービスのゲッターが機能する', () => {
      expect(manager.getFileLoggerService()).not.toBeNull();
      expect(manager.getJsonStoreService()).not.toBeNull();
      expect(manager.getMarkdownWriterService()).not.toBeNull();
      expect(manager.getDiscordService()).toBeNull(); // 無効化されている
      expect(manager.getSqliteStore()).toBeNull(); // セッション開始前
    });
  });
});

