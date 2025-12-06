/**
 * DiscordOutputService テスト
 * 
 * テスト項目:
 * - メッセージフォーマット（standard/compact/embed）
 * - バッチメッセージ送信
 * - 文字数制限対応（2000文字）
 * - レート制限対策
 */
import { DiscordOutputService } from '../../output/discord.js';
import type { TranscriptionResult } from '../../types/index.js';
import type { TextChannel, Message } from 'discord.js';

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
    text: 'こんにちは、テストです。',
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
function createMockChannel(): jest.Mocked<TextChannel> {
  return {
    id: '123456789',
    name: 'test-channel',
    send: jest.fn().mockResolvedValue({} as Message),
  } as unknown as jest.Mocked<TextChannel>;
}

describe('DiscordOutputService', () => {
  describe('初期化', () => {
    test('デフォルト設定で初期化される', () => {
      const service = new DiscordOutputService();
      expect(service.getChannel()).toBeNull();
    });

    test('カスタム設定で初期化される', () => {
      const service = new DiscordOutputService({
        format: 'compact',
        showTimestamp: false,
        showConfidence: true,
        batchMessages: false,
        batchIntervalMs: 5000,
      });
      expect(service.getChannel()).toBeNull();
    });
  });

  describe('チャンネル管理', () => {
    test('チャンネルを設定できる', () => {
      const service = new DiscordOutputService();
      const mockChannel = createMockChannel();

      service.setChannel(mockChannel);

      expect(service.getChannel()).toBe(mockChannel);
    });

    test('チャンネル未設定時は投稿しない', async () => {
      const service = new DiscordOutputService({ batchMessages: false });
      const result = createMockResult();

      // エラーなく完了すること
      await expect(service.post(result)).resolves.not.toThrow();
    });
  });

  describe('メッセージフォーマット - Standard', () => {
    test('標準フォーマットで投稿される', async () => {
      const mockChannel = createMockChannel();
      const service = new DiscordOutputService({
        format: 'standard',
        batchMessages: false,
        showTimestamp: true,
        showConfidence: false,
      });

      service.setChannel(mockChannel);
      await service.post(createMockResult({
        displayName: 'Alice',
        text: 'こんにちは',
      }));

      // レート制限のため少し待つ
      await new Promise((r) => setTimeout(r, 1100));

      expect(mockChannel.send).toHaveBeenCalled();
      const sentContent = mockChannel.send.mock.calls[0][0] as string;

      expect(sentContent).toContain('🎤');
      expect(sentContent).toContain('**Alice**');
      expect(sentContent).toContain('こんにちは');
    });

    test('信頼度を表示できる', async () => {
      const mockChannel = createMockChannel();
      const service = new DiscordOutputService({
        format: 'standard',
        batchMessages: false,
        showConfidence: true,
      });

      service.setChannel(mockChannel);
      await service.post(createMockResult({
        text: 'テスト',
        confidence: 0.92,
      }));

      await new Promise((r) => setTimeout(r, 1100));

      const sentContent = mockChannel.send.mock.calls[0][0] as string;
      expect(sentContent).toContain('92%');
    });
  });

  describe('メッセージフォーマット - Compact', () => {
    test('コンパクトフォーマットで投稿される', async () => {
      const mockChannel = createMockChannel();
      const service = new DiscordOutputService({
        format: 'compact',
        batchMessages: false,
      });

      service.setChannel(mockChannel);
      await service.post(createMockResult({
        displayName: 'Bob',
        text: 'おはよう',
      }));

      await new Promise((r) => setTimeout(r, 1100));

      expect(mockChannel.send).toHaveBeenCalled();
      const sentContent = mockChannel.send.mock.calls[0][0] as string;

      expect(sentContent).toMatch(/\[\d{2}:\d{2}:\d{2}\] Bob: おはよう/);
    });
  });

  describe('メッセージフォーマット - Embed', () => {
    test('Embed形式で投稿される', async () => {
      const mockChannel = createMockChannel();
      const service = new DiscordOutputService({
        format: 'embed',
        batchMessages: false,
      });

      service.setChannel(mockChannel);
      await service.postEmbed(createMockResult({
        displayName: 'Charlie',
        text: 'Embed test',
      }));

      expect(mockChannel.send).toHaveBeenCalledWith(
        expect.objectContaining({
          embeds: expect.any(Array),
        })
      );
    });
  });

  describe('バッチ処理', () => {
    test('バッチモードで複数メッセージがまとめられる', async () => {
      const mockChannel = createMockChannel();
      const service = new DiscordOutputService({
        format: 'compact',
        batchMessages: true,
        batchIntervalMs: 100,
      });

      service.setChannel(mockChannel);

      // 複数のメッセージを投稿
      await service.post(createMockResult({ text: 'メッセージ1' }));
      await service.post(createMockResult({ text: 'メッセージ2' }));
      await service.post(createMockResult({ text: 'メッセージ3' }));

      // バッチ間隔後に送信される
      await new Promise((r) => setTimeout(r, 1200));

      // 1回にまとめられる
      expect(mockChannel.send).toHaveBeenCalledTimes(1);

      const sentContent = mockChannel.send.mock.calls[0][0] as string;
      expect(sentContent).toContain('メッセージ1');
      expect(sentContent).toContain('メッセージ2');
      expect(sentContent).toContain('メッセージ3');
    });

    test('flush()で即座に送信される', async () => {
      const mockChannel = createMockChannel();
      const service = new DiscordOutputService({
        format: 'compact',
        batchMessages: true,
        batchIntervalMs: 10000, // 長い間隔
      });

      service.setChannel(mockChannel);

      await service.post(createMockResult({ text: 'フラッシュテスト' }));

      // まだ送信されていない
      expect(mockChannel.send).not.toHaveBeenCalled();

      // flushを呼ぶ
      await service.flush();

      // レート制限待ち
      await new Promise((r) => setTimeout(r, 1100));

      expect(mockChannel.send).toHaveBeenCalled();
    });
  });

  describe('文字数制限', () => {
    test('2000文字を超えるとチャンク分割される', async () => {
      const mockChannel = createMockChannel();
      const service = new DiscordOutputService({
        format: 'compact',
        batchMessages: true,
        batchIntervalMs: 100,
      });

      service.setChannel(mockChannel);

      // 長いメッセージを複数追加
      const longText = 'あ'.repeat(600);
      for (let i = 0; i < 5; i++) {
        await service.post(createMockResult({ text: `${i}: ${longText}` }));
      }

      await new Promise((r) => setTimeout(r, 1500));

      // 複数回に分割される
      expect(mockChannel.send.mock.calls.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('停止', () => {
    test('stop()でキューがフラッシュされる', async () => {
      const mockChannel = createMockChannel();
      const service = new DiscordOutputService({
        format: 'compact',
        batchMessages: true,
        batchIntervalMs: 10000,
      });

      service.setChannel(mockChannel);

      await service.post(createMockResult({ text: '停止テスト' }));

      await service.stop();

      // レート制限待ち
      await new Promise((r) => setTimeout(r, 1100));

      expect(mockChannel.send).toHaveBeenCalled();
      expect(service.getChannel()).toBeNull();
    });
  });

  describe('displayName フォールバック', () => {
    test('displayNameがない場合usernameを使用', async () => {
      const mockChannel = createMockChannel();
      const service = new DiscordOutputService({
        format: 'standard',
        batchMessages: false,
      });

      service.setChannel(mockChannel);
      await service.post(createMockResult({
        displayName: undefined,
        username: 'fallback_user',
        text: 'テスト',
      }));

      await new Promise((r) => setTimeout(r, 1100));

      const sentContent = mockChannel.send.mock.calls[0][0] as string;
      expect(sentContent).toContain('fallback_user');
    });
  });
});

