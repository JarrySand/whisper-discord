import crypto from 'crypto';
import { logger } from '../utils/logger.js';

/**
 * 暗号化されたデータ
 */
export interface EncryptedData {
  iv: string;        // 初期化ベクトル (hex)
  ciphertext: string; // 暗号文 (hex)
  tag: string;       // 認証タグ (hex)
}

/**
 * AES-256-GCM暗号化サービス
 * APIキーなどの機密データを安全に保存するために使用
 */
class EncryptionService {
  private masterKey: Buffer | null = null;
  private initialized: boolean = false;

  /**
   * 暗号化サービスを初期化
   * ENCRYPTION_KEYが設定されていない場合はDISCORD_BOT_TOKENから派生キーを生成
   */
  initialize(): void {
    if (this.initialized) return;

    const encryptionKey = process.env.ENCRYPTION_KEY;

    if (encryptionKey) {
      // ENCRYPTION_KEYが設定されている場合はそのまま使用
      if (encryptionKey.length !== 64) {
        throw new Error('ENCRYPTION_KEY must be 64 hex characters (256-bit key)');
      }
      this.masterKey = Buffer.from(encryptionKey, 'hex');
      logger.info('Encryption service initialized with ENCRYPTION_KEY');
    } else {
      // フォールバック: DISCORD_BOT_TOKENから派生キーを生成
      const botToken = process.env.DISCORD_BOT_TOKEN;
      if (!botToken) {
        throw new Error('Either ENCRYPTION_KEY or DISCORD_BOT_TOKEN must be set for encryption');
      }
      logger.warn(
        'ENCRYPTION_KEY not set. Deriving encryption key from DISCORD_BOT_TOKEN. ' +
        'For production, set ENCRYPTION_KEY using: openssl rand -hex 32'
      );
      // PBKDF2で派生キーを生成
      this.masterKey = crypto.pbkdf2Sync(
        botToken,
        'whisper-discord-salt', // 固定salt（トークン自体が十分なエントロピーを持つ）
        100000, // 反復回数
        32, // 32バイト = 256ビット
        'sha256'
      );
    }

    this.initialized = true;
  }

  /**
   * 初期化済みかどうかを確認
   */
  private ensureInitialized(): void {
    if (!this.initialized || !this.masterKey) {
      throw new Error('Encryption service not initialized. Call initialize() first.');
    }
  }

  /**
   * 平文を暗号化
   * @param plaintext 暗号化する平文
   * @returns 暗号化されたデータ（iv, ciphertext, tag）
   */
  encrypt(plaintext: string): EncryptedData {
    this.ensureInitialized();

    // ランダムなIVを生成（12バイト = 96ビット、GCMの推奨サイズ）
    const iv = crypto.randomBytes(12);

    // AES-256-GCMで暗号化
    const cipher = crypto.createCipheriv('aes-256-gcm', this.masterKey!, iv);
    const encrypted = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();

    return {
      iv: iv.toString('hex'),
      ciphertext: encrypted.toString('hex'),
      tag: tag.toString('hex'),
    };
  }

  /**
   * 暗号化されたデータを復号化
   * @param encrypted 暗号化されたデータ
   * @returns 復号化された平文
   */
  decrypt(encrypted: EncryptedData): string {
    this.ensureInitialized();

    const iv = Buffer.from(encrypted.iv, 'hex');
    const ciphertext = Buffer.from(encrypted.ciphertext, 'hex');
    const tag = Buffer.from(encrypted.tag, 'hex');

    // AES-256-GCMで復号化
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.masterKey!, iv);
    decipher.setAuthTag(tag);

    const decrypted = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);

    return decrypted.toString('utf8');
  }

  /**
   * 暗号化サービスが利用可能かどうかを確認
   */
  isAvailable(): boolean {
    return this.initialized && this.masterKey !== null;
  }
}

// シングルトンインスタンス
export const encryptionService = new EncryptionService();
