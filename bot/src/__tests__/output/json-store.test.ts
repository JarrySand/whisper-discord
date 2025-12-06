/**
 * JsonStoreService テスト
 * 
 * テスト項目:
 * - セッション管理
 * - セグメント追加と参加者情報
 * - 統計計算
 * - JSONファイル出力
 */
import * as fs from 'fs/promises';
import * as path from 'path';
import { JsonStoreService } from '../../output/json-store.js';
import type { TranscriptionResult, TranscriptionSessionJson } from '../../types/index.js';

// テスト用の一時ディレクトリ
const TEST_LOG_DIR = './test-logs-json-store';

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

describe('JsonStoreService', () => {
  let service: JsonStoreService;

  beforeEach(() => {
    service = new JsonStoreService({
      baseDir: TEST_LOG_DIR,
      saveIntervalMs: 100,
      prettyPrint: true,
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
      const defaultService = new JsonStoreService();
      expect(defaultService.getJsonPath()).toBeNull();
      expect(defaultService.getSessionData()).toBeNull();
    });

    test('カスタム設定で初期化される', () => {
      const customService = new JsonStoreService({
        baseDir: './custom-json',
        saveIntervalMs: 5000,
        prettyPrint: false,
      });
      expect(customService.getJsonPath()).toBeNull();
    });
  });

  describe('セッション管理', () => {
    test('セッションを開始できる', async () => {
      await service.startSession('guild-1', 'Test Guild', 'channel-1', 'general');

      const jsonPath = service.getJsonPath();
      expect(jsonPath).not.toBeNull();
      expect(jsonPath).toContain('.json');
    });

    test('セッション開始時にディレクトリが作成される', async () => {
      await service.startSession('guild-1', 'Test Guild', 'channel-1', 'general');

      const jsonPath = service.getJsonPath()!;
      const dir = path.dirname(jsonPath);

      const stat = await fs.stat(dir);
      expect(stat.isDirectory()).toBe(true);
    });

    test('セッションデータが正しく初期化される', async () => {
      await service.startSession('guild-1', 'Test Guild', 'channel-1', 'general');

      const data = service.getSessionData();
      expect(data).not.toBeNull();
      expect(data!.version).toBe('1.0.0');
      expect(data!.guild_id).toBe('guild-1');
      expect(data!.guild_name).toBe('Test Guild');
      expect(data!.channel_id).toBe('channel-1');
      expect(data!.channel_name).toBe('general');
      expect(data!.segments).toEqual([]);
      expect(data!.participants).toEqual([]);
    });

    test('セッション終了時にファイルが保存される', async () => {
      await service.startSession('guild-1', 'Test Guild', 'channel-1', 'general');
      const jsonPath = service.getJsonPath()!;

      await service.endSession();

      const content = await fs.readFile(jsonPath, 'utf-8');
      const data = JSON.parse(content) as TranscriptionSessionJson;

      expect(data.session_end).not.toBe('');
      expect(data.duration_ms).toBeGreaterThanOrEqual(0);
    });

    test('セッション終了後はパスとデータがnullになる', async () => {
      await service.startSession('guild-1', 'Test Guild', 'channel-1', 'general');
      await service.endSession();

      expect(service.getJsonPath()).toBeNull();
      expect(service.getSessionData()).toBeNull();
    });
  });

  describe('セグメント追加', () => {
    test('セグメントを追加できる', async () => {
      await service.startSession('guild-1', 'Test Guild', 'channel-1', 'general');

      await service.addSegment(createMockResult({
        userId: 'user-1',
        displayName: 'Alice',
        text: 'こんにちは',
      }));

      const data = service.getSessionData()!;
      expect(data.segments).toHaveLength(1);
      expect(data.segments[0].text).toBe('こんにちは');
      expect(data.segments[0].display_name).toBe('Alice');
    });

    test('複数のセグメントを追加できる', async () => {
      await service.startSession('guild-1', 'Test Guild', 'channel-1', 'general');

      await service.addSegment(createMockResult({ text: '1つ目' }));
      await service.addSegment(createMockResult({ text: '2つ目' }));
      await service.addSegment(createMockResult({ text: '3つ目' }));

      const data = service.getSessionData()!;
      expect(data.segments).toHaveLength(3);
    });

    test('セッションがない場合はセグメントを追加しない', async () => {
      await expect(service.addSegment(createMockResult())).resolves.not.toThrow();
    });
  });

  describe('参加者情報', () => {
    test('参加者が自動的に追加される', async () => {
      await service.startSession('guild-1', 'Test Guild', 'channel-1', 'general');

      await service.addSegment(createMockResult({
        userId: 'user-1',
        username: 'alice',
        displayName: 'Alice',
      }));

      const data = service.getSessionData()!;
      expect(data.participants).toHaveLength(1);
      expect(data.participants[0].user_id).toBe('user-1');
      expect(data.participants[0].display_name).toBe('Alice');
    });

    test('同じ参加者の発話数がカウントされる', async () => {
      await service.startSession('guild-1', 'Test Guild', 'channel-1', 'general');

      await service.addSegment(createMockResult({ userId: 'user-1', durationMs: 1000 }));
      await service.addSegment(createMockResult({ userId: 'user-1', durationMs: 2000 }));
      await service.addSegment(createMockResult({ userId: 'user-1', durationMs: 3000 }));

      const data = service.getSessionData()!;
      expect(data.participants).toHaveLength(1);
      expect(data.participants[0].utterance_count).toBe(3);
      expect(data.participants[0].total_speaking_time_ms).toBe(6000);
    });

    test('複数の参加者が記録される', async () => {
      await service.startSession('guild-1', 'Test Guild', 'channel-1', 'general');

      await service.addSegment(createMockResult({ userId: 'user-1', displayName: 'Alice' }));
      await service.addSegment(createMockResult({ userId: 'user-2', displayName: 'Bob' }));
      await service.addSegment(createMockResult({ userId: 'user-3', displayName: 'Charlie' }));

      const data = service.getSessionData()!;
      expect(data.participants).toHaveLength(3);
    });
  });

  describe('統計計算', () => {
    test('セグメント数がカウントされる', async () => {
      await service.startSession('guild-1', 'Test Guild', 'channel-1', 'general');

      await service.addSegment(createMockResult());
      await service.addSegment(createMockResult());

      const data = service.getSessionData()!;
      expect(data.stats.total_segments).toBe(2);
    });

    test('総時間が計算される', async () => {
      await service.startSession('guild-1', 'Test Guild', 'channel-1', 'general');

      await service.addSegment(createMockResult({ durationMs: 1000 }));
      await service.addSegment(createMockResult({ durationMs: 2000 }));
      await service.addSegment(createMockResult({ durationMs: 3000 }));

      const data = service.getSessionData()!;
      expect(data.stats.total_duration_ms).toBe(6000);
    });

    test('平均信頼度が計算される', async () => {
      await service.startSession('guild-1', 'Test Guild', 'channel-1', 'general');

      await service.addSegment(createMockResult({ confidence: 0.90 }));
      await service.addSegment(createMockResult({ confidence: 0.80 }));
      await service.addSegment(createMockResult({ confidence: 0.70 }));

      const data = service.getSessionData()!;
      expect(data.stats.avg_confidence).toBeCloseTo(0.8, 2);
    });

    test('セッション終了時に最終統計が計算される', async () => {
      await service.startSession('guild-1', 'Test Guild', 'channel-1', 'general');

      await service.addSegment(createMockResult({ userId: 'user-1', text: 'あああ', durationMs: 1000 }));
      await service.addSegment(createMockResult({ userId: 'user-2', text: 'いいいい', durationMs: 2000 }));

      const jsonPath = service.getJsonPath()!;
      await service.endSession();

      const content = await fs.readFile(jsonPath, 'utf-8');
      const data = JSON.parse(content) as TranscriptionSessionJson;

      expect(data.stats.participant_count).toBe(2);
      expect(data.stats.avg_segment_duration_ms).toBe(1500);
      expect(data.stats.words_per_minute).toBeGreaterThan(0);
    });
  });

  describe('ファイル保存', () => {
    test('prettyPrint=trueで整形されたJSONが保存される', async () => {
      const prettyService = new JsonStoreService({
        baseDir: TEST_LOG_DIR,
        prettyPrint: true,
      });

      await prettyService.startSession('guild-1', 'Test Guild', 'channel-1', 'general');
      await prettyService.save();

      const jsonPath = prettyService.getJsonPath()!;
      const content = await fs.readFile(jsonPath, 'utf-8');

      expect(content).toContain('\n'); // 改行が含まれる
      expect(content).toContain('  '); // インデントが含まれる

      await prettyService.endSession();
    });

    test('prettyPrint=falseで圧縮されたJSONが保存される', async () => {
      const compactService = new JsonStoreService({
        baseDir: TEST_LOG_DIR,
        prettyPrint: false,
      });

      await compactService.startSession('guild-1', 'Test Guild', 'channel-1', 'general');
      await compactService.save();

      const jsonPath = compactService.getJsonPath()!;
      const content = await fs.readFile(jsonPath, 'utf-8');

      // 1行で保存される
      const lines = content.split('\n').filter(line => line.trim());
      expect(lines).toHaveLength(1);

      await compactService.endSession();
    });
  });

  describe('セッションID', () => {
    test('セッションIDが一意に生成される', async () => {
      await service.startSession('guild-1', 'Test Guild', 'channel-1', 'general');
      const data1 = service.getSessionData()!;
      const sessionId1 = data1.session_id;
      await service.endSession();

      const service2 = new JsonStoreService({ baseDir: TEST_LOG_DIR });
      await service2.startSession('guild-1', 'Test Guild', 'channel-1', 'general');
      const data2 = service2.getSessionData()!;
      const sessionId2 = data2.session_id;
      await service2.endSession();

      expect(sessionId1).not.toBe(sessionId2);
    });
  });

  describe('言語情報', () => {
    test('言語がセグメントに記録される', async () => {
      await service.startSession('guild-1', 'Test Guild', 'channel-1', 'general');

      await service.addSegment(createMockResult({ language: 'en' }));

      const data = service.getSessionData()!;
      expect(data.segments[0].language).toBe('en');
    });

    test('言語がない場合はデフォルトでjaが使用される', async () => {
      await service.startSession('guild-1', 'Test Guild', 'channel-1', 'general');

      await service.addSegment(createMockResult({ language: undefined }));

      const data = service.getSessionData()!;
      expect(data.segments[0].language).toBe('ja');
    });
  });
});

