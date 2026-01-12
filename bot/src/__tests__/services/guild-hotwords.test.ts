/**
 * Guild ホットワード管理 テスト
 *
 * テスト項目:
 * - ホットワードの追加と取得
 * - ホットワードの削除
 * - デフォルトとのマージ
 * - 複数Guildの分離
 * - バリデーション
 */
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

// テスト用環境変数
process.env.DISCORD_BOT_TOKEN = 'test-token-for-testing';

// モック用の一時ディレクトリ
let tempDir: string;

describe('GuildHotwordsManager', () => {
  beforeAll(async () => {
    // 一時ディレクトリを作成
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'guild-hotwords-test-'));

    // デフォルトホットワードファイルを作成
    const configDir = path.join(tempDir, 'config');
    await fs.mkdir(configDir, { recursive: true });
    await fs.writeFile(
      path.join(configDir, 'hotwords.json'),
      JSON.stringify({
        hotwords: ['DAO', 'NFT', 'Ethereum'],
        description: 'Test default hotwords',
      })
    );
  });

  afterAll(async () => {
    // 一時ディレクトリを削除
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('ホットワードの追加と取得', () => {
    test('ホットワードを追加して取得できる', async () => {
      jest.resetModules();

      const originalCwd = process.cwd;
      process.cwd = () => tempDir;

      const { guildHotwords } = await import('../../services/guild-hotwords.js');
      await guildHotwords.initialize();

      const guildId = 'test-guild-1';
      const word = 'カスタム用語';
      const userId = 'user-123';

      const result = guildHotwords.addHotword(guildId, word, userId);

      expect(result.success).toBe(true);

      const hotwords = guildHotwords.getHotwords(guildId);
      expect(hotwords).toContain(word);

      process.cwd = originalCwd;
    });

    test('複数のホットワードを追加できる', async () => {
      jest.resetModules();

      const originalCwd = process.cwd;
      process.cwd = () => tempDir;

      const { guildHotwords } = await import('../../services/guild-hotwords.js');
      await guildHotwords.initialize();

      const guildId = 'test-guild-multi';
      const userId = 'user-123';

      guildHotwords.addHotword(guildId, '用語1', userId);
      guildHotwords.addHotword(guildId, '用語2', userId);
      guildHotwords.addHotword(guildId, '用語3', userId);

      const hotwords = guildHotwords.getHotwords(guildId);
      expect(hotwords).toHaveLength(3);
      expect(hotwords).toContain('用語1');
      expect(hotwords).toContain('用語2');
      expect(hotwords).toContain('用語3');

      process.cwd = originalCwd;
    });

    test('空文字は追加できない', async () => {
      jest.resetModules();

      const originalCwd = process.cwd;
      process.cwd = () => tempDir;

      const { guildHotwords } = await import('../../services/guild-hotwords.js');
      await guildHotwords.initialize();

      const guildId = 'test-guild-empty';
      const result = guildHotwords.addHotword(guildId, '   ', 'user-123');

      expect(result.success).toBe(false);
      expect(result.error).toContain('空');

      process.cwd = originalCwd;
    });

    test('重複は追加できない', async () => {
      jest.resetModules();

      const originalCwd = process.cwd;
      process.cwd = () => tempDir;

      const { guildHotwords } = await import('../../services/guild-hotwords.js');
      await guildHotwords.initialize();

      const guildId = 'test-guild-dup';
      const word = '重複テスト';
      const userId = 'user-123';

      const result1 = guildHotwords.addHotword(guildId, word, userId);
      const result2 = guildHotwords.addHotword(guildId, word, userId);

      expect(result1.success).toBe(true);
      expect(result2.success).toBe(false);
      expect(result2.error).toContain('すでに登録');

      process.cwd = originalCwd;
    });

    test('デフォルトに含まれる用語は追加できない', async () => {
      jest.resetModules();

      const originalCwd = process.cwd;
      process.cwd = () => tempDir;

      const { guildHotwords } = await import('../../services/guild-hotwords.js');
      await guildHotwords.initialize();

      const guildId = 'test-guild-default';
      const result = guildHotwords.addHotword(guildId, 'DAO', 'user-123');

      expect(result.success).toBe(false);
      expect(result.error).toContain('デフォルト');

      process.cwd = originalCwd;
    });

    test('長すぎるホットワードは追加できない', async () => {
      jest.resetModules();

      const originalCwd = process.cwd;
      process.cwd = () => tempDir;

      const { guildHotwords } = await import('../../services/guild-hotwords.js');
      await guildHotwords.initialize();

      const guildId = 'test-guild-long';
      const longWord = 'あ'.repeat(100);
      const result = guildHotwords.addHotword(guildId, longWord, 'user-123');

      expect(result.success).toBe(false);
      expect(result.error).toContain('文字以内');

      process.cwd = originalCwd;
    });
  });

  describe('ホットワードの削除', () => {
    test('ホットワードを削除できる', async () => {
      jest.resetModules();

      const originalCwd = process.cwd;
      process.cwd = () => tempDir;

      const { guildHotwords } = await import('../../services/guild-hotwords.js');
      await guildHotwords.initialize();

      const guildId = 'test-guild-remove';
      const word = '削除テスト';

      guildHotwords.addHotword(guildId, word, 'user-123');
      expect(guildHotwords.getHotwords(guildId)).toContain(word);

      const removed = guildHotwords.removeHotword(guildId, word);
      expect(removed).toBe(true);
      expect(guildHotwords.getHotwords(guildId)).not.toContain(word);

      process.cwd = originalCwd;
    });

    test('存在しないホットワードの削除はfalse', async () => {
      jest.resetModules();

      const originalCwd = process.cwd;
      process.cwd = () => tempDir;

      const { guildHotwords } = await import('../../services/guild-hotwords.js');
      await guildHotwords.initialize();

      const guildId = 'test-guild-remove-none';
      const removed = guildHotwords.removeHotword(guildId, '存在しない用語');

      expect(removed).toBe(false);

      process.cwd = originalCwd;
    });
  });

  describe('デフォルトとのマージ', () => {
    test('getMergedHotwordsでデフォルトとGuild固有がマージされる', async () => {
      jest.resetModules();

      const originalCwd = process.cwd;
      process.cwd = () => tempDir;

      const { guildHotwords } = await import('../../services/guild-hotwords.js');
      await guildHotwords.initialize();

      const guildId = 'test-guild-merge';
      guildHotwords.addHotword(guildId, 'カスタム用語', 'user-123');

      const merged = guildHotwords.getMergedHotwords(guildId);

      // デフォルトの用語が含まれている
      expect(merged).toContain('DAO');
      expect(merged).toContain('NFT');
      expect(merged).toContain('Ethereum');

      // カスタム用語も含まれている
      expect(merged).toContain('カスタム用語');

      process.cwd = originalCwd;
    });

    test('getDefaultHotwordsでデフォルトのみ取得できる', async () => {
      jest.resetModules();

      const originalCwd = process.cwd;
      process.cwd = () => tempDir;

      const { guildHotwords } = await import('../../services/guild-hotwords.js');
      await guildHotwords.initialize();

      const defaults = guildHotwords.getDefaultHotwords();

      expect(defaults).toContain('DAO');
      expect(defaults).toContain('NFT');
      expect(defaults).toContain('Ethereum');
      expect(defaults).toHaveLength(3);

      process.cwd = originalCwd;
    });
  });

  describe('clearHotwords', () => {
    test('Guild固有のホットワードをすべてクリアできる', async () => {
      jest.resetModules();

      const originalCwd = process.cwd;
      process.cwd = () => tempDir;

      const { guildHotwords } = await import('../../services/guild-hotwords.js');
      await guildHotwords.initialize();

      const guildId = 'test-guild-clear';
      guildHotwords.addHotword(guildId, '用語A', 'user-123');
      guildHotwords.addHotword(guildId, '用語B', 'user-123');

      expect(guildHotwords.hasHotwords(guildId)).toBe(true);

      const cleared = guildHotwords.clearHotwords(guildId);

      expect(cleared).toBe(true);
      expect(guildHotwords.hasHotwords(guildId)).toBe(false);
      expect(guildHotwords.getHotwords(guildId)).toHaveLength(0);

      process.cwd = originalCwd;
    });

    test('設定のないGuildをクリアするとfalse', async () => {
      jest.resetModules();

      const originalCwd = process.cwd;
      process.cwd = () => tempDir;

      const { guildHotwords } = await import('../../services/guild-hotwords.js');
      await guildHotwords.initialize();

      const cleared = guildHotwords.clearHotwords('non-existent-guild');

      expect(cleared).toBe(false);

      process.cwd = originalCwd;
    });
  });

  describe('複数Guildの分離', () => {
    test('異なるGuildのホットワードは分離されている', async () => {
      jest.resetModules();

      const originalCwd = process.cwd;
      process.cwd = () => tempDir;

      const { guildHotwords } = await import('../../services/guild-hotwords.js');
      await guildHotwords.initialize();

      const guild1 = 'guild-iso-1';
      const guild2 = 'guild-iso-2';

      guildHotwords.addHotword(guild1, 'Guild1専用', 'user-1');
      guildHotwords.addHotword(guild2, 'Guild2専用', 'user-2');

      const hw1 = guildHotwords.getHotwords(guild1);
      const hw2 = guildHotwords.getHotwords(guild2);

      expect(hw1).toContain('Guild1専用');
      expect(hw1).not.toContain('Guild2専用');

      expect(hw2).toContain('Guild2専用');
      expect(hw2).not.toContain('Guild1専用');

      process.cwd = originalCwd;
    });
  });
});
