import {
  VoiceConnection,
  VoiceReceiver,
  EndBehaviorType,
} from "@discordjs/voice";
import { Guild } from "discord.js";
import { EventEmitter } from "events";
import { Readable } from "stream";
import prism from "prism-media";
import { SSRCMapper } from "./ssrc-mapper.js";
import { AudioBufferManager } from "../audio/buffer.js";
import { logger } from "../utils/logger.js";

/**
 * DAVE プロトコルエラーを検出
 */
function isDAVEError(error: Error): boolean {
  const message = error.message.toLowerCase();
  return (
    message.includes("corrupted") ||
    message.includes("compressed data") ||
    message.includes("encryption") ||
    message.includes("decrypt")
  );
}

/**
 * 音声受信ハンドラ
 */
export class VoiceReceiverHandler extends EventEmitter {
  private receiver: VoiceReceiver;
  private ssrcMapper: SSRCMapper;
  private bufferManager: AudioBufferManager;
  private activeStreams = new Map<string, Readable>();
  private activeDecoders = new Map<string, prism.opus.Decoder>();

  // DAVE デコーダーエラーからの復旧追跡
  private daveDecoderErrors = new Map<string, number>();
  private readonly maxDecoderRecoveries = 10;

  // opusStream レベルのエラー後の再購読
  private resubscribeTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly resubscribeDelay = 1000; // 1秒後に再購読

  constructor(
    connection: VoiceConnection,
    private guild: Guild,
  ) {
    super();
    this.receiver = connection.receiver;
    this.ssrcMapper = new SSRCMapper();
    this.bufferManager = new AudioBufferManager();
    this.setupEventHandlers();
  }

  /**
   * イベントハンドラを設定
   */
  private setupEventHandlers(): void {
    // ユーザーが話し始めた時
    this.receiver.speaking.on("start", (userId: string) => {
      void this.handleSpeakingStart(userId);
    });

    // ユーザーが話し終わった時
    this.receiver.speaking.on("end", (userId: string) => {
      this.handleSpeakingEnd(userId);
    });
  }

  /**
   * 発話開始時の処理
   */
  private async handleSpeakingStart(userId: string): Promise<void> {
    // すでにストリームがある場合はスキップ
    if (this.activeStreams.has(userId)) {
      return;
    }

    // GuildMember を取得（キャッシュになければAPIから取得）
    const member =
      this.guild.members.cache.get(userId) ??
      (await this.guild.members.fetch(userId).catch(() => null));
    if (!member) {
      logger.warn(`Could not find member for userId: ${userId}`);
      return;
    }

    // SSRC マッピングを登録（実際の SSRC は内部で管理されるため 0 を使用）
    this.ssrcMapper.register(0, userId, member);

    logger.debug(`User ${member.displayName} started speaking`);

    // 音声ストリームを購読
    const opusStream = this.receiver.subscribe(userId, {
      end: {
        behavior: EndBehaviorType.AfterSilence,
        duration: 1500,
      },
    });

    this.activeStreams.set(userId, opusStream);

    // デコーダーを作成してデータリレーを開始
    this.setupDecoder(userId, opusStream);

    // opusStream 終了時
    opusStream.on("end", () => {
      this.handleStreamEnd(userId);
      this.cleanupDecoder(userId);
    });

    // opusStream エラー時（購読レベルの問題）
    opusStream.on("error", (error: Error) => {
      if (isDAVEError(error)) {
        logger.warn(
          `DAVE stream error for user ${userId} - scheduling resubscribe`,
        );
        this.cleanupUserStream(userId);
        this.scheduleResubscribe(userId);
      } else {
        logger.error(`Opus stream error for user ${userId}:`, error);
        this.cleanupUserStream(userId);
      }
    });
  }

  /**
   * デコーダーをセットアップし、opusStream からの手動リレーを構成
   * pipe() を使わないことで、デコーダーエラー時にopusStreamを維持できる
   */
  private setupDecoder(userId: string, opusStream: Readable): void {
    this.cleanupDecoder(userId);

    const decoder = new prism.opus.Decoder({
      rate: 48000,
      channels: 2,
      frameSize: 960,
    });
    this.activeDecoders.set(userId, decoder);

    const userInfo = this.ssrcMapper.getByUserId(userId);

    // デコーダーからPCMデータを受信
    decoder.on("data", (pcmData: Buffer) => {
      if (userInfo) {
        // DAVE エラーカウントをリセット（正常復旧を確認）
        if (this.daveDecoderErrors.has(userId)) {
          const errorCount = this.daveDecoderErrors.get(userId)!;
          logger.info(
            `DAVE decoder recovered for user ${userId} after ${errorCount} errors`,
          );
          this.daveDecoderErrors.delete(userId);
        }
        this.bufferManager.appendAudio(
          userId,
          userInfo.username,
          userInfo.displayName,
          pcmData,
        );
      }
    });

    // デコーダーエラー時：デコーダーだけ差し替え、opusStreamは維持
    // デコーダー復旧中は connectionResetRequired を発火しない（復旧自体がエラーハンドリング）
    decoder.on("error", (error: Error) => {
      if (isDAVEError(error)) {
        const errorCount = (this.daveDecoderErrors.get(userId) ?? 0) + 1;
        this.daveDecoderErrors.set(userId, errorCount);

        if (errorCount >= this.maxDecoderRecoveries) {
          logger.warn(
            `Max DAVE decoder recoveries (${this.maxDecoderRecoveries}) reached for user ${userId}, will resubscribe`,
          );
          this.daveDecoderErrors.delete(userId);
          this.cleanupUserStream(userId);
          this.scheduleResubscribe(userId);
          return;
        }

        // 初回のみ warn、以降は debug
        if (errorCount === 1) {
          logger.warn(
            `DAVE decoder error for user ${userId}, replacing decoder`,
          );
        } else {
          logger.debug(
            `Replacing decoder for user ${userId} (${errorCount}/${this.maxDecoderRecoveries})`,
          );
        }
        this.setupDecoder(userId, opusStream);
      } else {
        logger.error(`Decoder error for user ${userId}:`, error);
      }
    });

    // opusStream → decoder への手動リレー（pipe不使用）
    const onData = (opusPacket: Buffer) => {
      const currentDecoder = this.activeDecoders.get(userId);
      if (currentDecoder && !currentDecoder.destroyed) {
        currentDecoder.write(opusPacket);
      }
    };

    // 既存のdataリスナーを除去してから新しいものを登録
    opusStream.removeAllListeners("data");
    opusStream.on("data", onData);
  }

  /**
   * 発話終了時の処理
   */
  private handleSpeakingEnd(userId: string): void {
    const userInfo = this.ssrcMapper.getByUserId(userId);
    logger.debug(`User ${userInfo?.displayName ?? userId} stopped speaking`);
  }

  /**
   * ストリーム終了時の処理
   */
  private handleStreamEnd(userId: string): void {
    this.activeStreams.delete(userId);

    // 無音検知で区切られたバッファを処理
    void this.bufferManager.checkAndFlush(userId);
  }

  /**
   * ユーザーのデコーダーをクリーンアップ
   */
  private cleanupDecoder(userId: string): void {
    const decoder = this.activeDecoders.get(userId);
    if (decoder) {
      try {
        decoder.destroy();
      } catch {
        // 既に破棄されている場合は無視
      }
      this.activeDecoders.delete(userId);
    }
  }

  /**
   * ユーザーのストリームとデコーダーをクリーンアップ
   */
  private cleanupUserStream(userId: string): void {
    const stream = this.activeStreams.get(userId);
    if (stream) {
      try {
        stream.removeAllListeners("data");
        stream.destroy();
      } catch {
        // ignore
      }
      this.activeStreams.delete(userId);
    }
    this.cleanupDecoder(userId);
  }

  /**
   * opusStream エラー後に再購読をスケジュール
   */
  private scheduleResubscribe(userId: string): void {
    const existingTimer = this.resubscribeTimers.get(userId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    logger.info(
      `Scheduling resubscribe for user ${userId} in ${this.resubscribeDelay}ms`,
    );

    const timer = setTimeout(() => {
      this.resubscribeTimers.delete(userId);
      if (!this.activeStreams.has(userId)) {
        logger.info(`Retrying audio subscription for user ${userId}`);
        void this.handleSpeakingStart(userId);
      }
    }, this.resubscribeDelay);

    this.resubscribeTimers.set(userId, timer);
  }

  /**
   * バッファマネージャを取得
   */
  getBufferManager(): AudioBufferManager {
    return this.bufferManager;
  }

  /**
   * SSRC マッパーを取得
   */
  getSSRCMapper(): SSRCMapper {
    return this.ssrcMapper;
  }

  /**
   * DAVE エラーカウントをリセット
   */
  resetDAVEErrorCount(): void {
    this.daveDecoderErrors.clear();
    logger.debug("DAVE error count reset");
  }

  /**
   * クリーンアップ
   */
  cleanup(): void {
    // リトライタイマーをクリア
    for (const timer of this.resubscribeTimers.values()) {
      clearTimeout(timer);
    }
    this.resubscribeTimers.clear();
    this.daveDecoderErrors.clear();

    // ストリームを破棄
    for (const [userId, stream] of this.activeStreams) {
      stream.removeAllListeners("data");
      stream.destroy();
      logger.debug(`Destroyed stream for user ${userId}`);
    }
    this.activeStreams.clear();

    // デコーダーを破棄（メモリリーク防止）
    for (const [userId, decoder] of this.activeDecoders) {
      try {
        decoder.destroy();
        logger.debug(`Destroyed decoder for user ${userId}`);
      } catch {
        // 既に破棄されている場合は無視
      }
    }
    this.activeDecoders.clear();

    this.ssrcMapper.clear();
    this.bufferManager.clear();
  }
}
