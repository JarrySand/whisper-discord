import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
} from 'discord.js';
import type { Command } from '../types/index.js';
import { logger } from '../utils/logger.js';
import { connectionManager } from '../voice/connection.js';
import { formatDuration } from '../utils/time.js';

export const leaveCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('leave')
    .setDescription('Botをボイスチャンネルから離脱させます')
    .addBooleanOption((option) =>
      option
        .setName('save')
        .setDescription('セッションログを保存するか（デフォルト: true）')
        .setRequired(false)
    ) as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply();

    const guild = interaction.guild;
    if (!guild) {
      await interaction.editReply('❌ このコマンドはサーバー内でのみ使用できます');
      return;
    }

    // 接続を確認
    const connectionInfo = connectionManager.getConnection(guild.id);
    if (!connectionInfo) {
      await interaction.editReply('❌ Botはボイスチャンネルに参加していません');
      return;
    }

    // 保存オプション（将来的に使用）
    // const saveLog = interaction.options.getBoolean('save') ?? true;

    try {
      // セッション時間を計算
      const sessionDuration = Date.now() - connectionInfo.startedAt.getTime();
      const formattedDuration = formatDuration(sessionDuration);

      // 文字起こしサービスの統計を取得
      const transcriptionService = connectionManager.getTranscriptionService(guild.id);
      const stats = transcriptionService?.getStatus();

      // 接続を切断（文字起こしサービスの停止も含む）
      await connectionManager.removeConnection(guild.id);

      logger.info(
        `Left voice channel in guild ${guild.name}. Session duration: ${formattedDuration}`
      );

      let message = `✅ ボイスチャンネルから離脱しました\n⏱️ セッション時間: ${formattedDuration}`;

      // 統計情報を追加
      if (stats?.metrics) {
        const { totalRequests, successfulRequests } = stats.metrics;
        if (totalRequests > 0) {
          message += `\n📊 文字起こし数: ${successfulRequests}/${totalRequests}`;
        }
      }

      // 出力ファイルパスを追加
      if (stats?.outputPaths) {
        const paths = stats.outputPaths;
        if (paths.log || paths.json || paths.markdown) {
          message += '\n📁 ログファイル:';
          if (paths.log) message += `\n  • ${paths.log}`;
          if (paths.json) message += `\n  • ${paths.json}`;
          if (paths.markdown) message += `\n  • ${paths.markdown}`;
        }
      }

      await interaction.editReply(message);
    } catch (error) {
      logger.error('Failed to leave voice channel:', error);
      await interaction.editReply('❌ ボイスチャンネルからの離脱に失敗しました');
    }
  },
};

