import {
  VoiceConnection,
  VoiceConnectionStatus,
  entersState,
} from "@discordjs/voice";
import { TextChannel } from "discord.js";
import { logger } from "../utils/logger.js";
import { VoiceReceiverHandler } from "./receiver.js";
import { TranscriptionService } from "../services/transcription-service.js";
import { formatDuration } from "../utils/time.js";

/**
 * 自動離脱設定
 */
export interface AutoLeaveConfig {
  enabled: boolean;
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
  };

  /**
   * 自動離脱設定を更新
   */
  setAutoLeaveConfig(config: Partial<AutoLeaveConfig>): void {
    this.autoLeaveConfig = { ...this.autoLeaveConfig, ...config };
    logger.info(
      `Auto-leave config updated: enabled=${this.autoLeaveConfig.enabled}`,
    );
  }

  /**
   * ボイスチャンネルが空になった時に即時離脱を実行
   */
  async handleEmptyChannel(guildId: string): Promise<void> {
    if (!this.autoLeaveConfig.enabled) return;

    const info = this.connections.get(guildId);
    if (!info) return;

    logger.info(
      `Voice channel empty in guild ${guildId}. Auto-leaving after queue drain.`,
    );

    // 処理中の文字起こしが完了するまで待機（最大30秒）
    if (info.transcriptionService) {
      const queueStatus = info.transcriptionService.getQueueStatus();
      if (queueStatus.queued > 0 || queueStatus.processing > 0) {
        logger.info(
          `Waiting for ${queueStatus.queued} queued + ${queueStatus.processing} processing items to complete`,
        );
        await info.transcriptionService.waitForQueueDrain(30000);
      }
    }

    // セッションサマリーレポートを生成して送信
    await this.sendSessionReport(guildId, info);

    // 接続を切断
    await this.removeConnection(guildId);
  }

  /**
   * セッション終了レポートを出力チャンネルに送信
   */
  private async sendSessionReport(
    guildId: string,
    info: ConnectionInfo,
  ): Promise<void> {
    if (!info.outputChannel) {
      logger.debug(
        `No output channel for guild ${guildId}, skipping session report`,
      );
      return;
    }

    try {
      // セッション時間を計算
      const sessionDuration = Date.now() - info.startedAt.getTime();
      const formattedDuration = formatDuration(sessionDuration);

      // 統計情報を取得
      const stats = info.transcriptionService?.getStatus();

      let message = `🔇 **自動退出** - ボイスチャンネルが空になりました\n`;
      message += `📍 チャンネル: **${info.channelName}**\n`;
      message += `⏱️ セッション時間: **${formattedDuration}**`;

      // 文字起こし統計を追加
      if (stats?.metrics) {
        const { totalRequests, successfulRequests } = stats.metrics;
        if (totalRequests > 0) {
          message += `\n📊 文字起こし: **${successfulRequests}件** (成功率: ${Math.round((successfulRequests / totalRequests) * 100)}%)`;
        }
      }

      await info.outputChannel.send(message);

      logger.info(`Session report sent for guild ${guildId}`, {
        channelName: info.channelName,
        duration: formattedDuration,
      });
    } catch (error) {
      logger.error(`Failed to send session report for guild ${guildId}`, {
        error,
      });
    }
  }

  /**
   * 自動離脱タイマーを開始（後方互換性のため維持、即時実行）
   * @deprecated Use handleEmptyChannel instead
   */
  startAutoLeaveTimer(guildId: string): void {
    // 即時実行に変更
    this.handleEmptyChannel(guildId);
  }

  /**
   * 自動離脱タイマーをキャンセル（後方互換性のため維持）
   * @deprecated No longer needed with immediate auto-leave
   */
  cancelAutoLeaveTimer(guildId: string): void {
    const info = this.connections.get(guildId);
    if (info?.autoLeaveTimer) {
      clearTimeout(info.autoLeaveTimer);
      info.autoLeaveTimer = undefined;
      logger.debug(`Cleared auto-leave timer for guild ${guildId}`);
    }
  }

  /**
   * 接続を追加
   */
  addConnection(
    guildId: string,
    info: Omit<ConnectionInfo, "transcriptionCount">,
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
          `Voice connection lost in guild ${guildId}. Could not reconnect.`,
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
  setTranscriptionService(
    guildId: string,
    service: TranscriptionService,
  ): void {
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
          error,
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
    logger.info("Removed all voice connections");
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
