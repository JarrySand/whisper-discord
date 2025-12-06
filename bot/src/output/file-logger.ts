/**
 * ファイルロガーサービス
 * - セッションごとにテキストログファイルを生成
 * - ヘッダー/フッター付きのフォーマット
 * - 定期フラッシュでデータ保護
 */
import * as fs from 'fs/promises';
import * as path from 'path';
import { logger } from '../utils/logger.js';
import type { TranscriptionResult, FileLoggerConfig } from '../types/index.js';

/**
 * デフォルト設定
 */
const defaultConfig: FileLoggerConfig = {
  baseDir: './logs',
  encoding: 'utf-8',
  flushIntervalMs: 5000,
};

/**
 * セッション情報
 */
interface Session {
  id: string;
  channelName: string;
  guildName: string;
  startTime: Date;
  participants: Set<string>;
  utteranceCount: number;
}

/**
 * ファイルロガーサービス
 */
export class FileLoggerService {
  private config: FileLoggerConfig;
  private session: Session | null = null;
  private buffer: string[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private logPath: string | null = null;
  private sessionCounter: number = 0;

  constructor(config: Partial<FileLoggerConfig> = {}) {
    this.config = { ...defaultConfig, ...config };
    logger.debug('FileLoggerService initialized', { config: this.config });
  }

  /**
   * セッションを開始
   */
  async startSession(
    channelName: string,
    guildName: string
  ): Promise<void> {
    const now = new Date();
    const sessionId = await this.generateSessionId(now);

    this.session = {
      id: sessionId,
      channelName,
      guildName,
      startTime: now,
      participants: new Set(),
      utteranceCount: 0,
    };

    // ディレクトリ作成
    const dateDir = this.getDateDir(now);
    await fs.mkdir(dateDir, { recursive: true });

    // ログファイルパス
    const timeStr = now.toTimeString().slice(0, 8).replace(/:/g, '-');
    this.logPath = path.join(dateDir, `${sessionId}-${timeStr}.log`);

    // ヘッダー書き込み
    await this.writeHeader();

    // 定期フラッシュ開始
    this.startFlushTimer();

    logger.info('FileLoggerService session started', { sessionId, logPath: this.logPath });
  }

  /**
   * ログを追加
   */
  async log(result: TranscriptionResult): Promise<void> {
    if (!this.session) {
      logger.warn('No active session for file logging');
      return;
    }

    const displayName = result.displayName ?? result.username;
    this.session.participants.add(displayName);
    this.session.utteranceCount++;

    const line = this.formatLogLine(result);
    this.buffer.push(line);
  }

  /**
   * セッションを終了
   */
  async endSession(): Promise<void> {
    if (!this.session) return;

    // バッファをフラッシュ
    await this.flush();
    this.stopFlushTimer();

    // フッター書き込み
    await this.writeFooter();

    logger.info('FileLoggerService session ended', {
      sessionId: this.session.id,
      utteranceCount: this.session.utteranceCount,
    });

    this.session = null;
    this.logPath = null;
  }

  /**
   * ログ行をフォーマット
   */
  private formatLogLine(result: TranscriptionResult): string {
    const time = new Date(result.startTs).toTimeString().slice(0, 8);
    const name = result.displayName ?? result.username;
    return `[${time}] ${name}: ${result.text}`;
  }

  /**
   * ヘッダーを書き込み
   */
  private async writeHeader(): Promise<void> {
    const session = this.session!;
    const separator = '='.repeat(80);
    const header = `${separator}
Discord Voice Transcription Log
Session: ${session.id}
Started: ${this.formatDateTime(session.startTime)}
Server: ${session.guildName}
Channel: ${session.channelName}
${separator}

`;
    await fs.writeFile(this.logPath!, header, this.config.encoding);
  }

  /**
   * フッターを書き込み
   */
  private async writeFooter(): Promise<void> {
    const session = this.session!;
    const endTime = new Date();
    const duration = this.formatDuration(endTime.getTime() - session.startTime.getTime());
    const separator = '='.repeat(80);

    const footer = `
${separator}
Session ended: ${this.formatDateTime(endTime)}
Duration: ${duration}
Total utterances: ${session.utteranceCount}
Participants: ${Array.from(session.participants).join(', ')}
${separator}
`;
    await fs.appendFile(this.logPath!, footer, this.config.encoding);
  }

  /**
   * バッファをフラッシュ
   */
  async flush(): Promise<void> {
    if (this.buffer.length === 0 || !this.logPath) return;

    const content = this.buffer.join('\n') + '\n';
    this.buffer = [];

    try {
      await fs.appendFile(this.logPath, content, this.config.encoding);
    } catch (error) {
      logger.error('Failed to flush file log buffer', { error });
    }
  }

  /**
   * 定期フラッシュタイマーを開始
   */
  private startFlushTimer(): void {
    this.flushTimer = setInterval(
      () => this.flush(),
      this.config.flushIntervalMs
    );
  }

  /**
   * 定期フラッシュタイマーを停止
   */
  private stopFlushTimer(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
  }

  /**
   * セッションIDを生成
   */
  private async generateSessionId(date: Date): Promise<string> {
    // 同日のセッション番号を取得
    const dateDir = this.getDateDir(date);
    
    try {
      await fs.access(dateDir);
      const files = await fs.readdir(dateDir);
      const sessionFiles = files.filter((f) => f.startsWith('session-') && f.endsWith('.log'));
      this.sessionCounter = sessionFiles.length + 1;
    } catch {
      // ディレクトリが存在しない場合
      this.sessionCounter = 1;
    }

    return `session-${this.sessionCounter.toString().padStart(3, '0')}`;
  }

  /**
   * 日付ディレクトリを取得
   */
  private getDateDir(date: Date): string {
    const dateStr = date.toISOString().split('T')[0];
    return path.join(this.config.baseDir, dateStr);
  }

  /**
   * 日時をフォーマット
   */
  private formatDateTime(date: Date): string {
    return date.toLocaleString('ja-JP', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      timeZoneName: 'short',
    });
  }

  /**
   * 時間をフォーマット
   */
  private formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }

  /**
   * 現在のログパスを取得
   */
  getLogPath(): string | null {
    return this.logPath;
  }
}

export default FileLoggerService;

