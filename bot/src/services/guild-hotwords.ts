import { promises as fs } from 'fs';
import path from 'path';
import { logger } from '../utils/logger.js';

/**
 * Guild別ホットワード設定
 */
export interface GuildHotwordsSettings {
  guildId: string;
  hotwords: string[];
  updatedAt: string;
  updatedBy: string;
}

/**
 * 全Guildホットワードデータ
 */
interface GuildHotwordsData {
  version: string;
  guilds: Record<string, GuildHotwordsSettings>;
}

/**
 * デフォルトホットワード設定ファイル形式
 */
interface HotwordsConfig {
  hotwords: string[];
  description?: string;
}

/**
 * ホットワードの最大数（whisper-api側の制限に合わせる）
 */
const MAX_HOTWORDS_PER_GUILD = 50;

/**
 * ホットワードの最大文字数
 */
const MAX_HOTWORD_LENGTH = 50;

/**
 * Guild別ホットワード管理クラス
 * デフォルトのホットワードと、サーバー固有のホットワードをマージして管理
 */
class GuildHotwordsManager {
  private data: GuildHotwordsData;
  private dataPath: string;
  private defaultHotwords: string[] = [];
  private initialized: boolean = false;
  private saveTimeout: NodeJS.Timeout | null = null;

  constructor() {
    this.data = {
      version: '1.0',
      guilds: {},
    };
    this.dataPath = path.join(process.cwd(), 'data', 'guild-hotwords.json');
  }

  /**
   * 初期化（ファイルから読み込み）
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      // デフォルトホットワードを読み込み
      await this.loadDefaultHotwords();

      // データディレクトリ作成
      const dataDir = path.dirname(this.dataPath);
      await fs.mkdir(dataDir, { recursive: true });

      // Guild固有データを読み込み
      try {
        const content = await fs.readFile(this.dataPath, 'utf-8');
        this.data = JSON.parse(content) as GuildHotwordsData;
        logger.info(`Guild hotwords loaded: ${Object.keys(this.data.guilds).length} guilds`);
      } catch {
        logger.info('Guild hotwords file not found, creating new one');
        await this.save();
      }

      this.initialized = true;
      logger.info(`Default hotwords loaded: ${this.defaultHotwords.length} words`);
    } catch (error) {
      logger.error('Failed to initialize guild hotwords:', error);
      throw error;
    }
  }

  /**
   * デフォルトホットワードを読み込み
   */
  private async loadDefaultHotwords(): Promise<void> {
    // プロジェクトルート（bot/../）の config/hotwords.json を参照
    const configPath = path.join(process.cwd(), '..', 'config', 'hotwords.json');
    try {
      const content = await fs.readFile(configPath, 'utf-8');
      const config = JSON.parse(content) as HotwordsConfig;
      this.defaultHotwords = config.hotwords || [];
    } catch (error) {
      logger.warn('Failed to load default hotwords, using empty list:', error);
      this.defaultHotwords = [];
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
      logger.debug('Guild hotwords saved');
    } catch (error) {
      logger.error('Failed to save guild hotwords:', error);
    }
  }

  /**
   * デフォルトホットワードを取得
   */
  getDefaultHotwords(): string[] {
    return [...this.defaultHotwords];
  }

  /**
   * Guild固有のホットワードを取得
   * @param guildId サーバーID
   */
  getHotwords(guildId: string): string[] {
    const settings = this.data.guilds[guildId];
    return settings ? [...settings.hotwords] : [];
  }

  /**
   * デフォルト + Guild固有をマージしたホットワードを取得
   * @param guildId サーバーID
   */
  getMergedHotwords(guildId: string): string[] {
    const guildHotwords = this.getHotwords(guildId);
    const merged = [...this.defaultHotwords];

    for (const word of guildHotwords) {
      if (!merged.includes(word)) {
        merged.push(word);
      }
    }

    return merged;
  }

  /**
   * ホットワードを追加
   * @param guildId サーバーID
   * @param word 追加するホットワード
   * @param userId 設定したユーザーID
   * @returns 追加成功したらtrue、すでに存在する場合はfalse
   */
  addHotword(guildId: string, word: string, userId: string): { success: boolean; error?: string } {
    const trimmedWord = word.trim();

    // バリデーション
    if (!trimmedWord) {
      return { success: false, error: '空のホットワードは追加できません' };
    }

    if (trimmedWord.length > MAX_HOTWORD_LENGTH) {
      return { success: false, error: `ホットワードは${MAX_HOTWORD_LENGTH}文字以内で入力してください` };
    }

    // 既存の設定を取得または作成
    let settings = this.data.guilds[guildId];
    if (!settings) {
      settings = {
        guildId,
        hotwords: [],
        updatedAt: new Date().toISOString(),
        updatedBy: userId,
      };
      this.data.guilds[guildId] = settings;
    }

    // 上限チェック
    if (settings.hotwords.length >= MAX_HOTWORDS_PER_GUILD) {
      return { success: false, error: `ホットワードは最大${MAX_HOTWORDS_PER_GUILD}件までです` };
    }

    // デフォルトに含まれているかチェック
    if (this.defaultHotwords.includes(trimmedWord)) {
      return { success: false, error: 'このホットワードはデフォルトに含まれています' };
    }

    // 重複チェック
    if (settings.hotwords.includes(trimmedWord)) {
      return { success: false, error: 'このホットワードはすでに登録されています' };
    }

    // 追加
    settings.hotwords.push(trimmedWord);
    settings.updatedAt = new Date().toISOString();
    settings.updatedBy = userId;

    logger.info(`Hotword added for guild ${guildId}: "${trimmedWord}"`);
    this.scheduleSave();

    return { success: true };
  }

  /**
   * ホットワードを削除
   * @param guildId サーバーID
   * @param word 削除するホットワード
   * @returns 削除成功したらtrue、存在しない場合はfalse
   */
  removeHotword(guildId: string, word: string): boolean {
    const settings = this.data.guilds[guildId];
    if (!settings) {
      return false;
    }

    const trimmedWord = word.trim();
    const index = settings.hotwords.indexOf(trimmedWord);
    if (index === -1) {
      return false;
    }

    settings.hotwords.splice(index, 1);
    settings.updatedAt = new Date().toISOString();

    // 空になったらエントリを削除
    if (settings.hotwords.length === 0) {
      delete this.data.guilds[guildId];
    }

    logger.info(`Hotword removed for guild ${guildId}: "${trimmedWord}"`);
    this.scheduleSave();

    return true;
  }

  /**
   * Guild固有のホットワードをすべてクリア
   * @param guildId サーバーID
   * @returns クリアしたらtrue、設定がなかった場合はfalse
   */
  clearHotwords(guildId: string): boolean {
    if (!this.data.guilds[guildId]) {
      return false;
    }

    delete this.data.guilds[guildId];
    logger.info(`Hotwords cleared for guild ${guildId}`);
    this.scheduleSave();

    return true;
  }

  /**
   * Guildにホットワードが設定されているか確認
   * @param guildId サーバーID
   */
  hasHotwords(guildId: string): boolean {
    const settings = this.data.guilds[guildId];
    return settings !== undefined && settings.hotwords.length > 0;
  }

  /**
   * Guild設定のメタデータを取得
   * @param guildId サーバーID
   */
  getSettings(guildId: string): GuildHotwordsSettings | undefined {
    return this.data.guilds[guildId];
  }
}

// シングルトンインスタンス
export const guildHotwords = new GuildHotwordsManager();
