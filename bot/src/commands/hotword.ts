import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
} from 'discord.js';
import type { Command } from '../types/index.js';
import { logger } from '../utils/logger.js';
import { guildHotwords } from '../services/guild-hotwords.js';

export const hotwordCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('hotword')
    .setDescription('文字起こし用のホットワード（専門用語）を管理します（管理者のみ）')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand((subcommand) =>
      subcommand
        .setName('add')
        .setDescription('ホットワードを追加します')
        .addStringOption((option) =>
          option
            .setName('word')
            .setDescription('追加する専門用語')
            .setRequired(true)
            .setMaxLength(50)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('remove')
        .setDescription('ホットワードを削除します')
        .addStringOption((option) =>
          option
            .setName('word')
            .setDescription('削除する専門用語')
            .setRequired(true)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand.setName('list').setDescription('現在のホットワード一覧を表示します')
    )
    .addSubcommand((subcommand) =>
      subcommand.setName('clear').setDescription('このサーバーのホットワードをすべて削除します')
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
      case 'add':
        await handleAdd(interaction, guild.id);
        break;
      case 'remove':
        await handleRemove(interaction, guild.id);
        break;
      case 'list':
        await handleList(interaction, guild.id);
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

async function handleAdd(
  interaction: ChatInputCommandInteraction,
  guildId: string
): Promise<void> {
  const word = interaction.options.getString('word', true);

  const result = guildHotwords.addHotword(guildId, word, interaction.user.id);

  if (result.success) {
    logger.info(`Hotword added by user ${interaction.user.id} in guild ${guildId}: "${word}"`);
    await interaction.reply({
      content: `✅ ホットワード「${word.trim()}」を追加しました`,
      ephemeral: true,
    });
  } else {
    await interaction.reply({
      content: `❌ ${result.error}`,
      ephemeral: true,
    });
  }
}

async function handleRemove(
  interaction: ChatInputCommandInteraction,
  guildId: string
): Promise<void> {
  const word = interaction.options.getString('word', true);

  // デフォルトに含まれているかチェック
  const defaultHotwords = guildHotwords.getDefaultHotwords();
  if (defaultHotwords.includes(word.trim())) {
    await interaction.reply({
      content: '❌ デフォルトのホットワードは削除できません',
      ephemeral: true,
    });
    return;
  }

  const removed = guildHotwords.removeHotword(guildId, word);

  if (removed) {
    logger.info(`Hotword removed by user ${interaction.user.id} in guild ${guildId}: "${word}"`);
    await interaction.reply({
      content: `✅ ホットワード「${word.trim()}」を削除しました`,
      ephemeral: true,
    });
  } else {
    await interaction.reply({
      content: `❌ 「${word.trim()}」はこのサーバーのホットワードに登録されていません`,
      ephemeral: true,
    });
  }
}

async function handleList(
  interaction: ChatInputCommandInteraction,
  guildId: string
): Promise<void> {
  const defaultHotwords = guildHotwords.getDefaultHotwords();
  const guildSpecific = guildHotwords.getHotwords(guildId);

  let message = '📋 **ホットワード一覧**\n\n';

  message += `**デフォルト (${defaultHotwords.length}件)**\n`;
  if (defaultHotwords.length > 0) {
    // 長すぎる場合は省略
    if (defaultHotwords.length > 20) {
      const shown = defaultHotwords.slice(0, 20);
      message += `\`${shown.join('`, `')}\` ... 他${defaultHotwords.length - 20}件\n\n`;
    } else {
      message += `\`${defaultHotwords.join('`, `')}\`\n\n`;
    }
  } else {
    message += '_なし_\n\n';
  }

  message += `**このサーバー固有 (${guildSpecific.length}件)**\n`;
  if (guildSpecific.length > 0) {
    message += `\`${guildSpecific.join('`, `')}\`\n`;
  } else {
    message += '_なし_\n';
  }

  message += '\n---\n';
  message += '💡 ホットワードは文字起こし精度向上のため、Whisperに専門用語として通知されます';

  await interaction.reply({
    content: message,
    ephemeral: true,
  });
}

async function handleClear(
  interaction: ChatInputCommandInteraction,
  guildId: string
): Promise<void> {
  const hadHotwords = guildHotwords.hasHotwords(guildId);

  if (!hadHotwords) {
    await interaction.reply({
      content: '📭 このサーバーには固有のホットワードが設定されていません',
      ephemeral: true,
    });
    return;
  }

  guildHotwords.clearHotwords(guildId);
  logger.info(`Hotwords cleared by user ${interaction.user.id} in guild ${guildId}`);

  await interaction.reply({
    content: '✅ このサーバーのホットワードをすべて削除しました\n📌 デフォルトのホットワードは引き続き使用されます',
    ephemeral: true,
  });
}
