/**
 * 出力マネージャー
 * - 各出力サービス（Discord, ログファイル, JSON, Markdown, SQLite）を統合
 * - 一括でセッション開始/終了/出力を管理
 * - エラーハンドリング（1つの出力失敗で他は継続）
 * - セッション終了時にMarkdownをDiscordチャンネルに自動共有
 */
import { TextChannel, AttachmentBuilder } from "discord.js";
import { v4 as uuidv4 } from "uuid";
import * as fs from "fs/promises";
import { logger } from "../utils/logger.js";
import { DiscordOutputService } from "./discord.js";
import { FileLoggerService } from "./file-logger.js";
import { JsonStoreService } from "./json-store.js";
import { MarkdownWriterService } from "./markdown-writer.js";
// SQLite は条件付きで動的インポート（メモリ節約）
type SqliteStore = import("./sqlite-store.js").SqliteStore;
type SqliteStoreManager = import("./sqlite-store.js").SqliteStoreManager;
import type {
  TranscriptionResult,
  OutputManagerConfig,
  DiscordOutputConfig,
  FileLoggerConfig,
  JsonStoreConfig,
  MarkdownWriterConfig,
  SqliteStoreConfig,
} from "../types/index.js";

/**
 * デフォルト設定
 */
const defaultConfig: OutputManagerConfig = {
  discord: {
    enabled: true,
    config: {},
  },
  fileLog: {
    enabled: true,
    config: {},
  },
  jsonStore: {
    enabled: true,
    config: {},
  },
  markdown: {
    enabled: true,
    config: {},
  },
  sqlite: {
    enabled: false,
    config: {
      dbDir: "./data",
      cleanupDays: 30,
    },
  },
};

/**
 * セッションコンテキスト
 */
export interface OutputSessionContext {
  guildId: string;
  guildName: string;
  channelId: string;
  channelName: string;
  outputChannel?: TextChannel;
}

/**
 * 出力マネージャー
 */
export class OutputManager {
  private config: OutputManagerConfig;
  private discord: DiscordOutputService | null = null;
  private fileLogger: FileLoggerService | null = null;
  private jsonStore: JsonStoreService | null = null;
  private markdownWriter: MarkdownWriterService | null = null;
  private sqliteStoreManager: SqliteStoreManager | null = null;
  private sqliteStore: SqliteStore | null = null; // Current session's store (obtained from manager)
  private isSessionActive: boolean = false;
  private currentSessionId: string | null = null;
  private participantCount: number = 0;
  private outputChannel: TextChannel | null = null;

  constructor(config: Partial<OutputManagerConfig> = {}) {
    this.config = {
      discord: { ...defaultConfig.discord, ...config.discord },
      fileLog: { ...defaultConfig.fileLog, ...config.fileLog },
      jsonStore: { ...defaultConfig.jsonStore, ...config.jsonStore },
      markdown: { ...defaultConfig.markdown, ...config.markdown },
      sqlite: { ...defaultConfig.sqlite, ...config.sqlite },
    };

    // 有効なサービスを初期化
    if (this.config.discord.enabled) {
      this.discord = new DiscordOutputService(
        this.config.discord.config as DiscordOutputConfig,
      );
    }

    if (this.config.fileLog.enabled) {
      this.fileLogger = new FileLoggerService(
        this.config.fileLog.config as FileLoggerConfig,
      );
    }

    if (this.config.jsonStore.enabled) {
      this.jsonStore = new JsonStoreService(
        this.config.jsonStore.config as JsonStoreConfig,
      );
    }

    if (this.config.markdown.enabled) {
      this.markdownWriter = new MarkdownWriterService(
        this.config.markdown.config as MarkdownWriterConfig,
      );
    }

    // SQLite: 外部から設定されない場合のみ自前で初期化（動的インポート）
    // 通常はbot.tsのSqliteStoreManagerを共有する
    // this.initSqlite() は setSqliteStoreManager() で設定されない場合のフォールバック

    logger.info("OutputManager initialized", {
      discord: this.config.discord.enabled,
      fileLog: this.config.fileLog.enabled,
      jsonStore: this.config.jsonStore.enabled,
      markdown: this.config.markdown.enabled,
      sqlite: this.config.sqlite.enabled,
    });
  }

  /**
   * 外部からSqliteStoreManagerを設定（bot.tsのインスタンスを共有）
   */
  setSqliteStoreManager(manager: SqliteStoreManager): void {
    this.sqliteStoreManager = manager;
    logger.info("OutputManager: SqliteStoreManager set from external source");
  }

  /**
   * セッションを開始
   */
  async startSession(context: OutputSessionContext): Promise<void> {
    if (this.isSessionActive) {
      logger.warn("OutputManager session already active");
      return;
    }

    const promises: Promise<void>[] = [];

    // Generate session ID
    this.currentSessionId = uuidv4();
    this.participantCount = 0;

    // 出力チャンネル情報を保存（セッション終了時のMarkdown共有用）
    this.outputChannel = context.outputChannel ?? null;

    // Discord出力チャンネル設定
    if (this.discord && context.outputChannel) {
      this.discord.setChannel(context.outputChannel);
    }

    // ファイルロガー開始
    if (this.fileLogger) {
      promises.push(
        this.fileLogger
          .startSession(context.channelName, context.guildName)
          .catch((err) => {
            logger.error("FileLoggerService failed to start session", {
              error: err,
            });
          }),
      );
    }

    // JSONストア開始
    if (this.jsonStore) {
      promises.push(
        this.jsonStore
          .startSession(
            context.guildId,
            context.guildName,
            context.channelId,
            context.channelName,
          )
          .catch((err) => {
            logger.error("JsonStoreService failed to start session", {
              error: err,
            });
          }),
      );
    }

    // Markdownライター開始
    if (this.markdownWriter) {
      promises.push(
        this.markdownWriter
          .startSession(context.channelName, context.guildName)
          .catch((err) => {
            logger.error("MarkdownWriterService failed to start session", {
              error: err,
            });
          }),
      );
    }

    // SQLiteストア開始（guildIdごとに個別DB）
    if (this.sqliteStoreManager && this.currentSessionId) {
      try {
        // guildId に対応する SqliteStore を取得（なければ作成）
        this.sqliteStore = this.sqliteStoreManager.getStore(context.guildId);
        this.sqliteStore.startSession({
          id: this.currentSessionId,
          guildId: context.guildId,
          guildName: context.guildName,
          channelId: context.channelId,
          channelName: context.channelName,
          startedAt: new Date(),
        });
      } catch (err) {
        logger.error("SqliteStore failed to start session", { error: err });
      }
    }

    await Promise.all(promises);
    this.isSessionActive = true;

    logger.info("OutputManager session started", {
      guildName: context.guildName,
      channelName: context.channelName,
      sessionId: this.currentSessionId,
    });
  }

  /**
   * 文字起こし結果を出力
   */
  async output(result: TranscriptionResult): Promise<void> {
    logger.debug("OutputManager.output called", {
      isSessionActive: this.isSessionActive,
      hasDiscord: !!this.discord,
      text: result.text.substring(0, 50),
    });

    if (!this.isSessionActive) {
      logger.warn("OutputManager session not active");
      return;
    }

    const promises: Promise<void>[] = [];

    // Discord出力
    if (this.discord) {
      logger.info("Posting to Discord", { text: result.text.substring(0, 30) });
      promises.push(
        this.discord.post(result).catch((err) => {
          logger.error("Discord output failed", { error: err });
        }),
      );
    } else {
      logger.warn("Discord service not available");
    }

    // ファイルログ出力
    if (this.fileLogger) {
      promises.push(
        this.fileLogger.log(result).catch((err) => {
          logger.error("File log output failed", { error: err });
        }),
      );
    }

    // JSONストア出力
    if (this.jsonStore) {
      promises.push(
        this.jsonStore.addSegment(result).catch((err) => {
          logger.error("JSON store output failed", { error: err });
        }),
      );
    }

    // Markdownライター（セグメント蓄積）
    if (this.markdownWriter) {
      this.markdownWriter.addSegment(result);
    }

    // SQLiteストア出力
    if (this.sqliteStore) {
      try {
        this.sqliteStore.saveTranscriptionResult(result);
      } catch (err) {
        logger.error("SQLite store output failed", { error: err });
      }
    }

    await Promise.all(promises);
  }

  /**
   * 参加者数を更新
   */
  setParticipantCount(count: number): void {
    this.participantCount = count;
  }

  /**
   * セッションを終了
   */
  async endSession(): Promise<void> {
    if (!this.isSessionActive) {
      return;
    }

    const promises: Promise<void>[] = [];

    // Discord出力フラッシュ
    if (this.discord) {
      promises.push(
        this.discord.flush().catch((err) => {
          logger.error("Discord output flush failed", { error: err });
        }),
      );
    }

    // ファイルロガー終了
    if (this.fileLogger) {
      promises.push(
        this.fileLogger.endSession().catch((err) => {
          logger.error("FileLoggerService failed to end session", {
            error: err,
          });
        }),
      );
    }

    // JSONストア終了
    if (this.jsonStore) {
      promises.push(
        this.jsonStore.endSession().catch((err) => {
          logger.error("JsonStoreService failed to end session", {
            error: err,
          });
        }),
      );
    }

    // Markdownライター終了（ファイル書き込み）
    // 先にMarkdownファイルを生成（後でDiscordに送信するため）
    const mdPath = this.markdownWriter?.getMdPath();
    if (this.markdownWriter) {
      await this.markdownWriter.endSession().catch((err) => {
        logger.error("MarkdownWriterService failed to end session", {
          error: err,
        });
      });
    }

    // SQLiteストア終了
    if (this.sqliteStore) {
      try {
        this.sqliteStore.endSession(this.participantCount);
      } catch (err) {
        logger.error("SqliteStore failed to end session", { error: err });
      }
    }

    await Promise.all(promises);

    // MarkdownファイルをDiscordチャンネルに送信
    if (mdPath && this.outputChannel) {
      await this.shareMarkdownToDiscord(mdPath);
    }

    this.isSessionActive = false;
    this.currentSessionId = null;
    this.participantCount = 0;
    this.outputChannel = null;
    this.sqliteStore = null; // セッション終了時にストア参照をクリア

    logger.info("OutputManager session ended");
  }

  /**
   * MarkdownファイルをDiscordチャンネルに送信
   */
  private async shareMarkdownToDiscord(mdPath: string): Promise<void> {
    if (!this.outputChannel) {
      logger.debug("No output channel set, skipping Markdown share");
      return;
    }

    try {
      // ファイルの存在確認
      await fs.access(mdPath);

      // ファイル名を取得
      const fileName = mdPath.split(/[/\\]/).pop() ?? "session.md";

      // ファイルを添付して送信
      const attachment = new AttachmentBuilder(mdPath, { name: fileName });

      await this.outputChannel.send({
        content: "**セッション終了** - 会議メモを生成しました",
        files: [attachment],
      });

      logger.info("Markdown file shared to Discord channel", {
        channelId: this.outputChannel.id,
        filePath: mdPath,
      });
    } catch (error) {
      logger.error("Failed to share Markdown to Discord", { error, mdPath });
    }
  }

  /**
   * Discord出力サービスを取得
   */
  getDiscordService(): DiscordOutputService | null {
    return this.discord;
  }

  /**
   * ファイルロガーサービスを取得
   */
  getFileLoggerService(): FileLoggerService | null {
    return this.fileLogger;
  }

  /**
   * JSONストアサービスを取得
   */
  getJsonStoreService(): JsonStoreService | null {
    return this.jsonStore;
  }

  /**
   * Markdownライターサービスを取得
   */
  getMarkdownWriterService(): MarkdownWriterService | null {
    return this.markdownWriter;
  }

  /**
   * SQLiteストアサービスを取得
   */
  getSqliteStore(): SqliteStore | null {
    return this.sqliteStore;
  }

  /**
   * セッションがアクティブかどうか
   */
  isActive(): boolean {
    return this.isSessionActive;
  }

  /**
   * 現在のセッションIDを取得
   */
  getCurrentSessionId(): string | null {
    return this.currentSessionId;
  }

  /**
   * 出力パスを取得
   */
  getOutputPaths(): {
    log: string | null;
    json: string | null;
    markdown: string | null;
    sqliteDir: string | null;
  } {
    return {
      log: this.fileLogger?.getLogPath() ?? null,
      json: this.jsonStore?.getJsonPath() ?? null,
      markdown: this.markdownWriter?.getMdPath() ?? null,
      sqliteDir: this.config.sqlite.enabled
        ? (this.config.sqlite.config as SqliteStoreConfig).dbDir
        : null,
    };
  }
}

export default OutputManager;
