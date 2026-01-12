import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  ChannelType,
  GuildMember,
  TextChannel,
} from 'discord.js';
import {
  joinVoiceChannel,
  VoiceConnectionStatus,
  entersState,
} from '@discordjs/voice';
import type { Command } from '../types/index.js';
import { logger } from '../utils/logger.js';
import { botConfig } from '../config/index.js';
import { connectionManager } from '../voice/connection.js';
import { VoiceReceiverHandler } from '../voice/receiver.js';
import { TranscriptionService } from '../services/transcription-service.js';
import { guildSettings } from '../services/guild-settings.js';
import { getSqliteStoreManager } from './index.js';

export const joinCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('join')
    .setDescription('Botをボイスチャンネルに参加させます')
    .addChannelOption((option) =>
      option
        .setName('channel')
        .setDescription('参加するボイスチャンネル（省略時は実行者のVC）')
        .addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice)
        .setRequired(false)
    )
    .addChannelOption((option) =>
      option
        .setName('output_channel')
        .setDescription('文字起こし結果を投稿するテキストチャンネル')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(false)
    ) as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply();

    const guild = interaction.guild;
    if (!guild) {
      await interaction.editReply('❌ このコマンドはサーバー内でのみ使用できます');
      return;
    }

    // 参加するチャンネルを決定
    let voiceChannel = interaction.options.getChannel('channel');

    if (!voiceChannel) {
      // オプションがない場合は実行者のVCを使用
      const member = interaction.member as GuildMember;
      voiceChannel = member.voice.channel;

      if (!voiceChannel) {
        await interaction.editReply(
          '❌ ボイスチャンネルに参加してからコマンドを実行するか、チャンネルを指定してください'
        );
        return;
      }
    }

    // チャンネルタイプを確認
    if (
      voiceChannel.type !== ChannelType.GuildVoice &&
      voiceChannel.type !== ChannelType.GuildStageVoice
    ) {
      await interaction.editReply('❌ 指定されたチャンネルはボイスチャンネルではありません');
      return;
    }

    // 出力チャンネルを決定
    // 1. コマンドで指定された場合はそれを使用し、設定に保存
    // 2. 指定されていない場合は保存された設定を使用
    let outputChannel = interaction.options.getChannel('output_channel');
    let usedSavedSetting = false;

    if (outputChannel) {
      // コマンドで指定された場合は設定に保存
      guildSettings.setDefaultOutputChannel(
        guild.id,
        outputChannel.id,
        outputChannel.name ?? undefined,
        guild.name
      );
    } else {
      // 保存された設定を使用
      const savedChannel = guildSettings.getDefaultOutputChannel(guild.id);
      if (savedChannel) {
        try {
          const fetchedChannel = await guild.channels.fetch(savedChannel.channelId);
          if (fetchedChannel && fetchedChannel.type === ChannelType.GuildText) {
            outputChannel = fetchedChannel;
            usedSavedSetting = true;
            logger.info(`Using saved output channel for guild ${guild.id}: ${savedChannel.channelName ?? savedChannel.channelId}`);
          } else {
            // チャンネルが存在しないか、テキストチャンネルでない場合は設定をクリア
            guildSettings.clearDefaultOutputChannel(guild.id);
            logger.warn(`Saved output channel ${savedChannel.channelId} no longer valid, cleared setting`);
          }
        } catch (error) {
          // チャンネル取得に失敗した場合は設定をクリア
          guildSettings.clearDefaultOutputChannel(guild.id);
          logger.warn(`Failed to fetch saved output channel ${savedChannel.channelId}, cleared setting:`, error);
        }
      }
    }

    // すでに接続中か確認
    if (connectionManager.hasConnection(guild.id)) {
      await interaction.editReply('❌ すでにボイスチャンネルに参加しています');
      return;
    }

    try {
      // ボイスチャンネルに参加
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any
      const connection = joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: guild.id,
        adapterCreator: guild.voiceAdapterCreator as any,
        selfDeaf: false, // 音声を受信するため false
        selfMute: true, // Bot は発言しない
      });

      // 接続完了を待機
      await entersState(connection, VoiceConnectionStatus.Ready, 20_000);

      // 出力チャンネルを取得
      const textChannel = outputChannel
        ? (await guild.channels.fetch(outputChannel.id)) as TextChannel
        : undefined;

      // 接続を管理に追加
      connectionManager.addConnection(guild.id, {
        connection,
        channelId: voiceChannel.id,
        channelName: voiceChannel.name ?? 'Unknown',
        guildName: guild.name,
        outputChannelId: outputChannel?.id,
        outputChannel: textChannel,
        startedAt: new Date(),
      });

      // 音声受信ハンドラを設定
      const receiverHandler = new VoiceReceiverHandler(connection, guild);
      connectionManager.setReceiverHandler(guild.id, receiverHandler);

      // 文字起こしサービスを初期化（Guild別APIキー対応）
      const transcriptionService = new TranscriptionService({
        whisper: {
          baseUrl: botConfig.whisper.apiUrl,
          timeout: botConfig.whisper.timeout,
          retryCount: botConfig.whisper.retryCount,
          retryDelay: botConfig.whisper.retryDelay,
        },
        offline: {
          directory: botConfig.output.logDir,
        },
        output: {
          discord: {
            enabled: botConfig.output.enableDiscordPost,
            config: botConfig.output.discord,
          },
          fileLog: {
            enabled: botConfig.output.enableFileLog,
            config: {
              baseDir: botConfig.output.logDir,
            },
          },
          jsonStore: {
            enabled: botConfig.output.enableJsonStore,
            config: {
              baseDir: botConfig.output.logDir,
            },
          },
          markdown: {
            enabled: botConfig.output.enableMarkdown,
            config: {
              baseDir: botConfig.output.logDir,
            },
          },
          sqlite: {
            enabled: botConfig.output.enableSqlite,
            config: {
              dbDir: botConfig.output.sqliteDbDir,
              cleanupDays: botConfig.output.sqliteCleanupDays,
            },
          },
        },
      }, guild.id);

      // bot.tsのSqliteStoreManagerをOutputManagerに共有（検索機能と同一インスタンスを使用）
      const sharedSqliteManager = getSqliteStoreManager();
      if (sharedSqliteManager && transcriptionService.getOutputManager()) {
        transcriptionService.getOutputManager()!.setSqliteStoreManager(sharedSqliteManager);
      }

      // 文字起こしサービスを開始
      await transcriptionService.start({
        guildId: guild.id,
        guildName: guild.name,
        channelId: voiceChannel.id,
        channelName: voiceChannel.name ?? 'Unknown',
        outputChannelId: outputChannel?.id,
        outputChannel: textChannel,
        startedAt: new Date(),
        participants: new Map(),
      });

      connectionManager.setTranscriptionService(guild.id, transcriptionService);

      // バッファマネージャーにコールバックを設定
      const bufferManager = receiverHandler.getBufferManager();
      bufferManager.onSegment(async (segment) => {
        await transcriptionService.transcribe(segment);
      });

      logger.info(
        `Joined voice channel: ${voiceChannel.name} (${voiceChannel.id}) in guild ${guild.name}`
      );
      logger.info('Voice receiver handler and transcription service started');

      let message = `✅ ボイスチャンネル「${voiceChannel.name}」に参加しました\n🎤 文字起こしを開始します`;

      if (outputChannel) {
        if (usedSavedSetting) {
          message += `\n📝 文字起こし結果は <#${outputChannel.id}> に投稿されます（保存済み設定）`;
        } else {
          message += `\n📝 文字起こし結果は <#${outputChannel.id}> に投稿されます（設定を保存しました）`;
        }
      } else {
        message += `\n💡 次回から自動で投稿先を指定するには、\`/join output_channel:#チャンネル名\` で設定してください`;
      }

      await interaction.editReply(message);
    } catch (error) {
      logger.error('Failed to join voice channel:', error);
      await interaction.editReply(
        '❌ ボイスチャンネルへの参加に失敗しました。権限を確認してください'
      );
    }
  },
};

