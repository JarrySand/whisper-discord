/**
 * SqliteStore / SqliteStoreManager テスト
 * 
 * テスト項目:
 * - セッション管理
 * - 発話の保存と検索
 * - 統計情報
 * - 古いセッションのクリーンアップ
 * - マルチギルド対応
 */
import * as fs from 'fs';
import * as path from 'path';
import { SqliteStore, SqliteStoreManager } from '../../output/sqlite-store.js';
import type { TranscriptionResult } from '../../types/index.js';

// テスト用の一時ディレクトリ
const TEST_DATA_DIR = './test-data-sqlite';

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

describe('SqliteStore', () => {
  let store: SqliteStore;
  const testDbPath = path.join(TEST_DATA_DIR, 'test.db');

  beforeEach(() => {
    // テストディレクトリ作成
    if (!fs.existsSync(TEST_DATA_DIR)) {
      fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
    }
    store = new SqliteStore(testDbPath);
  });

  afterEach(() => {
    try {
      store.close();
    } catch {
      // ignore
    }

    // テストデータベースを削除
    try {
      fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  describe('初期化', () => {
    test('データベースが作成される', () => {
      expect(fs.existsSync(testDbPath)).toBe(true);
    });

    test('テーブルが作成される', () => {
      // 新しいセッションを開始できる = テーブルが存在する
      expect(() => {
        store.startSession({
          id: 'test-session',
          guildId: 'guild-1',
          guildName: 'Test Guild',
          channelId: 'channel-1',
          channelName: 'general',
          startedAt: new Date(),
        });
      }).not.toThrow();
    });
  });

  describe('セッション管理', () => {
    test('セッションを開始できる', () => {
      store.startSession({
        id: 'session-1',
        guildId: 'guild-1',
        guildName: 'Test Guild',
        channelId: 'channel-1',
        channelName: 'general',
        startedAt: new Date(),
      });

      expect(store.getCurrentSessionId()).toBe('session-1');
    });

    test('セッションを終了できる', () => {
      store.startSession({
        id: 'session-1',
        guildId: 'guild-1',
        guildName: 'Test Guild',
        channelId: 'channel-1',
        channelName: 'general',
        startedAt: new Date(),
      });

      store.endSession(3);

      expect(store.getCurrentSessionId()).toBeNull();
    });

    test('セッションがない場合の終了は警告のみ', () => {
      expect(() => store.endSession()).not.toThrow();
    });
  });

  describe('発話保存', () => {
    beforeEach(() => {
      store.startSession({
        id: 'session-1',
        guildId: 'guild-1',
        guildName: 'Test Guild',
        channelId: 'channel-1',
        channelName: 'general',
        startedAt: new Date(),
      });
    });

    test('TranscriptionResultを保存できる', () => {
      store.saveTranscriptionResult(createMockResult({
        text: 'こんにちは',
      }));

      const results = store.getSessionUtterances('session-1');
      expect(results).toHaveLength(1);
      expect(results[0].text).toBe('こんにちは');
    });

    test('複数の発話を保存できる', () => {
      store.saveTranscriptionResult(createMockResult({ text: '1つ目' }));
      store.saveTranscriptionResult(createMockResult({ text: '2つ目' }));
      store.saveTranscriptionResult(createMockResult({ text: '3つ目' }));

      const results = store.getSessionUtterances('session-1');
      expect(results).toHaveLength(3);
    });

    test('セッションがない場合は保存しない', () => {
      store.endSession();

      expect(() => {
        store.saveTranscriptionResult(createMockResult());
      }).not.toThrow();
    });
  });

  describe('検索', () => {
    beforeEach(() => {
      store.startSession({
        id: 'session-1',
        guildId: 'guild-1',
        guildName: 'Test Guild',
        channelId: 'channel-1',
        channelName: 'general',
        startedAt: new Date(),
      });

      store.saveTranscriptionResult(createMockResult({ text: '今日の天気は晴れです' }));
      store.saveTranscriptionResult(createMockResult({ text: '明日は雨かもしれません' }));
      store.saveTranscriptionResult(createMockResult({ text: '週末は晴れるといいですね' }));
    });

    test('キーワードで検索できる', () => {
      const results = store.search({ keyword: '晴れ' });

      expect(results.length).toBe(2);
      expect(results[0].text).toContain('晴れ');
    });

    test('ユーザーIDで絞り込める', () => {
      store.saveTranscriptionResult(createMockResult({
        userId: 'user-2',
        text: '晴れですね',
      }));

      const results = store.search({
        keyword: '晴れ',
        userId: 'user-2',
      });

      expect(results.length).toBe(1);
      expect(results[0].userId).toBe('user-2');
    });

    test('セッションIDで絞り込める', () => {
      const results = store.search({
        keyword: '天気',
        sessionId: 'session-1',
      });

      expect(results.length).toBe(1);
    });

    test('結果数を制限できる', () => {
      const results = store.search({
        keyword: '',
        limit: 2,
      });

      expect(results.length).toBe(2);
    });
  });

  describe('セッション一覧', () => {
    test('セッション一覧を取得できる', () => {
      store.startSession({
        id: 'session-1',
        guildId: 'guild-1',
        guildName: 'Test Guild',
        channelId: 'channel-1',
        channelName: 'general',
        startedAt: new Date(),
      });
      store.saveTranscriptionResult(createMockResult());
      store.saveTranscriptionResult(createMockResult());
      store.endSession(2);

      const sessions = store.listSessions('guild-1');

      expect(sessions.length).toBe(1);
      expect(sessions[0].id).toBe('session-1');
      expect(sessions[0].utteranceCount).toBe(2);
      expect(sessions[0].participantCount).toBe(2);
    });

    test('結果数を制限できる', () => {
      // 複数セッションを作成
      for (let i = 0; i < 5; i++) {
        store.startSession({
          id: `session-${i}`,
          guildId: 'guild-1',
          guildName: 'Test Guild',
          channelId: 'channel-1',
          channelName: 'general',
          startedAt: new Date(),
        });
        store.endSession();
      }

      const sessions = store.listSessions('guild-1', 3);
      expect(sessions.length).toBe(3);
    });
  });

  describe('統計情報', () => {
    test('統計情報を取得できる', () => {
      store.startSession({
        id: 'session-1',
        guildId: 'guild-1',
        guildName: 'Test Guild',
        channelId: 'channel-1',
        channelName: 'general',
        startedAt: new Date(),
      });

      store.saveTranscriptionResult(createMockResult());
      store.saveTranscriptionResult(createMockResult());
      store.endSession(2);

      const stats = store.getStats();

      expect(stats.totalSessions).toBe(1);
      expect(stats.totalUtterances).toBe(2);
      expect(stats.totalParticipants).toBe(2);
    });

    test('ギルドIDで絞り込める', () => {
      store.startSession({
        id: 'session-1',
        guildId: 'guild-1',
        guildName: 'Guild 1',
        channelId: 'channel-1',
        channelName: 'general',
        startedAt: new Date(),
      });
      store.saveTranscriptionResult(createMockResult());
      store.endSession(1);

      store.startSession({
        id: 'session-2',
        guildId: 'guild-2',
        guildName: 'Guild 2',
        channelId: 'channel-1',
        channelName: 'general',
        startedAt: new Date(),
      });
      store.saveTranscriptionResult(createMockResult());
      store.saveTranscriptionResult(createMockResult());
      store.endSession(2);

      const stats1 = store.getStats('guild-1');
      expect(stats1.totalSessions).toBe(1);
      expect(stats1.totalUtterances).toBe(1);

      const stats2 = store.getStats('guild-2');
      expect(stats2.totalSessions).toBe(1);
      expect(stats2.totalUtterances).toBe(2);
    });
  });

  describe('クリーンアップ', () => {
    test('古いセッションを削除できる', () => {
      // 31日前のセッションを作成（直接SQLで）
      store.startSession({
        id: 'old-session',
        guildId: 'guild-1',
        guildName: 'Test Guild',
        channelId: 'channel-1',
        channelName: 'general',
        startedAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000),
      });
      store.saveTranscriptionResult(createMockResult());
      store.endSession();

      // 現在のセッション
      store.startSession({
        id: 'new-session',
        guildId: 'guild-1',
        guildName: 'Test Guild',
        channelId: 'channel-1',
        channelName: 'general',
        startedAt: new Date(),
      });
      store.saveTranscriptionResult(createMockResult());
      store.endSession();

      const deleted = store.cleanupOldSessions(30);

      expect(deleted).toBe(1);

      const sessions = store.listSessions('guild-1');
      expect(sessions.length).toBe(1);
      expect(sessions[0].id).toBe('new-session');
    });
  });

  describe('発話取得', () => {
    test('セッションの発話を取得できる', () => {
      store.startSession({
        id: 'session-1',
        guildId: 'guild-1',
        guildName: 'Test Guild',
        channelId: 'channel-1',
        channelName: 'general',
        startedAt: new Date(),
      });

      store.saveTranscriptionResult(createMockResult({
        displayName: 'Alice',
        text: 'こんにちは',
      }));
      store.saveTranscriptionResult(createMockResult({
        displayName: 'Bob',
        text: 'おはよう',
      }));

      const utterances = store.getSessionUtterances('session-1');

      expect(utterances.length).toBe(2);
      expect(utterances[0].displayName).toBe('Alice');
      expect(utterances[1].displayName).toBe('Bob');
    });
  });
});

describe('SqliteStoreManager', () => {
  let manager: SqliteStoreManager;

  beforeEach(() => {
    // テストディレクトリ作成
    if (!fs.existsSync(TEST_DATA_DIR)) {
      fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
    }
    manager = new SqliteStoreManager(TEST_DATA_DIR, 30);
  });

  afterEach(() => {
    try {
      manager.closeAll();
    } catch {
      // ignore
    }

    try {
      fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  describe('初期化', () => {
    test('ベースディレクトリが作成される', () => {
      expect(fs.existsSync(TEST_DATA_DIR)).toBe(true);
    });
  });

  describe('ストア取得', () => {
    test('ギルドIDでストアを取得できる', () => {
      const store = manager.getStore('123456789012345678');

      expect(store).toBeInstanceOf(SqliteStore);
    });

    test('同じギルドIDでは同じストアが返される', () => {
      const store1 = manager.getStore('123456789012345678');
      const store2 = manager.getStore('123456789012345678');

      expect(store1).toBe(store2);
    });

    test('異なるギルドIDでは異なるストアが返される', () => {
      const store1 = manager.getStore('123456789012345678');
      const store2 = manager.getStore('987654321098765432');

      expect(store1).not.toBe(store2);
    });

    test('無効なギルドIDでエラーがスローされる', () => {
      expect(() => manager.getStore('invalid-id')).toThrow('Invalid guild ID format');
    });
  });

  describe('ストア存在確認', () => {
    test('メモリ上のストアを検出する', () => {
      manager.getStore('123456789012345678');

      expect(manager.hasStore('123456789012345678')).toBe(true);
      expect(manager.hasStore('987654321098765432')).toBe(false);
    });

    test('DBファイルの存在を検出する', () => {
      const store = manager.getStore('123456789012345678');
      store.startSession({
        id: 'session-1',
        guildId: '123456789012345678',
        guildName: 'Test',
        channelId: '111111111111111111',
        channelName: 'general',
        startedAt: new Date(),
      });
      store.endSession();

      // 新しいマネージャーでファイル存在を確認
      const newManager = new SqliteStoreManager(TEST_DATA_DIR);
      expect(newManager.hasStore('123456789012345678')).toBe(true);
      newManager.closeAll();
    });
  });

  describe('データベース一覧', () => {
    test('ギルドデータベース一覧を取得できる', () => {
      const guildIds = ['111111111111111111', '222222222222222222', '333333333333333333'];
      
      manager.getStore(guildIds[0]);
      manager.getStore(guildIds[1]);
      manager.getStore(guildIds[2]);

      // DBファイルを作成するためにセッションを開始・終了
      for (const guildId of guildIds) {
        const store = manager.getStore(guildId);
        store.startSession({
          id: `session-${guildId}`,
          guildId,
          guildName: 'Test',
          channelId: '111111111111111111',
          channelName: 'general',
          startedAt: new Date(),
        });
        store.endSession();
      }

      const guilds = manager.listGuildDatabases();

      expect(guilds).toContain('111111111111111111');
      expect(guilds).toContain('222222222222222222');
      expect(guilds).toContain('333333333333333333');
    });
  });

  describe('クリーンアップ', () => {
    test('全ストアのクリーンアップを実行できる', () => {
      const store1 = manager.getStore('123456789012345678');
      store1.startSession({
        id: 'session-1',
        guildId: '123456789012345678',
        guildName: 'Test',
        channelId: '111111111111111111',
        channelName: 'general',
        startedAt: new Date(),
      });
      store1.endSession();

      // エラーなく実行できること
      expect(() => manager.cleanupAllStores()).not.toThrow();
    });
  });

  describe('全ストア閉じる', () => {
    test('全ストアを閉じられる', () => {
      manager.getStore('123456789012345678');
      manager.getStore('987654321098765432');

      expect(() => manager.closeAll()).not.toThrow();
    });
  });
});

