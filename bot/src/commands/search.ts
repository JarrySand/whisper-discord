/**
 * /search コマンド
 * - 過去の会話ログをキーワード検索
 * - guildIdごとに個別のDBから検索（セキュリティ強化）
 */
import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
} from "discord.js";
import type { Command } from "../types/index.js";
import { logger } from "../utils/logger.js";
// SQLite は条件付きインポート（メモリ節約）
type SqliteStoreManager =
  import("../output/sqlite-store.js").SqliteStoreManager;

// SQLite store manager instance (will be set from outside)
let sqliteStoreManager: SqliteStoreManager | null = null;

/**
 * SQLiteストアマネージャーを設定
 */
export function setSqliteStoreManager(
  manager: SqliteStoreManager | null,
): void {
  sqliteStoreManager = manager;
}

/**
 * SQLiteストアマネージャーを取得（OutputManagerとの共有用）
 */
export function getSqliteStoreManager(): SqliteStoreManager | null {
  return sqliteStoreManager;
}

/**
 * タイムスタンプをフォーマット
 */
function formatTimestamp(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
}

/**
 * 日時をフォーマット
 */
function formatDate(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleDateString("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * /search コマンド定義
 */
export const searchCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("search")
    .setDescription("過去の会話ログを検索します")
    .addStringOption((option) =>
      option
        .setName("keyword")
        .setDescription("検索キーワード")
        .setRequired(true),
    )
    .addUserOption((option) =>
      option
        .setName("user")
        .setDescription("特定のユーザーに絞り込む")
        .setRequired(false),
    )
    .addIntegerOption((option) =>
      option
        .setName("limit")
        .setDescription("結果の最大件数（デフォルト: 10）")
        .setRequired(false)
        .setMinValue(1)
        .setMaxValue(50),
    ) as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    // Check if SQLite is enabled
    if (!sqliteStoreManager) {
      await interaction.reply({
        content:
          "❌ 検索機能は無効になっています。環境変数 `ENABLE_SQLITE=true` を設定してください。",
        ephemeral: true,
      });
      return;
    }

    const keyword = interaction.options.getString("keyword", true);
    const user = interaction.options.getUser("user");
    const limit = interaction.options.getInteger("limit") || 10;
    const guildId = interaction.guildId;

    if (!guildId) {
      await interaction.reply({
        content: "❌ このコマンドはサーバー内でのみ使用できます。",
        ephemeral: true,
      });
      return;
    }

    // Check if this guild has any data
    if (!sqliteStoreManager.hasStore(guildId)) {
      await interaction.reply({
        content: "🔍 このサーバーにはまだ文字起こしデータがありません。",
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply();

    try {
      // Get the store for this specific guild (isolated database)
      const sqliteStore = sqliteStoreManager.getStore(guildId);

      const results = sqliteStore.search({
        keyword,
        userId: user?.id,
        limit,
      });

      if (results.length === 0) {
        await interaction.editReply({
          content: `🔍 「${keyword}」に一致する結果はありませんでした。`,
        });
        return;
      }

      // Build embed
      const embed = new EmbedBuilder()
        .setTitle(`🔍 検索結果: "${keyword}"`)
        .setColor(0x5865f2)
        .setDescription(`${results.length}件の結果が見つかりました`)
        .setTimestamp();

      // Add results (max 10 to fit in embed)
      const displayResults = results.slice(0, 10);

      for (const result of displayResults) {
        const timestamp = formatTimestamp(result.startTs / 1000);
        const date = formatDate(result.sessionStartedAt);
        const displayName = result.displayName || result.username;

        // Truncate long text
        let text = result.text;
        if (text.length > 100) {
          text = text.substring(0, 100) + "...";
        }

        // Highlight keyword in text
        const highlightedText = text.replace(
          new RegExp(`(${escapeRegExp(keyword)})`, "gi"),
          "**$1**",
        );

        embed.addFields({
          name: `${displayName} - ${date} [${timestamp}]`,
          value: highlightedText || "(空)",
          inline: false,
        });
      }

      if (results.length > 10) {
        embed.setFooter({
          text: `他 ${results.length - 10} 件の結果があります`,
        });
      }

      await interaction.editReply({ embeds: [embed] });

      logger.info("Search command executed", {
        guildId,
        keyword,
        userId: user?.id,
        resultCount: results.length,
      });
    } catch (error) {
      logger.error("Search command error", { error });
      await interaction.editReply({
        content: "❌ 検索中にエラーが発生しました。",
      });
    }
  },
};

/**
 * 正規表現の特殊文字をエスケープ
 */
function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export default searchCommand;
