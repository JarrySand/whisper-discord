/**
 * Guild APIキー管理 テスト
 *
 * テスト項目:
 * - APIキーの設定と取得
 * - APIキーのクリア
 * - 複数Guildの分離
 * - 不正なデータのハンドリング
 */
import crypto from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

// テスト用に環境変数を設定
const TEST_ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');
process.env.ENCRYPTION_KEY = TEST_ENCRYPTION_KEY;
process.env.DISCORD_BOT_TOKEN = 'test-token-for-testing';

// モック用の一時ディレクトリ
let tempDir: string;

describe('GuildApiKeysManager', () => {
  beforeAll(async () => {
    // 一時ディレクトリを作成
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'guild-api-keys-test-'));
  });

  afterAll(async () => {
    // 一時ディレクトリを削除
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('APIキーの設定と取得', () => {
    test('Groq APIキーを設定して取得できる', async () => {
      // 新しいインスタンスを作成するためにモジュールを再インポート
      jest.resetModules();

      // データパスをモック
      const originalCwd = process.cwd;
      process.cwd = () => tempDir;

      const { guildApiKeys } = await import('../../services/guild-api-keys.js');
      await guildApiKeys.initialize();

      const guildId = 'test-guild-1';
      const apiKey = 'gsk_test_api_key_12345';
      const userId = 'user-123';

      guildApiKeys.setApiKey(guildId, 'groq', apiKey, userId);

      const config = guildApiKeys.getApiKeyConfig(guildId);

      expect(config).toBeDefined();
      expect(config!.provider).toBe('groq');
      expect(config!.apiKey).toBe(apiKey);

      process.cwd = originalCwd;
    });

    test('OpenAI APIキーを設定して取得できる', async () => {
      jest.resetModules();

      const originalCwd = process.cwd;
      process.cwd = () => tempDir;

      const { guildApiKeys } = await import('../../services/guild-api-keys.js');
      await guildApiKeys.initialize();

      const guildId = 'test-guild-2';
      const apiKey = 'sk-proj-test_openai_key';
      const userId = 'user-456';

      guildApiKeys.setApiKey(guildId, 'openai', apiKey, userId);

      const config = guildApiKeys.getApiKeyConfig(guildId);

      expect(config).toBeDefined();
      expect(config!.provider).toBe('openai');
      expect(config!.apiKey).toBe(apiKey);

      process.cwd = originalCwd;
    });

    test('Self-hosted設定をURLで取得できる', async () => {
      jest.resetModules();

      const originalCwd = process.cwd;
      process.cwd = () => tempDir;

      const { guildApiKeys } = await import('../../services/guild-api-keys.js');
      await guildApiKeys.initialize();

      const guildId = 'test-guild-3';
      const userId = 'user-789';
      const selfHostedUrl = 'http://localhost:8000';

      guildApiKeys.setApiKey(guildId, 'self-hosted', undefined, userId, {
        selfHostedUrl,
      });

      const config = guildApiKeys.getApiKeyConfig(guildId);

      expect(config).toBeDefined();
      expect(config!.provider).toBe('self-hosted');
      expect(config!.selfHostedUrl).toBe(selfHostedUrl);
      expect(config!.apiKey).toBeUndefined();

      process.cwd = originalCwd;
    });

    test('モデル名を設定できる', async () => {
      jest.resetModules();

      const originalCwd = process.cwd;
      process.cwd = () => tempDir;

      const { guildApiKeys } = await import('../../services/guild-api-keys.js');
      await guildApiKeys.initialize();

      const guildId = 'test-guild-4';
      const apiKey = 'gsk_test';
      const userId = 'user-123';
      const model = 'whisper-large-v3-turbo';

      guildApiKeys.setApiKey(guildId, 'groq', apiKey, userId, { model });

      const config = guildApiKeys.getApiKeyConfig(guildId);

      expect(config).toBeDefined();
      expect(config!.model).toBe(model);

      process.cwd = originalCwd;
    });
  });

  describe('APIキーのクリア', () => {
    test('設定をクリアできる', async () => {
      jest.resetModules();

      const originalCwd = process.cwd;
      process.cwd = () => tempDir;

      const { guildApiKeys } = await import('../../services/guild-api-keys.js');
      await guildApiKeys.initialize();

      const guildId = 'test-guild-clear';

      guildApiKeys.setApiKey(guildId, 'groq', 'test-key', 'user-123');
      expect(guildApiKeys.hasApiKey(guildId)).toBe(true);

      guildApiKeys.clearApiKey(guildId);
      expect(guildApiKeys.hasApiKey(guildId)).toBe(false);
      expect(guildApiKeys.getApiKeyConfig(guildId)).toBeUndefined();

      process.cwd = originalCwd;
    });

    test('存在しないGuildをクリアしてもエラーにならない', async () => {
      jest.resetModules();

      const originalCwd = process.cwd;
      process.cwd = () => tempDir;

      const { guildApiKeys } = await import('../../services/guild-api-keys.js');
      await guildApiKeys.initialize();

      expect(() => {
        guildApiKeys.clearApiKey('non-existent-guild');
      }).not.toThrow();

      process.cwd = originalCwd;
    });
  });

  describe('複数Guildの分離', () => {
    test('異なるGuildのAPIキーは分離されている', async () => {
      jest.resetModules();

      const originalCwd = process.cwd;
      process.cwd = () => tempDir;

      const { guildApiKeys } = await import('../../services/guild-api-keys.js');
      await guildApiKeys.initialize();

      const guild1 = 'guild-isolation-1';
      const guild2 = 'guild-isolation-2';

      guildApiKeys.setApiKey(guild1, 'groq', 'key-for-guild-1', 'user-1');
      guildApiKeys.setApiKey(guild2, 'openai', 'key-for-guild-2', 'user-2');

      const config1 = guildApiKeys.getApiKeyConfig(guild1);
      const config2 = guildApiKeys.getApiKeyConfig(guild2);

      expect(config1!.provider).toBe('groq');
      expect(config1!.apiKey).toBe('key-for-guild-1');

      expect(config2!.provider).toBe('openai');
      expect(config2!.apiKey).toBe('key-for-guild-2');

      process.cwd = originalCwd;
    });

    test('一つのGuildをクリアしても他のGuildに影響しない', async () => {
      jest.resetModules();

      const originalCwd = process.cwd;
      process.cwd = () => tempDir;

      const { guildApiKeys } = await import('../../services/guild-api-keys.js');
      await guildApiKeys.initialize();

      const guild1 = 'guild-clear-test-1';
      const guild2 = 'guild-clear-test-2';

      guildApiKeys.setApiKey(guild1, 'groq', 'key-1', 'user-1');
      guildApiKeys.setApiKey(guild2, 'openai', 'key-2', 'user-2');

      guildApiKeys.clearApiKey(guild1);

      expect(guildApiKeys.hasApiKey(guild1)).toBe(false);
      expect(guildApiKeys.hasApiKey(guild2)).toBe(true);
      expect(guildApiKeys.getApiKeyConfig(guild2)!.apiKey).toBe('key-2');

      process.cwd = originalCwd;
    });
  });

  describe('メタデータ取得', () => {
    test('設定のメタデータを取得できる（APIキーなし）', async () => {
      jest.resetModules();

      const originalCwd = process.cwd;
      process.cwd = () => tempDir;

      const { guildApiKeys } = await import('../../services/guild-api-keys.js');
      await guildApiKeys.initialize();

      const guildId = 'guild-metadata-test';
      const userId = 'user-metadata';

      guildApiKeys.setApiKey(guildId, 'groq', 'secret-key', userId);

      const settings = guildApiKeys.getSettings(guildId);

      expect(settings).toBeDefined();
      expect(settings!.guildId).toBe(guildId);
      expect(settings!.provider).toBe('groq');
      expect(settings!.updatedBy).toBe(userId);
      expect(settings!.updatedAt).toBeDefined();
      // encryptedKeyが含まれていないことを確認
      expect((settings as Record<string, unknown>).encryptedKey).toBeUndefined();

      process.cwd = originalCwd;
    });
  });

  describe('hasApiKey', () => {
    test('設定されているGuildはtrue', async () => {
      jest.resetModules();

      const originalCwd = process.cwd;
      process.cwd = () => tempDir;

      const { guildApiKeys } = await import('../../services/guild-api-keys.js');
      await guildApiKeys.initialize();

      const guildId = 'guild-has-key';
      guildApiKeys.setApiKey(guildId, 'groq', 'key', 'user');

      expect(guildApiKeys.hasApiKey(guildId)).toBe(true);

      process.cwd = originalCwd;
    });

    test('設定されていないGuildはfalse', async () => {
      jest.resetModules();

      const originalCwd = process.cwd;
      process.cwd = () => tempDir;

      const { guildApiKeys } = await import('../../services/guild-api-keys.js');
      await guildApiKeys.initialize();

      expect(guildApiKeys.hasApiKey('non-existent-guild-id')).toBe(false);

      process.cwd = originalCwd;
    });
  });
});
