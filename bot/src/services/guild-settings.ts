import { promises as fs } from 'fs';
import path from 'path';
import { logger } from '../utils/logger.js';

/**
 * サーバー設定
 */
export interface GuildSettings {
  guildId: string;
  guildName?: string;
  defaultOutputChannelId?: string;
  defaultOutputChannelName?: string;
  updatedAt: string;
}

/**
 * 全サーバー設定データ
 */
interface GuildSettingsData {
  version: string;
  guilds: Record<string, GuildSettings>;
}

/**
 * サーバー設定管理クラス
 * サーバーごとにデフォルト出力チャンネルなどの設定を永続化
 */
class GuildSettingsManager {
  private settings: GuildSettingsData;
  private settingsPath: string;
  private initialized: boolean = false;
  private saveTimeout: NodeJS.Timeout | null = null;

  constructor() {
    this.settings = {
      version: '1.0',
      guilds: {},
    };
    // データディレクトリに保存
    this.settingsPath = path.join(process.cwd(), 'data', 'guild-settings.json');
  }

  /**
   * 設定を初期化（ファイルから読み込み）
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      // データディレクトリを作成
      const dataDir = path.dirname(this.settingsPath);
      await fs.mkdir(dataDir, { recursive: true });

      // ファイルが存在する場合は読み込み
      try {
        const data = await fs.readFile(this.settingsPath, 'utf-8');
        this.settings = JSON.parse(data) as GuildSettingsData;
        logger.info(`Guild settings loaded: ${Object.keys(this.settings.guilds).length} guilds`);
      } catch {
        // ファイルが存在しない場合は新規作成
        logger.info('Guild settings file not found, creating new one');
        await this.save();
      }

      this.initialized = true;
    } catch (error) {
      logger.error('Failed to initialize guild settings:', error);
      throw error;
    }
  }

  /**
   * 設定を保存（デバウンス付き）
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
   * 設定を即座に保存
   */
  async save(): Promise<void> {
    try {
      const dataDir = path.dirname(this.settingsPath);
      await fs.mkdir(dataDir, { recursive: true });
      await fs.writeFile(this.settingsPath, JSON.stringify(this.settings, null, 2), 'utf-8');
      logger.debug('Guild settings saved');
    } catch (error) {
      logger.error('Failed to save guild settings:', error);
    }
  }

  /**
   * サーバー設定を取得
   */
  getSettings(guildId: string): GuildSettings | undefined {
    return this.settings.guilds[guildId];
  }

  /**
   * デフォルト出力チャンネルを取得
   */
  getDefaultOutputChannel(guildId: string): { channelId: string; channelName?: string } | undefined {
    const settings = this.settings.guilds[guildId];
    if (settings?.defaultOutputChannelId) {
      return {
        channelId: settings.defaultOutputChannelId,
        channelName: settings.defaultOutputChannelName,
      };
    }
    return undefined;
  }

  /**
   * デフォルト出力チャンネルを設定
   */
  setDefaultOutputChannel(
    guildId: string,
    channelId: string,
    channelName?: string,
    guildName?: string
  ): void {
    if (!this.settings.guilds[guildId]) {
      this.settings.guilds[guildId] = {
        guildId,
        updatedAt: new Date().toISOString(),
      };
    }

    this.settings.guilds[guildId].defaultOutputChannelId = channelId;
    this.settings.guilds[guildId].defaultOutputChannelName = channelName;
    if (guildName) {
      this.settings.guilds[guildId].guildName = guildName;
    }
    this.settings.guilds[guildId].updatedAt = new Date().toISOString();

    logger.info(`Default output channel set for guild ${guildId}: ${channelName ?? channelId}`);
    this.scheduleSave();
  }

  /**
   * デフォルト出力チャンネルをクリア
   */
  clearDefaultOutputChannel(guildId: string): void {
    if (this.settings.guilds[guildId]) {
      delete this.settings.guilds[guildId].defaultOutputChannelId;
      delete this.settings.guilds[guildId].defaultOutputChannelName;
      this.settings.guilds[guildId].updatedAt = new Date().toISOString();
      this.scheduleSave();
      logger.info(`Default output channel cleared for guild ${guildId}`);
    }
  }

  /**
   * サーバー設定を更新
   */
  updateSettings(guildId: string, updates: Partial<GuildSettings>): void {
    if (!this.settings.guilds[guildId]) {
      this.settings.guilds[guildId] = {
        guildId,
        updatedAt: new Date().toISOString(),
      };
    }

    Object.assign(this.settings.guilds[guildId], updates);
    this.settings.guilds[guildId].updatedAt = new Date().toISOString();
    this.scheduleSave();
  }

  /**
   * サーバー設定を削除
   */
  deleteSettings(guildId: string): void {
    if (this.settings.guilds[guildId]) {
      delete this.settings.guilds[guildId];
      this.scheduleSave();
      logger.info(`Guild settings deleted for ${guildId}`);
    }
  }
}

// シングルトンインスタンス
export const guildSettings = new GuildSettingsManager();

