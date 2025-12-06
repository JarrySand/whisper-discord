import {
  VoiceConnection,
  VoiceConnectionStatus,
  entersState,
} from '@discordjs/voice';
import { TextChannel } from 'discord.js';
import { logger } from '../utils/logger.js';
import { VoiceReceiverHandler } from './receiver.js';
import { TranscriptionService } from '../services/transcription-service.js';

/**
 * 自動離脱設定
 */
export interface AutoLeaveConfig {
  enabled: boolean;
  timeoutMs: number; // デフォルト: 10分 = 600000ms
}

/**
 * 接続情報
 */
export interface ConnectionInfo {
  connection: VoiceConnection;
  channelId: string;
  channelName: string;
  guildName: string;
  outputChannelId?: string;
  outputChannel?: TextChannel;
  startedAt: Date;
  transcriptionCount: number;
  receiverHandler?: VoiceReceiverHandler;
  transcriptionService?: TranscriptionService;
  autoLeaveTimer?: NodeJS.Timeout;
}

/**
 * VoiceConnection 管理クラス
 */
class VoiceConnectionManager {
  private connections = new Map<string, ConnectionInfo>();
  private autoLeaveConfig: AutoLeaveConfig = {
    enabled: true,
    timeoutMs: 10 * 60 * 1000, // 10分
  };

  /**
   * 自動離脱設定を更新
   */
  setAutoLeaveConfig(config: Partial<AutoLeaveConfig>): void {
    this.autoLeaveConfig = { ...this.autoLeaveConfig, ...config };
    logger.info(`Auto-leave config updated: enabled=${this.autoLeaveConfig.enabled}, timeout=${this.autoLeaveConfig.timeoutMs}ms`);
  }

  /**
   * 自動離脱タイマーを開始
   */
  startAutoLeaveTimer(guildId: string): void {
    if (!this.autoLeaveConfig.enabled) return;

    const info = this.connections.get(guildId);
    if (!info) return;

    // 既存のタイマーがあればクリア
    this.cancelAutoLeaveTimer(guildId);

    logger.info(`Starting auto-leave timer for guild ${guildId} (${this.autoLeaveConfig.timeoutMs / 1000}s)`);

    info.autoLeaveTimer = setTimeout(async () => {
      logger.info(`Auto-leave timer expired for guild ${guildId}. Leaving voice channel.`);
      await this.removeConnection(guildId);
    }, this.autoLeaveConfig.timeoutMs);
  }

  /**
   * 自動離脱タイマーをキャンセル
   */
  cancelAutoLeaveTimer(guildId: string): void {
    const info = this.connections.get(guildId);
    if (info?.autoLeaveTimer) {
      clearTimeout(info.autoLeaveTimer);
      info.autoLeaveTimer = undefined;
      logger.info(`Cancelled auto-leave timer for guild ${guildId}`);
    }
  }

  /**
   * 接続を追加
   */
  addConnection(
    guildId: string,
    info: Omit<ConnectionInfo, 'transcriptionCount'>
  ): void {
    const connectionInfo: ConnectionInfo = {
      ...info,
      transcriptionCount: 0,
    };

    // 切断イベントのハンドリング
    info.connection.on(VoiceConnectionStatus.Disconnected, async () => {
      try {
        // 再接続を試みる（5秒以内）
        await Promise.race([
          entersState(info.connection, VoiceConnectionStatus.Signalling, 5_000),
          entersState(info.connection, VoiceConnectionStatus.Connecting, 5_000),
        ]);
        logger.info(`Reconnecting to voice channel in guild ${guildId}`);
      } catch {
        // 再接続失敗 → 切断
        logger.warn(
          `Voice connection lost in guild ${guildId}. Could not reconnect.`
        );
        this.removeConnection(guildId);
      }
    });

    // 破棄イベントのハンドリング
    info.connection.on(VoiceConnectionStatus.Destroyed, () => {
      logger.info(`Voice connection destroyed in guild ${guildId}`);
      this.connections.delete(guildId);
    });

    this.connections.set(guildId, connectionInfo);
    logger.info(`Added voice connection for guild ${guildId}`);
  }

  /**
   * 接続を取得
   */
  getConnection(guildId: string): ConnectionInfo | undefined {
    return this.connections.get(guildId);
  }

  /**
   * 接続があるか確認
   */
  hasConnection(guildId: string): boolean {
    return this.connections.has(guildId);
  }

  /**
   * 音声受信ハンドラを設定
   */
  setReceiverHandler(guildId: string, handler: VoiceReceiverHandler): void {
    const info = this.connections.get(guildId);
    if (info) {
      info.receiverHandler = handler;
      
      // DAVE エラー時の接続リセットハンドリング
      handler.on('connectionResetRequired', async (data: { guildId: string; reason: string; lastError: string }) => {
        logger.warn('Connection reset required due to DAVE error', data);
        
        // 出力チャンネルに通知
        const connectionInfo = this.connections.get(data.guildId);
        if (connectionInfo?.outputChannel) {
          try {
            await connectionInfo.outputChannel.send(
              `⚠️ **音声デコードエラーが発生しました**\n` +
              `暗号化の不整合により音声が正常に受信できません。\n` +
              `\`/leave\` して30秒以上待ってから \`/join\` してください。`
            );
          } catch (err) {
            logger.error('Failed to send DAVE error notification', { error: err });
          }
        }
      });
      
      logger.info(`Set voice receiver handler for guild ${guildId}`);
    }
  }

  /**
   * 音声受信ハンドラを取得
   */
  getReceiverHandler(guildId: string): VoiceReceiverHandler | undefined {
    return this.connections.get(guildId)?.receiverHandler;
  }

  /**
   * 文字起こしサービスを設定
   */
  setTranscriptionService(guildId: string, service: TranscriptionService): void {
    const info = this.connections.get(guildId);
    if (info) {
      info.transcriptionService = service;
      logger.info(`Set transcription service for guild ${guildId}`);
    }
  }

  /**
   * 文字起こしサービスを取得
   */
  getTranscriptionService(guildId: string): TranscriptionService | undefined {
    return this.connections.get(guildId)?.transcriptionService;
  }

  /**
   * 接続を削除
   */
  async removeConnection(guildId: string): Promise<void> {
    const info = this.connections.get(guildId);
    if (info) {
      try {
        // 自動離脱タイマーをクリア
        this.cancelAutoLeaveTimer(guildId);
        // 文字起こしサービスを停止
        if (info.transcriptionService) {
          await info.transcriptionService.stop();
        }
        // 音声受信ハンドラをクリーンアップ
        if (info.receiverHandler) {
          info.receiverHandler.cleanup();
        }
        info.connection.destroy();
      } catch (error) {
        logger.error(
          `Error destroying voice connection for guild ${guildId}:`,
          error
        );
      }
      this.connections.delete(guildId);
      logger.info(`Removed voice connection for guild ${guildId}`);
    }
  }

  /**
   * すべての接続を削除
   */
  async removeAllConnections(): Promise<void> {
    for (const guildId of this.connections.keys()) {
      await this.removeConnection(guildId);
    }
    logger.info('Removed all voice connections');
  }

  /**
   * 文字起こしカウントを増加
   */
  incrementTranscriptionCount(guildId: string): void {
    const info = this.connections.get(guildId);
    if (info) {
      info.transcriptionCount++;
    }
  }

  /**
   * 接続数を取得
   */
  get size(): number {
    return this.connections.size;
  }
}

// シングルトンインスタンス
export const connectionManager = new VoiceConnectionManager();

