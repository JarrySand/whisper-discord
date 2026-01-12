import { promises as fs } from 'fs';
import path from 'path';
import { logger } from '../utils/logger.js';

/**
 * Guild別プロンプト設定
 */
export interface GuildPromptSettings {
  guildId: string;
  prompt: string;
  updatedAt: string;
  updatedBy: string;
}

/**
 * 全Guildプロンプトデータ
 */
interface GuildPromptData {
  version: string;
  guilds: Record<string, GuildPromptSettings>;
}

/**
 * プロンプトの最大文字数
 */
const MAX_PROMPT_LENGTH = 500;

/**
 * Guild別プロンプト管理クラス
 */
class GuildPromptManager {
  private data: GuildPromptData;
  private dataPath: string;
  private initialized: boolean = false;
  private saveTimeout: NodeJS.Timeout | null = null;

  constructor() {
    this.data = {
      version: '1.0',
      guilds: {},
    };
    this.dataPath = path.join(process.cwd(), 'data', 'guild-prompts.json');
  }

  /**
   * 初期化（ファイルから読み込み）
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      // データディレクトリ作成
      const dataDir = path.dirname(this.dataPath);
      await fs.mkdir(dataDir, { recursive: true });

      // Guild固有データを読み込み
      try {
        const content = await fs.readFile(this.dataPath, 'utf-8');
        this.data = JSON.parse(content) as GuildPromptData;
        logger.info(`Guild prompts loaded: ${Object.keys(this.data.guilds).length} guilds`);
      } catch {
        logger.info('Guild prompts file not found, creating new one');
        await this.save();
      }

      this.initialized = true;
    } catch (error) {
      logger.error('Failed to initialize guild prompts:', error);
      throw error;
    }
  }

  /**
   * プロンプトを設定
   */
  setPrompt(
    guildId: string,
    prompt: string,
    userId: string
  ): { success: boolean; error?: string } {
    const trimmedPrompt = prompt.trim();

    if (trimmedPrompt.length === 0) {
      return { success: false, error: 'プロンプトが空です' };
    }

    if (trimmedPrompt.length > MAX_PROMPT_LENGTH) {
      return {
        success: false,
        error: `プロンプトは${MAX_PROMPT_LENGTH}文字以内で入力してください（現在: ${trimmedPrompt.length}文字）`,
      };
    }

    this.data.guilds[guildId] = {
      guildId,
      prompt: trimmedPrompt,
      updatedAt: new Date().toISOString(),
      updatedBy: userId,
    };

    this.scheduleSave();
    return { success: true };
  }

  /**
   * プロンプトを取得
   */
  getPrompt(guildId: string): string | null {
    return this.data.guilds[guildId]?.prompt ?? null;
  }

  /**
   * プロンプト設定を取得
   */
  getPromptSettings(guildId: string): GuildPromptSettings | null {
    return this.data.guilds[guildId] ?? null;
  }

  /**
   * プロンプトが設定されているか
   */
  hasPrompt(guildId: string): boolean {
    return guildId in this.data.guilds && this.data.guilds[guildId].prompt.length > 0;
  }

  /**
   * プロンプトをクリア
   */
  clearPrompt(guildId: string): boolean {
    if (!(guildId in this.data.guilds)) {
      return false;
    }

    delete this.data.guilds[guildId];
    this.scheduleSave();
    return true;
  }

  /**
   * 遅延保存をスケジュール
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
   * ファイルに保存
   */
  async save(): Promise<void> {
    try {
      await fs.writeFile(this.dataPath, JSON.stringify(this.data, null, 2), 'utf-8');
      logger.debug('Guild prompts saved');
    } catch (error) {
      logger.error('Failed to save guild prompts:', error);
    }
  }
}

// シングルトンインスタンス
export const guildPrompts = new GuildPromptManager();
