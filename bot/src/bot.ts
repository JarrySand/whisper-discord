import {
  Client,
  GatewayIntentBits,
  Events,
  Collection,
  REST,
  Routes,
  VoiceState,
} from "discord.js";
import { botConfig } from "./config/index.js";
import { logger } from "./utils/logger.js";
import type { Command } from "./types/index.js";
import { commands, setSqliteStoreManager } from "./commands/index.js";
import { connectionManager } from "./voice/connection.js";
import { guildSettings } from "./services/guild-settings.js";
import { guildApiKeys } from "./services/guild-api-keys.js";
import { guildPrompts } from "./services/guild-prompt.js";
// SQLite は条件付きで動的インポート（メモリ節約）
type SqliteStoreManager = import("./output/sqlite-store.js").SqliteStoreManager;

/**
 * Discord Bot クラス
 */
export class Bot {
  public readonly client: Client;
  public readonly commands: Collection<string, Command>;
  private isReady = false;
  private sqliteStoreManager: SqliteStoreManager | null = null;

  constructor() {
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages,
      ],
    });

    this.commands = new Collection();
    this.loadCommands();
    this.setupEventHandlers();
  }

  /**
   * SQLite を動的に初期化（メモリ節約のため条件付きインポート）
   */
  private async initSqlite(): Promise<void> {
    try {
      const { SqliteStoreManager } = await import("./output/sqlite-store.js");
      this.sqliteStoreManager = new SqliteStoreManager(
        botConfig.output.sqliteDbDir,
        botConfig.output.sqliteCleanupDays,
      );
      setSqliteStoreManager(this.sqliteStoreManager);
      logger.info("SQLite store manager initialized", {
        dbDir: botConfig.output.sqliteDbDir,
      });
    } catch (error) {
      logger.error("Failed to initialize SQLite store manager", { error });
    }
  }

  /**
   * コマンドをロード
   */
  private loadCommands(): void {
    for (const command of commands) {
      this.commands.set(command.data.name, command);
      logger.info(`Loaded command: /${command.data.name}`);
    }
  }

  /**
   * イベントハンドラを設定
   */
  private setupEventHandlers(): void {
    // Ready イベント
    this.client.once(Events.ClientReady, (readyClient) => {
      this.isReady = true;
      logger.info(`✅ Bot is ready! Logged in as ${readyClient.user.tag}`);
      logger.info(`📊 Serving ${readyClient.guilds.cache.size} guild(s)`);
    });

    // InteractionCreate イベント（コマンド処理）
    this.client.on(Events.InteractionCreate, async (interaction) => {
      if (!interaction.isChatInputCommand()) return;

      const command = this.commands.get(interaction.commandName);

      if (!command) {
        logger.warn(`Unknown command: ${interaction.commandName}`);
        return;
      }

      try {
        logger.info(
          `Executing command: /${interaction.commandName} by ${interaction.user.tag}`,
        );
        await command.execute(interaction);
      } catch (error) {
        logger.error(
          `Error executing command /${interaction.commandName}:`,
          error,
        );

        const errorMessage = "❌ コマンドの実行中にエラーが発生しました";

        try {
          if (interaction.replied || interaction.deferred) {
            await interaction.followUp({
              content: errorMessage,
              ephemeral: true,
            });
          } else {
            await interaction.reply({ content: errorMessage, ephemeral: true });
          }
        } catch (replyError) {
          // 応答に失敗した場合は無視（すでに応答済みの可能性）
          logger.debug(
            "Failed to send error response to interaction:",
            replyError,
          );
        }
      }
    });

    // VoiceStateUpdate イベント（自動離脱監視）
    this.client.on(
      Events.VoiceStateUpdate,
      (oldState: VoiceState, newState: VoiceState) => {
        this.handleVoiceStateUpdate(oldState, newState);
      },
    );

    // エラーハンドリング
    this.client.on(Events.Error, (error) => {
      logger.error("Discord client error:", error);
    });

    this.client.on(Events.Warn, (warning) => {
      logger.warn("Discord client warning:", warning);
    });
  }

  /**
   * VoiceStateUpdate を処理（自動離脱監視）
   */
  private handleVoiceStateUpdate(
    oldState: VoiceState,
    newState: VoiceState,
  ): void {
    const guildId = oldState.guild.id;

    // Bot が接続しているギルドかチェック
    const connectionInfo = connectionManager.getConnection(guildId);
    if (!connectionInfo) return;

    const botChannelId = connectionInfo.channelId;

    // Bot のチャンネルに関係のない変更は無視
    if (
      oldState.channelId !== botChannelId &&
      newState.channelId !== botChannelId
    ) {
      return;
    }

    // Bot 自身の状態変更は無視
    if (
      oldState.member?.user.bot &&
      oldState.member.id === this.client.user?.id
    ) {
      return;
    }

    // チャンネルのメンバー数を取得（Bot を除く）
    const channel = oldState.guild.channels.cache.get(botChannelId);
    if (!channel || !channel.isVoiceBased()) return;

    const humanMembers = channel.members.filter((member) => !member.user.bot);
    const humanCount = humanMembers.size;

    logger.debug(
      `Voice state update in ${connectionInfo.channelName}: ${humanCount} human member(s)`,
    );

    if (humanCount === 0) {
      // 誰もいなくなった → 即時自動退出（レポート生成含む）
      connectionManager.handleEmptyChannel(guildId);
    }
    // 誰かいる場合は何もしない（即時退出なのでタイマーキャンセル不要）
  }

  /**
   * スラッシュコマンドを登録
   */
  async registerCommands(): Promise<void> {
    const rest = new REST({ version: "10" }).setToken(botConfig.token);

    try {
      logger.info("Registering slash commands...");

      const commandData = commands.map((cmd) => cmd.data.toJSON());

      await rest.put(Routes.applicationCommands(botConfig.clientId), {
        body: commandData,
      });

      logger.info(`✅ Successfully registered ${commandData.length} commands`);
    } catch (error) {
      logger.error("Failed to register commands:", error);
      throw error;
    }
  }

  /**
   * Bot を起動
   */
  async start(): Promise<void> {
    try {
      logger.info("Starting bot...");

      // SQLite を初期化（有効な場合）
      if (botConfig.output.enableSqlite) {
        await this.initSqlite();
      }

      // サーバー設定を初期化
      await guildSettings.initialize();

      // Guild別APIキー設定を初期化
      await guildApiKeys.initialize();

      // Guild別プロンプト設定を初期化
      await guildPrompts.initialize();

      await this.client.login(botConfig.token);
    } catch (error) {
      logger.error("Failed to start bot:", error);
      throw error;
    }
  }

  /**
   * Bot を停止（Graceful shutdown）
   */
  async stop(): Promise<void> {
    logger.info("Stopping bot...");

    // すべてのVC接続を切断（文字起こしサービスの停止含む）
    await connectionManager.removeAllConnections();

    // サーバー設定を保存
    await guildSettings.save();

    // Guild別APIキー設定を保存
    await guildApiKeys.save();

    // Guild別プロンプト設定を保存
    await guildPrompts.save();

    // SQLite ストアマネージャーを閉じる
    if (this.sqliteStoreManager) {
      this.sqliteStoreManager.closeAll();
      this.sqliteStoreManager = null;
      setSqliteStoreManager(null);
    }

    this.client.destroy();
    this.isReady = false;
    logger.info("Bot stopped");
  }

  /**
   * Bot が準備完了かどうか
   */
  get ready(): boolean {
    return this.isReady;
  }

  /**
   * SQLite ストアマネージャーを取得
   */
  getSqliteStoreManager(): SqliteStoreManager | null {
    return this.sqliteStoreManager;
  }
}

export default Bot;
