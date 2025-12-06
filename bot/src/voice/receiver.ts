import {
  VoiceConnection,
  VoiceReceiver,
  EndBehaviorType,
} from '@discordjs/voice';
import { Guild } from 'discord.js';
import { EventEmitter } from 'events';
import { Readable } from 'stream';
import prism from 'prism-media';
import { SSRCMapper } from './ssrc-mapper.js';
import { AudioBufferManager } from '../audio/buffer.js';
import { logger } from '../utils/logger.js';

/**
 * DAVE プロトコルエラーを検出
 */
function isDAVEError(error: Error): boolean {
  const message = error.message.toLowerCase();
  return (
    message.includes('corrupted') ||
    message.includes('compressed data') ||
    message.includes('encryption') ||
    message.includes('decrypt')
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
  private activeDecoders = new Map<string, prism.opus.Decoder>(); // デコーダーを再利用
  private daveErrorCount = 0;
  private daveErrorThreshold = 3; // 連続3回でリセット要求
  private daveErrorResetTime = 30000; // 30秒でカウントリセット
  private lastDaveErrorTime = 0;

  constructor(
    connection: VoiceConnection,
    private guild: Guild
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
    this.receiver.speaking.on('start', (userId: string) => {
      this.handleSpeakingStart(userId);
    });

    // ユーザーが話し終わった時
    this.receiver.speaking.on('end', (userId: string) => {
      this.handleSpeakingEnd(userId);
    });
  }

  /**
   * 発話開始時の処理
   */
  private handleSpeakingStart(userId: string): void {
    // すでにストリームがある場合はスキップ
    if (this.activeStreams.has(userId)) {
      return;
    }

    // GuildMember を取得
    const member = this.guild.members.cache.get(userId);
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
        duration: 1500, // 1.5秒の無音で終了（自然な会話ペースに対応）
      },
    });

    this.activeStreams.set(userId, opusStream);

    // Opus → PCM デコード（パイプ後は再利用できないため毎回新規作成）
    // 既存のデコーダーがあればクリーンアップ
    this.cleanupDecoder(userId);
    
    const decoder = new prism.opus.Decoder({
      rate: 48000,
      channels: 2,
      frameSize: 960,
    });
    this.activeDecoders.set(userId, decoder);

    // バッファに追加
    const userInfo = this.ssrcMapper.getByUserId(userId);

    // パイプラインでデコード
    const decodedStream = opusStream.pipe(decoder);

    decodedStream.on('data', (pcmData: Buffer) => {
      if (userInfo) {
        this.bufferManager.appendAudio(
          userId,
          userInfo.username,
          userInfo.displayName,
          pcmData
        );
      }
    });

    decodedStream.on('error', (error: Error) => {
      // DAVE プロトコルエラーの検出と処理
      if (isDAVEError(error)) {
        this.handleDAVEError(userId, error);
      } else {
        logger.error(`Error decoding audio for user ${userId}:`, error);
      }
    });

    opusStream.on('end', () => {
      this.handleStreamEnd(userId);
      // デコーダーをクリーンアップ（再利用せず新規作成）
      this.cleanupDecoder(userId);
    });

    opusStream.on('error', (error: Error) => {
      // DAVE/E2EE 関連エラーは警告レベルで処理（一部のユーザーで発生するが致命的ではない）
      if (error.message.includes('decrypt') || error.message.includes('Decryption')) {
        logger.warn(`DAVE encryption error for user ${userId} - audio may not be captured`);
      } else {
        logger.error(`Opus stream error for user ${userId}:`, error);
      }
      this.activeStreams.delete(userId);
      this.cleanupDecoder(userId);
    });
  }

  /**
   * 発話終了時の処理
   */
  private handleSpeakingEnd(userId: string): void {
    const userInfo = this.ssrcMapper.getByUserId(userId);
    logger.debug(
      `User ${userInfo?.displayName ?? userId} stopped speaking`
    );
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
   * DAVE プロトコルエラーを処理
   * 連続してエラーが発生した場合、接続リセットを要求
   */
  private handleDAVEError(userId: string, error: Error): void {
    const now = Date.now();
    
    // 前回エラーから時間が経っていればカウントリセット
    if (now - this.lastDaveErrorTime > this.daveErrorResetTime) {
      this.daveErrorCount = 0;
    }
    
    this.daveErrorCount++;
    this.lastDaveErrorTime = now;
    
    // 初回のみ通知、その後はdebugレベル
    if (this.daveErrorCount === 1) {
      logger.warn(`DAVE protocol error detected for user ${userId}`, error.message);
    } else {
      logger.debug(`DAVE protocol error (${this.daveErrorCount}/${this.daveErrorThreshold}) for user ${userId}`);
    }
    
    // 閾値を超えたら接続リセットを要求
    if (this.daveErrorCount >= this.daveErrorThreshold) {
      logger.error('DAVE error threshold exceeded, requesting connection reset');
      this.daveErrorCount = 0; // リセット後はカウントをリセット
      
      // 接続リセットイベントを発火
      this.emit('connectionResetRequired', {
        guildId: this.guild.id,
        reason: 'DAVE protocol encryption error',
        lastError: error.message,
      });
    }
  }

  /**
   * DAVE エラーカウントをリセット
   */
  resetDAVEErrorCount(): void {
    this.daveErrorCount = 0;
    this.lastDaveErrorTime = 0;
    logger.debug('DAVE error count reset');
  }

  /**
   * クリーンアップ
   */
  cleanup(): void {
    // ストリームを破棄
    for (const [userId, stream] of this.activeStreams) {
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
    this.daveErrorCount = 0;
  }
}

