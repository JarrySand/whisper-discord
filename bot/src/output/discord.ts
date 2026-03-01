/**
 * Discord チャンネル出力サービス
 * - リアルタイムで文字起こし結果をDiscordチャンネルに投稿
 * - 複数のフォーマット（standard/compact/embed）をサポート
 * - バッチ処理とレート制限対策
 */
import { TextChannel, EmbedBuilder } from "discord.js";
import { logger } from "../utils/logger.js";
import type {
  TranscriptionResult,
  DiscordOutputConfig,
} from "../types/index.js";

/**
 * デフォルト設定
 */
const defaultConfig: DiscordOutputConfig = {
  format: "standard",
  showTimestamp: true,
  showConfidence: false,
  batchMessages: true,
  batchIntervalMs: 3000,
};

/**
 * レート制限ハンドラ
 */
class RateLimitHandler {
  private lastSendTime = 0;
  private readonly minInterval = 1000; // 1秒間隔

  async waitIfNeeded(): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.lastSendTime;

    if (elapsed < this.minInterval) {
      await new Promise((r) => setTimeout(r, this.minInterval - elapsed));
    }

    this.lastSendTime = Date.now();
  }
}

/**
 * Discord出力サービス
 */
export class DiscordOutputService {
  private config: DiscordOutputConfig;
  private channel: TextChannel | null = null;
  private messageQueue: TranscriptionResult[] = [];
  private batchTimer: NodeJS.Timeout | null = null;
  private rateLimitHandler: RateLimitHandler;

  constructor(config: Partial<DiscordOutputConfig> = {}) {
    this.config = { ...defaultConfig, ...config };
    this.rateLimitHandler = new RateLimitHandler();
    logger.debug("DiscordOutputService initialized", { config: this.config });
  }

  /**
   * 出力チャンネルを設定
   */
  setChannel(channel: TextChannel): void {
    this.channel = channel;
    logger.debug("Discord output channel set", {
      channelId: channel.id,
      channelName: channel.name,
    });
  }

  /**
   * チャンネルを取得
   */
  getChannel(): TextChannel | null {
    return this.channel;
  }

  /**
   * 文字起こし結果を投稿
   */
  async post(result: TranscriptionResult): Promise<void> {
    if (!this.channel) {
      logger.warn("Output channel not set, skipping Discord post");
      return;
    }

    if (this.config.batchMessages) {
      this.queueMessage(result);
    } else {
      await this.sendSingle(result);
    }
  }

  /**
   * 単一メッセージを送信
   */
  private async sendSingle(result: TranscriptionResult): Promise<void> {
    if (!this.channel) return;

    try {
      await this.rateLimitHandler.waitIfNeeded();

      if (this.config.format === "embed") {
        await this.postEmbed(result);
      } else {
        const content = this.formatMessage(result);
        await this.channel.send(content);
      }
    } catch (error) {
      logger.error("Failed to send Discord message", { error });
    }
  }

  /**
   * メッセージをキューに追加
   */
  private queueMessage(result: TranscriptionResult): void {
    this.messageQueue.push(result);

    if (!this.batchTimer) {
      this.batchTimer = setTimeout(
        () => this.flushQueue(),
        this.config.batchIntervalMs,
      );
    }
  }

  /**
   * キューをフラッシュして送信
   */
  private async flushQueue(): Promise<void> {
    this.batchTimer = null;

    if (this.messageQueue.length === 0 || !this.channel) return;

    const messages = [...this.messageQueue];
    this.messageQueue = [];

    try {
      await this.rateLimitHandler.waitIfNeeded();

      // Embed形式の場合は個別送信
      if (this.config.format === "embed") {
        for (const msg of messages) {
          await this.postEmbed(msg);
        }
        return;
      }

      // 複数メッセージを結合
      const content = messages.map((r) => this.formatMessage(r)).join("\n\n");

      // Discord の文字数制限 (2000文字) を考慮
      if (content.length <= 2000) {
        await this.channel.send(content);
      } else {
        // 分割送信
        await this.sendChunked(messages);
      }
    } catch (error) {
      logger.error("Failed to flush Discord message queue", { error });
    }
  }

  /**
   * チャンク分割して送信
   */
  private async sendChunked(messages: TranscriptionResult[]): Promise<void> {
    if (!this.channel) return;

    let chunk = "";
    for (const msg of messages) {
      const formatted = this.formatMessage(msg);

      if (chunk.length + formatted.length + 2 > 2000) {
        // 現在のチャンクを送信
        if (chunk) {
          await this.rateLimitHandler.waitIfNeeded();
          await this.channel.send(chunk);
        }
        chunk = formatted;
      } else {
        chunk = chunk ? `${chunk}\n\n${formatted}` : formatted;
      }
    }

    // 残りを送信
    if (chunk) {
      await this.rateLimitHandler.waitIfNeeded();
      await this.channel.send(chunk);
    }
  }

  /**
   * メッセージをフォーマット
   */
  private formatMessage(result: TranscriptionResult): string {
    switch (this.config.format) {
      case "compact":
        return this.formatCompact(result);
      case "standard":
      default:
        return this.formatStandard(result);
    }
  }

  /**
   * 標準フォーマット
   * **Alice** <t:1733389200:T>
   * こんにちは
   */
  private formatStandard(result: TranscriptionResult): string {
    const displayName = result.displayName ?? result.username;
    const timestamp = this.config.showTimestamp
      ? ` <t:${Math.floor(result.startTs / 1000)}:T>`
      : "";

    let text = `**${displayName}**${timestamp}\n${result.text}`;

    if (this.config.showConfidence) {
      const confidencePercent = Math.round(result.confidence * 100);
      text += ` _(${confidencePercent}%)_`;
    }

    return text;
  }

  /**
   * コンパクトフォーマット
   * [10:23:14] Alice: こんにちは
   */
  private formatCompact(result: TranscriptionResult): string {
    const time = new Date(result.startTs).toTimeString().slice(0, 8);
    const displayName = result.displayName ?? result.username;
    return `[${time}] ${displayName}: ${result.text}`;
  }

  /**
   * Embed形式で投稿
   */
  async postEmbed(result: TranscriptionResult): Promise<void> {
    if (!this.channel) return;

    const displayName = result.displayName ?? result.username;

    const embed = new EmbedBuilder()
      .setAuthor({
        name: displayName,
      })
      .setDescription(result.text)
      .setTimestamp(result.startTs)
      .setColor(0x5865f2);

    if (this.config.showConfidence) {
      embed.setFooter({
        text: `Confidence: ${Math.round(result.confidence * 100)}%`,
      });
    }

    await this.channel.send({ embeds: [embed] });
  }

  /**
   * 保留中のメッセージを強制フラッシュ
   */
  async flush(): Promise<void> {
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }
    await this.flushQueue();
  }

  /**
   * サービスを停止
   */
  async stop(): Promise<void> {
    await this.flush();
    this.channel = null;
    logger.debug("DiscordOutputService stopped");
  }
}

export default DiscordOutputService;
