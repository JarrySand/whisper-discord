import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
} from "discord.js";
import type { Command } from "../types/index.js";
import { logger } from "../utils/logger.js";
import { guildApiKeys, type ProviderType } from "../services/guild-api-keys.js";
import { createProviderForGuild } from "../api/providers/index.js";

export const apikeyCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("apikey")
    .setDescription("文字起こしAPIキーを管理します（管理者のみ）")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand((subcommand) =>
      subcommand
        .setName("set")
        .setDescription("APIキーを設定します")
        .addStringOption((option) =>
          option
            .setName("provider")
            .setDescription("プロバイダーを選択")
            .setRequired(true)
            .addChoices(
              { name: "Groq (高速・推奨)", value: "groq" },
              { name: "OpenAI", value: "openai" },
              { name: "Self-hosted", value: "self-hosted" },
            ),
        )
        .addStringOption((option) =>
          option
            .setName("api_key")
            .setDescription("APIキー（Self-hostedの場合は不要）")
            .setRequired(false),
        )
        .addStringOption((option) =>
          option
            .setName("model")
            .setDescription("モデル名（例: whisper-large-v3）")
            .setRequired(false),
        )
        .addStringOption((option) =>
          option
            .setName("url")
            .setDescription("Self-hosted用のURL")
            .setRequired(false),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("clear").setDescription("APIキー設定を削除します"),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("status")
        .setDescription("現在のAPIキー設定を確認します"),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("test")
        .setDescription("APIキーの有効性をテストします"),
    ) as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const guild = interaction.guild;
    if (!guild) {
      await interaction.reply({
        content: "❌ このコマンドはサーバー内でのみ使用できます",
        ephemeral: true,
      });
      return;
    }

    const subcommand = interaction.options.getSubcommand();

    switch (subcommand) {
      case "set":
        await handleSet(interaction, guild.id);
        break;
      case "clear":
        await handleClear(interaction, guild.id);
        break;
      case "status":
        await handleStatus(interaction, guild.id);
        break;
      case "test":
        await handleTest(interaction, guild.id);
        break;
      default:
        await interaction.reply({
          content: "❌ 不明なサブコマンドです",
          ephemeral: true,
        });
    }
  },
};

async function handleSet(
  interaction: ChatInputCommandInteraction,
  guildId: string,
): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  const provider = interaction.options.getString(
    "provider",
    true,
  ) as ProviderType;
  const apiKey = interaction.options.getString("api_key");
  const model = interaction.options.getString("model");
  const url = interaction.options.getString("url");

  // Self-hosted以外はAPIキーが必須
  if (provider !== "self-hosted" && !apiKey) {
    await interaction.editReply("❌ APIキーを入力してください");
    return;
  }

  // URLはSelf-hostedのみ
  if (url && provider !== "self-hosted") {
    await interaction.editReply(
      "❌ URLはSelf-hostedプロバイダーのみ指定できます",
    );
    return;
  }

  try {
    // まずAPIキーを一時的に設定してテスト
    guildApiKeys.setApiKey(
      guildId,
      provider,
      apiKey ?? undefined,
      interaction.user.id,
      {
        model: model ?? undefined,
        selfHostedUrl: url ?? undefined,
      },
    );

    // プロバイダーを作成してヘルスチェック
    await interaction.editReply("🔄 APIキーをテスト中...");

    try {
      const testProvider = createProviderForGuild(guildId);
      const health = await testProvider.healthCheck();

      if (!health.isHealthy) {
        // テスト失敗 - 設定を削除
        guildApiKeys.clearApiKey(guildId);
        const errorMessage =
          (health.details?.error as string) ?? "不明なエラー";
        await interaction.editReply(
          `❌ APIキーのテストに失敗しました: ${errorMessage}\n` +
            "設定は保存されませんでした。",
        );
        return;
      }

      // テスト成功
      logger.info(`API key set for guild ${guildId}: provider=${provider}`);

      let successMessage = `✅ APIキーを設定しました\n`;
      successMessage += `📌 プロバイダー: ${getProviderDisplayName(provider)}\n`;
      if (model) {
        successMessage += `📝 モデル: ${model}\n`;
      }
      if (url) {
        successMessage += `🔗 URL: ${url}\n`;
      }
      successMessage += `\n⚠️ セキュリティのため、設定されたAPIキーは表示されません`;

      await interaction.editReply(successMessage);
    } catch (error) {
      // テスト中のエラー - 設定を削除
      guildApiKeys.clearApiKey(guildId);
      const errorMessage =
        error instanceof Error ? error.message : "不明なエラー";
      await interaction.editReply(
        `❌ APIキーのテストに失敗しました: ${errorMessage}\n` +
          "設定は保存されませんでした。",
      );
    }
  } catch (error) {
    logger.error(`Failed to set API key for guild ${guildId}:`, error);
    await interaction.editReply("❌ APIキーの設定に失敗しました");
  }
}

async function handleClear(
  interaction: ChatInputCommandInteraction,
  guildId: string,
): Promise<void> {
  if (!guildApiKeys.hasApiKey(guildId)) {
    await interaction.reply({
      content: "📭 このサーバーにはAPIキーが設定されていません",
      ephemeral: true,
    });
    return;
  }

  guildApiKeys.clearApiKey(guildId);
  logger.info(`API key cleared for guild ${guildId}`);

  await interaction.reply({
    content:
      "✅ APIキー設定を削除しました\n📝 今後は環境変数のグローバル設定が使用されます",
    ephemeral: true,
  });
}

async function handleStatus(
  interaction: ChatInputCommandInteraction,
  guildId: string,
): Promise<void> {
  const settings = guildApiKeys.getSettings(guildId);

  if (!settings) {
    await interaction.reply({
      content:
        "📭 このサーバーにはAPIキーが設定されていません\n" +
        "📝 環境変数のグローバル設定が使用されます\n" +
        "💡 `/apikey set` で設定できます",
      ephemeral: true,
    });
    return;
  }

  let message = "📊 **APIキー設定**\n\n";
  message += `📌 プロバイダー: ${getProviderDisplayName(settings.provider)}\n`;
  if (settings.model) {
    message += `📝 モデル: ${settings.model}\n`;
  }
  if (settings.selfHostedUrl) {
    message += `🔗 URL: ${settings.selfHostedUrl}\n`;
  }
  message += `📅 更新日時: ${new Date(settings.updatedAt).toLocaleString("ja-JP")}\n`;
  message += `👤 設定者: <@${settings.updatedBy}>\n`;
  message += `\n⚠️ セキュリティのため、APIキーは表示されません`;

  await interaction.reply({
    content: message,
    ephemeral: true,
  });
}

async function handleTest(
  interaction: ChatInputCommandInteraction,
  guildId: string,
): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  const settings = guildApiKeys.getSettings(guildId);

  if (!settings) {
    await interaction.editReply(
      "📭 このサーバーにはAPIキーが設定されていません\n" +
        "📝 環境変数のグローバル設定をテストします...",
    );
  }

  try {
    const provider = createProviderForGuild(guildId);
    const health = await provider.healthCheck();

    if (health.isHealthy) {
      let message = "✅ **テスト成功**\n\n";
      message += `📌 プロバイダー: ${provider.constructor.name}\n`;
      if (health.details?.model) {
        message += `📝 モデル: ${health.details.model as string}\n`;
      }
      message += `⏱️ レスポンス時間: ${health.details?.responseTimeMs ?? "N/A"}ms`;

      await interaction.editReply(message);
    } else {
      const errorMessage = (health.details?.error as string) ?? "不明なエラー";
      await interaction.editReply(
        `❌ **テスト失敗**\n\n` + `エラー: ${errorMessage}`,
      );
    }
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "不明なエラー";
    await interaction.editReply(`❌ テストに失敗しました: ${errorMessage}`);
  }
}

function getProviderDisplayName(provider: ProviderType): string {
  switch (provider) {
    case "groq":
      return "Groq (高速)";
    case "openai":
      return "OpenAI";
    case "self-hosted":
      return "Self-hosted";
    default:
      return provider;
  }
}
