/**
 * Markdownライターサービス
 * - セッション終了時にMarkdown形式の議事録を生成
 * - セッション情報、会話ログ、統計情報を含む
 * - ドキュメント共有に適したフォーマット
 */
import * as fs from "fs/promises";
import * as path from "path";
import { logger } from "../utils/logger.js";
import type {
  TranscriptionResult,
  MarkdownWriterConfig,
} from "../types/index.js";

/**
 * デフォルト設定
 */
const defaultConfig: MarkdownWriterConfig = {
  baseDir: "./logs",
  includeStats: true,
  includeTimestamps: true,
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
}

/**
 * Markdownライターサービス
 */
export class MarkdownWriterService {
  private config: MarkdownWriterConfig;
  private session: Session | null = null;
  private segments: TranscriptionResult[] = [];
  private mdPath: string | null = null;

  constructor(config: Partial<MarkdownWriterConfig> = {}) {
    this.config = { ...defaultConfig, ...config };
    logger.debug("MarkdownWriterService initialized", { config: this.config });
  }

  /**
   * セッションを開始
   */
  async startSession(channelName: string, guildName: string): Promise<void> {
    const now = new Date();
    const sessionId = this.generateSessionId(now);

    this.session = {
      id: sessionId,
      channelName,
      guildName,
      startTime: now,
      participants: new Set(),
    };

    // ディレクトリ作成
    const dateDir = this.getDateDir(now);
    await fs.mkdir(dateDir, { recursive: true });

    const timeStr = now.toTimeString().slice(0, 8).replace(/:/g, "-");
    this.mdPath = path.join(dateDir, `${sessionId}-${timeStr}.md`);

    logger.info("MarkdownWriterService session started", {
      sessionId,
      mdPath: this.mdPath,
    });
  }

  /**
   * セグメントを追加
   */
  addSegment(result: TranscriptionResult): void {
    if (!this.session) return;

    this.segments.push(result);
    const displayName = result.displayName ?? result.username;
    this.session.participants.add(displayName);
  }

  /**
   * セッションを終了（Markdownを書き込み）
   */
  async endSession(): Promise<void> {
    if (!this.session || !this.mdPath) return;

    const endTime = new Date();
    const content = this.generateMarkdown(endTime);

    try {
      await fs.writeFile(this.mdPath, content, "utf-8");
      logger.info("MarkdownWriterService session ended", {
        sessionId: this.session.id,
        segments: this.segments.length,
      });
    } catch (error) {
      logger.error("Failed to write markdown file", { error });
    }

    this.session = null;
    this.segments = [];
    this.mdPath = null;
  }

  /**
   * Markdownを生成
   */
  private generateMarkdown(endTime: Date): string {
    const session = this.session!;
    const startDate = session.startTime;
    const dateStr = this.formatDate(startDate);
    const startTimeStr = this.formatTime(startDate);
    const endTimeStr = this.formatTime(endTime);
    const duration = this.formatDuration(
      endTime.getTime() - startDate.getTime(),
    );
    const participants = Array.from(session.participants).join(", ") || "なし";

    let md = `# 会議メモ - ${dateStr} ${startTimeStr}

## 📋 セッション情報

| 項目 | 内容 |
|------|------|
| サーバー | ${session.guildName} |
| チャンネル | ${session.channelName} |
| 開始時刻 | ${startTimeStr} |
| 終了時刻 | ${endTimeStr} |
| 参加者 | ${participants} |

---

## 💬 会話ログ

`;

    // 会話ログを追加
    if (this.segments.length === 0) {
      md += `*発話記録がありません*\n\n`;
    } else {
      for (const segment of this.segments) {
        const time = this.formatTime(new Date(segment.startTs));
        const name = segment.displayName ?? segment.username;

        if (this.config.includeTimestamps) {
          md += `### ${time} - ${name}\n`;
        } else {
          md += `### ${name}\n`;
        }
        md += `${segment.text}\n\n`;
      }
    }

    // 統計を追加
    if (this.config.includeStats) {
      const avgConfidence = this.calculateAverageConfidence();
      const totalDuration = this.calculateTotalSpeakingTime();

      md += `---

## 📊 統計

| 指標 | 値 |
|------|-----|
| 発話数 | ${this.segments.length}件 |
| セッション時間 | ${duration} |
| 総発話時間 | ${this.formatDuration(totalDuration)} |
| 平均信頼度 | ${Math.round(avgConfidence * 100)}% |
| 参加者数 | ${session.participants.size}人 |
`;
    }

    return md;
  }

  /**
   * 平均信頼度を計算
   */
  private calculateAverageConfidence(): number {
    if (this.segments.length === 0) return 0;
    const sum = this.segments.reduce((acc, s) => acc + s.confidence, 0);
    return sum / this.segments.length;
  }

  /**
   * 総発話時間を計算
   */
  private calculateTotalSpeakingTime(): number {
    return this.segments.reduce((acc, s) => acc + s.durationMs, 0);
  }

  /**
   * 日付をフォーマット
   */
  private formatDate(date: Date): string {
    return date.toLocaleDateString("ja-JP", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  }

  /**
   * 時刻をフォーマット
   */
  private formatTime(date: Date): string {
    return date.toTimeString().slice(0, 8);
  }

  /**
   * 時間をフォーマット
   */
  private formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${hours}:${minutes.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  }

  /**
   * セッションIDを生成
   */
  private generateSessionId(_date: Date): string {
    return `session-${Date.now().toString(36)}`;
  }

  /**
   * 日付ディレクトリを取得
   */
  private getDateDir(date: Date): string {
    const dateStr = date.toISOString().split("T")[0];
    return path.join(this.config.baseDir, dateStr);
  }

  /**
   * 現在のMarkdownパスを取得
   */
  getMdPath(): string | null {
    return this.mdPath;
  }
}

export default MarkdownWriterService;
