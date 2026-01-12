import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
} from 'discord.js';
import type { Command } from '../types/index.js';
import { logger } from '../utils/logger.js';
import { guildPrompts } from '../services/guild-prompt.js';

export const promptCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('prompt')
    .setDescription('Whisper APIに送信するプロンプトを管理します（管理者のみ）')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand((subcommand) =>
      subcommand
        .setName('set')
        .setDescription('プロンプトを設定します')
        .addStringOption((option) =>
          option
            .setName('text')
            .setDescription('Whisperに送信するプロンプト（例: DAOやNFTについてWeb3の話をしています）')
            .setRequired(true)
            .setMaxLength(500)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand.setName('show').setDescription('現在のプロンプトを表示します')
    )
    .addSubcommand((subcommand) =>
      subcommand.setName('clear').setDescription('プロンプトを削除します')
    ) as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const guild = interaction.guild;
    if (!guild) {
      await interaction.reply({
        content: '❌ このコマンドはサーバー内でのみ使用できます',
        ephemeral: true,
      });
      return;
    }

    const subcommand = interaction.options.getSubcommand();

    switch (subcommand) {
      case 'set':
        await handleSet(interaction, guild.id);
        break;
      case 'show':
        await handleShow(interaction, guild.id);
        break;
      case 'clear':
        await handleClear(interaction, guild.id);
        break;
      default:
        await interaction.reply({
          content: '❌ 不明なサブコマンドです',
          ephemeral: true,
        });
    }
  },
};

async function handleSet(
  interaction: ChatInputCommandInteraction,
  guildId: string
): Promise<void> {
  const text = interaction.options.getString('text', true);

  const result = guildPrompts.setPrompt(guildId, text, interaction.user.id);

  if (result.success) {
    logger.info(`Prompt set by user ${interaction.user.id} in guild ${guildId}`);
    await interaction.reply({
      content: `✅ プロンプトを設定しました\n\n\`\`\`\n${text.trim()}\n\`\`\``,
      ephemeral: true,
    });
  } else {
    await interaction.reply({
      content: `❌ ${result.error}`,
      ephemeral: true,
    });
  }
}

async function handleShow(
  interaction: ChatInputCommandInteraction,
  guildId: string
): Promise<void> {
  const settings = guildPrompts.getPromptSettings(guildId);

  if (!settings) {
    await interaction.reply({
      content: '📭 プロンプトは設定されていません\n\n`/prompt set text:...` で設定できます',
      ephemeral: true,
    });
    return;
  }

  const updatedAt = new Date(settings.updatedAt).toLocaleString('ja-JP');

  await interaction.reply({
    content: `📋 **現在のプロンプト**\n\n\`\`\`\n${settings.prompt}\n\`\`\`\n\n_最終更新: ${updatedAt}_`,
    ephemeral: true,
  });
}

async function handleClear(
  interaction: ChatInputCommandInteraction,
  guildId: string
): Promise<void> {
  const hadPrompt = guildPrompts.hasPrompt(guildId);

  if (!hadPrompt) {
    await interaction.reply({
      content: '📭 プロンプトは設定されていません',
      ephemeral: true,
    });
    return;
  }

  guildPrompts.clearPrompt(guildId);
  logger.info(`Prompt cleared by user ${interaction.user.id} in guild ${guildId}`);

  await interaction.reply({
    content: '✅ プロンプトを削除しました',
    ephemeral: true,
  });
}
