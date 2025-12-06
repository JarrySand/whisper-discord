import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
} from 'discord.js';
import type { Command } from '../types/index.js';
import { connectionManager } from '../voice/connection.js';
import { formatDuration } from '../utils/time.js';

export const statusCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('status')
    .setDescription('現在の文字起こし状態を表示します') as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const guild = interaction.guild;
    if (!guild) {
      await interaction.reply({
        content: '❌ このコマンドはサーバー内でのみ使用できます',
        ephemeral: true,
      });
      return;
    }

    const connectionInfo = connectionManager.getConnection(guild.id);

    if (!connectionInfo) {
      await interaction.reply({
        content: '📊 Botは現在ボイスチャンネルに参加していません',
        ephemeral: true,
      });
      return;
    }

    // チャンネル情報を取得
    const voiceChannel = guild.channels.cache.get(connectionInfo.channelId);
    const outputChannel = connectionInfo.outputChannelId
      ? guild.channels.cache.get(connectionInfo.outputChannelId)
      : null;

    // セッション時間を計算
    const sessionDuration = Date.now() - connectionInfo.startedAt.getTime();
    const formattedDuration = formatDuration(sessionDuration);

    // VCの参加者数を取得
    let memberCount = 0;
    if (voiceChannel && 'members' in voiceChannel) {
      const members = voiceChannel.members;
      if ('size' in members) {
        memberCount = members.size;
      }
    }

    // 文字起こしサービスの状態を取得
    const transcriptionService = connectionManager.getTranscriptionService(guild.id);
    const serviceStatus = transcriptionService?.getStatus();

    // Whisper API ステータス
    let whisperStatus = '未接続';
    let whisperColor = 0xffff00; // 黄色
    if (serviceStatus) {
      if (serviceStatus.health.isHealthy) {
        whisperStatus = '✅ 正常';
        whisperColor = 0x00ff00; // 緑
      } else if (serviceStatus.circuitBreaker.state === 'OPEN') {
        whisperStatus = '🔴 サーキットブレーカー発動中';
        whisperColor = 0xff0000; // 赤
      } else {
        whisperStatus = '⚠️ 不安定';
        whisperColor = 0xffa500; // オレンジ
      }
    }

    // メトリクス
    const metrics = serviceStatus?.metrics;
    const successRate = metrics && metrics.totalRequests > 0
      ? Math.round((metrics.successfulRequests / metrics.totalRequests) * 100)
      : 100;
    const avgProcessingTime = metrics?.avgProcessingTimeMs
      ? `${Math.round(metrics.avgProcessingTimeMs)}ms`
      : '-';

    // Embed を作成
    const embed = new EmbedBuilder()
      .setColor(whisperColor)
      .setTitle('📊 文字起こしステータス')
      .addFields(
        {
          name: '🎤 ボイスチャンネル',
          value: voiceChannel ? voiceChannel.name : '不明',
          inline: true,
        },
        {
          name: '👥 参加者数',
          value: `${memberCount}人`,
          inline: true,
        },
        {
          name: '⏱️ セッション時間',
          value: formattedDuration,
          inline: true,
        },
        {
          name: '📝 出力先',
          value: outputChannel ? `<#${outputChannel.id}>` : 'なし（ログのみ）',
          inline: true,
        },
        {
          name: '🔊 文字起こし数',
          value: `${metrics?.successfulRequests ?? 0}件`,
          inline: true,
        },
        {
          name: '💾 Whisper API',
          value: whisperStatus,
          inline: true,
        },
        {
          name: '📈 成功率',
          value: `${successRate}%`,
          inline: true,
        },
        {
          name: '⚡ 平均処理時間',
          value: avgProcessingTime,
          inline: true,
        },
        {
          name: '📋 キュー',
          value: `${serviceStatus?.queue.queued ?? 0}件待機`,
          inline: true,
        }
      )
      .setTimestamp();

    // 出力パス情報（存在する場合）
    if (serviceStatus?.outputPaths) {
      const paths = serviceStatus.outputPaths;
      if (paths.log || paths.json || paths.markdown) {
        let pathText = '';
        if (paths.log) pathText += `📄 Log: \`${paths.log}\`\n`;
        if (paths.json) pathText += `📊 JSON: \`${paths.json}\`\n`;
        if (paths.markdown) pathText += `📝 MD: \`${paths.markdown}\``;
        embed.addFields({
          name: '📁 出力ファイル',
          value: pathText || 'なし',
          inline: false,
        });
      }
    }

    await interaction.reply({ embeds: [embed] });
  },
};

