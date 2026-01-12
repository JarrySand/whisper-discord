/**
 * 暗号化サービス テスト
 *
 * テスト項目:
 * - 暗号化/復号化のラウンドトリップ
 * - 異なるキーで異なる暗号文を生成
 * - 改ざん検出（暗号文、タグ、IV）
 * - エッジケース（空文字、長い文字列、Unicode）
 */
import crypto from 'crypto';

// テスト用に環境変数を設定してからモジュールをインポート
const TEST_ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');
process.env.ENCRYPTION_KEY = TEST_ENCRYPTION_KEY;
process.env.DISCORD_BOT_TOKEN = 'test-token-for-testing';

// 動的インポートでencryptionServiceを取得
let encryptionService: typeof import('../../services/encryption.js').encryptionService;

beforeAll(async () => {
  const module = await import('../../services/encryption.js');
  encryptionService = module.encryptionService;
});

describe('EncryptionService', () => {
  beforeEach(() => {
    // 各テスト前に初期化
    if (!encryptionService.isAvailable()) {
      encryptionService.initialize();
    }
  });

  describe('初期化', () => {
    test('ENCRYPTION_KEYで初期化される', () => {
      expect(encryptionService.isAvailable()).toBe(true);
    });
  });

  describe('暗号化/復号化', () => {
    test('平文を暗号化して復号化できる', () => {
      const plaintext = 'Hello, World!';
      const encrypted = encryptionService.encrypt(plaintext);
      const decrypted = encryptionService.decrypt(encrypted);

      expect(decrypted).toBe(plaintext);
    });

    test('暗号化されたデータは正しい形式を持つ', () => {
      const plaintext = 'Test data';
      const encrypted = encryptionService.encrypt(plaintext);

      // 必須フィールドの確認
      expect(encrypted).toHaveProperty('iv');
      expect(encrypted).toHaveProperty('ciphertext');
      expect(encrypted).toHaveProperty('tag');

      // hex形式の確認
      expect(encrypted.iv).toMatch(/^[0-9a-f]+$/i);
      expect(encrypted.ciphertext).toMatch(/^[0-9a-f]+$/i);
      expect(encrypted.tag).toMatch(/^[0-9a-f]+$/i);

      // IVは12バイト = 24文字のhex
      expect(encrypted.iv.length).toBe(24);

      // タグは16バイト = 32文字のhex
      expect(encrypted.tag.length).toBe(32);
    });

    test('同じ平文でも毎回異なる暗号文を生成する（IVがランダム）', () => {
      const plaintext = 'Same text';

      const encrypted1 = encryptionService.encrypt(plaintext);
      const encrypted2 = encryptionService.encrypt(plaintext);

      // IVが異なることを確認
      expect(encrypted1.iv).not.toBe(encrypted2.iv);

      // 暗号文も異なることを確認
      expect(encrypted1.ciphertext).not.toBe(encrypted2.ciphertext);

      // 復号化すると同じ平文になる
      expect(encryptionService.decrypt(encrypted1)).toBe(plaintext);
      expect(encryptionService.decrypt(encrypted2)).toBe(plaintext);
    });

    test('空文字を暗号化/復号化できる', () => {
      const plaintext = '';
      const encrypted = encryptionService.encrypt(plaintext);
      const decrypted = encryptionService.decrypt(encrypted);

      expect(decrypted).toBe(plaintext);
    });

    test('長い文字列を暗号化/復号化できる', () => {
      const plaintext = 'A'.repeat(10000);
      const encrypted = encryptionService.encrypt(plaintext);
      const decrypted = encryptionService.decrypt(encrypted);

      expect(decrypted).toBe(plaintext);
    });

    test('Unicode文字を暗号化/復号化できる', () => {
      const plaintext = '日本語テスト 🎉 emoji ñ é ü';
      const encrypted = encryptionService.encrypt(plaintext);
      const decrypted = encryptionService.decrypt(encrypted);

      expect(decrypted).toBe(plaintext);
    });

    test('APIキー形式の文字列を暗号化/復号化できる', () => {
      const plaintext = 'sk-proj-abc123XYZ_def456-ghi789';
      const encrypted = encryptionService.encrypt(plaintext);
      const decrypted = encryptionService.decrypt(encrypted);

      expect(decrypted).toBe(plaintext);
    });
  });

  describe('改ざん検出', () => {
    test('暗号文が改ざんされると復号化に失敗する', () => {
      const plaintext = 'Sensitive data';
      const encrypted = encryptionService.encrypt(plaintext);

      // 暗号文を改ざん
      const tamperedCiphertext = encrypted.ciphertext.replace(
        encrypted.ciphertext[0],
        encrypted.ciphertext[0] === 'a' ? 'b' : 'a'
      );

      expect(() => {
        encryptionService.decrypt({
          ...encrypted,
          ciphertext: tamperedCiphertext,
        });
      }).toThrow();
    });

    test('認証タグが改ざんされると復号化に失敗する', () => {
      const plaintext = 'Sensitive data';
      const encrypted = encryptionService.encrypt(plaintext);

      // タグを改ざん
      const tamperedTag = encrypted.tag.replace(
        encrypted.tag[0],
        encrypted.tag[0] === 'a' ? 'b' : 'a'
      );

      expect(() => {
        encryptionService.decrypt({
          ...encrypted,
          tag: tamperedTag,
        });
      }).toThrow();
    });

    test('IVが改ざんされると復号化に失敗する', () => {
      const plaintext = 'Sensitive data';
      const encrypted = encryptionService.encrypt(plaintext);

      // IVを改ざん
      const tamperedIv = encrypted.iv.replace(
        encrypted.iv[0],
        encrypted.iv[0] === 'a' ? 'b' : 'a'
      );

      expect(() => {
        encryptionService.decrypt({
          ...encrypted,
          iv: tamperedIv,
        });
      }).toThrow();
    });
  });

  describe('エラーハンドリング', () => {
    test('不正なhex文字列で復号化しようとするとエラー', () => {
      expect(() => {
        encryptionService.decrypt({
          iv: 'not-valid-hex!',
          ciphertext: '00112233',
          tag: '00112233445566778899aabbccddeeff',
        });
      }).toThrow();
    });
  });
});
