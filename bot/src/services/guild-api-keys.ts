import { promises as fs } from 'fs';
import path from 'path';
import { logger } from '../utils/logger.js';
import { encryptionService, type EncryptedData } from './encryption.js';

/**
 * プロバイダータイプ
 */
export type ProviderType = 'groq' | 'openai' | 'self-hosted';

/**
 * Guild別APIキー設定
 */
export interface GuildApiKeySettings {
  guildId: string;
  provider: ProviderType;
  encryptedKey?: EncryptedData;
  selfHostedUrl?: string;  // Self-hosted用URL
  model?: string;          // モデル名
  updatedAt: string;
  updatedBy: string;       // 設定したユーザーID
}

/**
 * 全Guild APIキーデータ
 */
interface GuildApiKeysData {
  version: string;
  guilds: Record<string, GuildApiKeySettings>;
}

/**
 * APIキー設定結果
 */
export interface ApiKeyConfig {
  provider: ProviderType;
  apiKey?: string;
  selfHostedUrl?: string;
  model?: string;
}

/**
 * Guild別APIキー管理クラス
 * 各サーバーごとに暗号化されたAPIキーを保存
 */
class GuildApiKeysManager {
  private data: GuildApiKeysData;
  private dataPath: string;
  private initialized: boolean = false;
  private saveTimeout: NodeJS.Timeout | null = null;

  constructor() {
    this.data = {
      version: '1.0',
      guilds: {},
    };
    // guild-settings.jsonとは別ファイルで管理（セキュリティ分離）
    this.dataPath = path.join(process.cwd(), 'data', 'guild-api-keys.json');
  }

  /**
   * 初期化（ファイルから読み込み）
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    // 暗号化サービスを先に初期化
    encryptionService.initialize();

    try {
      const dataDir = path.dirname(this.dataPath);
      await fs.mkdir(dataDir, { recursive: true });

      try {
        const content = await fs.readFile(this.dataPath, 'utf-8');
        this.data = JSON.parse(content) as GuildApiKeysData;
        logger.info(`Guild API keys loaded: ${Object.keys(this.data.guilds).length} guilds`);
      } catch {
        logger.info('Guild API keys file not found, creating new one');
        await this.save();
      }

      this.initialized = true;
    } catch (error) {
      logger.error('Failed to initialize guild API keys:', error);
      throw error;
    }
  }

  /**
   * デバウンス付き保存
   */
  private scheduleSave(): void {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
    }
    this.saveTimeout = setTimeout(() => {
      void this.save();
    }, 1000);
  }

  /**
   * 即座に保存
   */
  async save(): Promise<void> {
    try {
      const dataDir = path.dirname(this.dataPath);
      await fs.mkdir(dataDir, { recursive: true });
      await fs.writeFile(this.dataPath, JSON.stringify(this.data, null, 2), 'utf-8');
      logger.debug('Guild API keys saved');
    } catch (error) {
      logger.error('Failed to save guild API keys:', error);
    }
  }

  /**
   * APIキーを設定
   * @param guildId サーバーID
   * @param provider プロバイダータイプ
   * @param apiKey APIキー（暗号化して保存）
   * @param userId 設定したユーザーID
   * @param options 追加オプション
   */
  setApiKey(
    guildId: string,
    provider: ProviderType,
    apiKey: string | undefined,
    userId: string,
    options?: { model?: string; selfHostedUrl?: string }
  ): void {
    const settings: GuildApiKeySettings = {
      guildId,
      provider,
      updatedAt: new Date().toISOString(),
      updatedBy: userId,
    };

    // Self-hostedの場合はAPIキー不要
    if (provider !== 'self-hosted' && apiKey) {
      settings.encryptedKey = encryptionService.encrypt(apiKey);
    }

    if (options?.model) {
      settings.model = options.model;
    }

    if (options?.selfHostedUrl) {
      settings.selfHostedUrl = options.selfHostedUrl;
    }

    this.data.guilds[guildId] = settings;
    logger.info(`API key set for guild ${guildId}: provider=${provider}`);
    this.scheduleSave();
  }

  /**
   * APIキー設定を取得
   * @param guildId サーバーID
   * @returns APIキー設定（復号化済み）またはundefined
   */
  getApiKeyConfig(guildId: string): ApiKeyConfig | undefined {
    const settings = this.data.guilds[guildId];
    if (!settings) {
      return undefined;
    }

    const config: ApiKeyConfig = {
      provider: settings.provider,
      model: settings.model,
      selfHostedUrl: settings.selfHostedUrl,
    };

    // 暗号化されたキーがあれば復号化
    if (settings.encryptedKey) {
      try {
        config.apiKey = encryptionService.decrypt(settings.encryptedKey);
      } catch (error) {
        logger.error(`Failed to decrypt API key for guild ${guildId}:`, error);
        return undefined;
      }
    }

    return config;
  }

  /**
   * APIキーをクリア
   * @param guildId サーバーID
   */
  clearApiKey(guildId: string): void {
    if (this.data.guilds[guildId]) {
      delete this.data.guilds[guildId];
      logger.info(`API key cleared for guild ${guildId}`);
      this.scheduleSave();
    }
  }

  /**
   * APIキーが設定されているか確認
   * @param guildId サーバーID
   */
  hasApiKey(guildId: string): boolean {
    return guildId in this.data.guilds;
  }

  /**
   * Guild設定のメタデータを取得（APIキー自体は含まない）
   * @param guildId サーバーID
   */
  getSettings(guildId: string): Omit<GuildApiKeySettings, 'encryptedKey'> | undefined {
    const settings = this.data.guilds[guildId];
    if (!settings) {
      return undefined;
    }

    // 暗号化されたキーは除外して返す
    const { encryptedKey: _, ...safeSettings } = settings;
    return safeSettings;
  }

  /**
   * 全GuildのIDリストを取得
   */
  getAllGuildIds(): string[] {
    return Object.keys(this.data.guilds);
  }
}

// シングルトンインスタンス
export const guildApiKeys = new GuildApiKeysManager();
