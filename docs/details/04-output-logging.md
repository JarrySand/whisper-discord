# 📘 出力・ログ 詳細仕様書

> **関連**: [spec.md](../spec.md) - 全体概要 | [01-discord-bot.md](./01-discord-bot.md) - Bot仕様

---

## 1. 概要

文字起こし結果を複数の形式で出力するコンポーネント。
3つの出力先をサポートし、用途に応じて有効/無効を切り替え可能。

### 出力先一覧

| 出力先 | 用途 | リアルタイム |
|--------|------|-------------|
| Discord テキストチャンネル | 参加者への即時共有 | ✅ |
| ログファイル (.log) | シンプルなテキストログ | ❌ |
| JSON ファイル | AI解析・データ処理用 | ❌ |
| Markdown ファイル (.md) | 議事録・ドキュメント共有用 | ❌ |

---

## 2. Discord チャンネル出力

### 2.1 メッセージフォーマット

**標準フォーマット**:

```
🎤 **Alice** <t:1733389200:T>
こんにちは、今日はよろしくお願いします。
```

**コンパクトフォーマット**（設定変更可）:

```
[10:23:14] Alice: こんにちは、今日はよろしくお願いします。
```

### 2.2 実装

```typescript
// output/discord.ts
import { TextChannel, EmbedBuilder } from 'discord.js';

interface DiscordOutputConfig {
  format: 'standard' | 'compact' | 'embed';
  showTimestamp: boolean;
  showConfidence: boolean;
  batchMessages: boolean;
  batchIntervalMs: number;
}

const defaultConfig: DiscordOutputConfig = {
  format: 'standard',
  showTimestamp: true,
  showConfidence: false,
  batchMessages: true,
  batchIntervalMs: 3000,
};

class DiscordOutputService {
  private channel: TextChannel | null = null;
  private messageQueue: TranscriptionResult[] = [];
  private batchTimer: NodeJS.Timeout | null = null;

  constructor(private config: DiscordOutputConfig = defaultConfig) {}

  setChannel(channel: TextChannel): void {
    this.channel = channel;
  }

  async post(result: TranscriptionResult): Promise<void> {
    if (!this.channel) {
      throw new Error('Output channel not set');
    }

    if (this.config.batchMessages) {
      this.queueMessage(result);
    } else {
      await this.sendSingle(result);
    }
  }

  private async sendSingle(result: TranscriptionResult): Promise<void> {
    const content = this.formatMessage(result);
    await this.channel!.send(content);
  }

  private queueMessage(result: TranscriptionResult): void {
    this.messageQueue.push(result);

    if (!this.batchTimer) {
      this.batchTimer = setTimeout(
        () => this.flushQueue(),
        this.config.batchIntervalMs,
      );
    }
  }

  private async flushQueue(): Promise<void> {
    this.batchTimer = null;

    if (this.messageQueue.length === 0) return;

    const messages = [...this.messageQueue];
    this.messageQueue = [];

    // 複数メッセージを結合
    const content = messages
      .map((r) => this.formatMessage(r))
      .join('\n\n');

    // Discord の文字数制限 (2000文字) を考慮
    if (content.length <= 2000) {
      await this.channel!.send(content);
    } else {
      // 分割送信
      for (const msg of messages) {
        await this.sendSingle(msg);
      }
    }
  }

  private formatMessage(result: TranscriptionResult): string {
    switch (this.config.format) {
      case 'embed':
        return this.formatEmbed(result);
      case 'compact':
        return this.formatCompact(result);
      case 'standard':
      default:
        return this.formatStandard(result);
    }
  }

  private formatStandard(result: TranscriptionResult): string {
    const timestamp = this.config.showTimestamp
      ? ` <t:${Math.floor(result.start_ts / 1000)}:T>`
      : '';
    const displayName = result.display_name || result.username;
    
    let text = `🎤 **${displayName}**${timestamp}\n${result.text}`;
    
    if (this.config.showConfidence) {
      const confidencePercent = Math.round(result.confidence * 100);
      text += ` _(${confidencePercent}%)_`;
    }
    
    return text;
  }

  private formatCompact(result: TranscriptionResult): string {
    const time = new Date(result.start_ts).toTimeString().slice(0, 8);
    const displayName = result.display_name || result.username;
    return `[${time}] ${displayName}: ${result.text}`;
  }

  private formatEmbed(result: TranscriptionResult): string {
    // Embedは文字列ではなく別途処理が必要
    // ここでは簡易的にJSON形式で返す
    return JSON.stringify({
      type: 'embed',
      data: result,
    });
  }

  async postEmbed(result: TranscriptionResult): Promise<void> {
    const embed = new EmbedBuilder()
      .setAuthor({
        name: result.display_name || result.username,
        iconURL: `https://cdn.discordapp.com/avatars/${result.user_id}/default.png`,
      })
      .setDescription(result.text)
      .setTimestamp(result.start_ts)
      .setColor(0x5865F2)
      .setFooter({
        text: `Confidence: ${Math.round(result.confidence * 100)}%`,
      });

    await this.channel!.send({ embeds: [embed] });
  }
}
```

### 2.3 レート制限対策

```typescript
class RateLimitHandler {
  private lastSendTime = 0;
  private readonly minInterval = 1000; // 1秒間隔

  async waitIfNeeded(): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.lastSendTime;
    
    if (elapsed < this.minInterval) {
      await new Promise(r => setTimeout(r, this.minInterval - elapsed));
    }
    
    this.lastSendTime = Date.now();
  }
}
```

---

## 3. ログファイル出力

### 3.1 ファイル構造

```
logs/
├── 2024-12-05/
│   ├── session-001-10-23-14.log    # セッションログ
│   ├── session-001-10-23-14.json   # JSON形式
│   └── session-002-14-30-00.log
└── 2024-12-06/
    └── session-001-09-00-00.log
```

### 3.2 ログフォーマット

**テキストログ (.log)**:

```
================================================================================
Discord Voice Transcription Log
Session: session-001
Started: 2024-12-05 10:23:14 JST
Channel: 雑談
Participants: Alice, Bob, Charlie
================================================================================

[10:23:14] Alice: こんにちは、今日はよろしくお願いします。
[10:23:18] Bob: はい、よろしくお願いします。
[10:23:25] Alice: それでは、今日のアジェンダを確認しましょう。
[10:23:32] Charlie: はい、お願いします。

--------------------------------------------------------------------------------
[10:45:00] Session paused
[10:50:00] Session resumed
--------------------------------------------------------------------------------

[10:50:05] Bob: では、続きを始めましょう。

================================================================================
Session ended: 2024-12-05 11:30:45 JST
Duration: 1:07:31
Total utterances: 234
================================================================================
```

### 3.3 実装

```typescript
// output/file-logger.ts
import * as fs from 'fs/promises';
import * as path from 'path';

interface FileLoggerConfig {
  baseDir: string;
  encoding: BufferEncoding;
  flushIntervalMs: number;
}

interface Session {
  id: string;
  channelName: string;
  startTime: Date;
  participants: Set<string>;
  utteranceCount: number;
}

class FileLoggerService {
  private config: FileLoggerConfig;
  private session: Session | null = null;
  private buffer: string[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private logPath: string | null = null;

  constructor(config: Partial<FileLoggerConfig> = {}) {
    this.config = {
      baseDir: './logs',
      encoding: 'utf-8',
      flushIntervalMs: 5000,
      ...config,
    };
  }

  async startSession(channelName: string): Promise<string> {
    const now = new Date();
    const sessionId = this.generateSessionId(now);
    
    this.session = {
      id: sessionId,
      channelName,
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

    return sessionId;
  }

  async log(result: TranscriptionResult): Promise<void> {
    if (!this.session) {
      throw new Error('No active session');
    }

    this.session.participants.add(result.display_name || result.username);
    this.session.utteranceCount++;

    const line = this.formatLogLine(result);
    this.buffer.push(line);
  }

  async endSession(): Promise<void> {
    if (!this.session) return;

    // バッファをフラッシュ
    await this.flush();
    this.stopFlushTimer();

    // フッター書き込み
    await this.writeFooter();

    this.session = null;
    this.logPath = null;
  }

  private formatLogLine(result: TranscriptionResult): string {
    const time = new Date(result.start_ts).toTimeString().slice(0, 8);
    const name = result.display_name || result.username;
    return `[${time}] ${name}: ${result.text}`;
  }

  private async writeHeader(): Promise<void> {
    const session = this.session!;
    const header = `${'='.repeat(80)}
Discord Voice Transcription Log
Session: ${session.id}
Started: ${this.formatDateTime(session.startTime)}
Channel: ${session.channelName}
${'='.repeat(80)}

`;
    await fs.writeFile(this.logPath!, header, this.config.encoding);
  }

  private async writeFooter(): Promise<void> {
    const session = this.session!;
    const endTime = new Date();
    const duration = this.formatDuration(endTime.getTime() - session.startTime.getTime());
    
    const footer = `
${'='.repeat(80)}
Session ended: ${this.formatDateTime(endTime)}
Duration: ${duration}
Total utterances: ${session.utteranceCount}
Participants: ${Array.from(session.participants).join(', ')}
${'='.repeat(80)}
`;
    await fs.appendFile(this.logPath!, footer, this.config.encoding);
  }

  private async flush(): Promise<void> {
    if (this.buffer.length === 0 || !this.logPath) return;

    const content = this.buffer.join('\n') + '\n';
    this.buffer = [];

    await fs.appendFile(this.logPath, content, this.config.encoding);
  }

  private startFlushTimer(): void {
    this.flushTimer = setInterval(
      () => this.flush(),
      this.config.flushIntervalMs,
    );
  }

  private stopFlushTimer(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
  }

  private generateSessionId(date: Date): string {
    // session-001 形式
    // TODO: 同日の連番管理
    return 'session-001';
  }

  private getDateDir(date: Date): string {
    const dateStr = date.toISOString().split('T')[0];
    return path.join(this.config.baseDir, dateStr);
  }

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

  private formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
}
```

---

## 4. JSON 出力

### 4.1 JSON スキーマ

```typescript
interface TranscriptionSession {
  // メタデータ
  version: string;
  session_id: string;
  
  // セッション情報
  guild_id: string;
  guild_name: string;
  channel_id: string;
  channel_name: string;
  
  // 時間
  session_start: string;  // ISO 8601
  session_end: string;    // ISO 8601
  duration_ms: number;
  
  // 参加者
  participants: Participant[];
  
  // 発話セグメント
  segments: TranscriptionSegment[];
  
  // 統計
  stats: SessionStats;
}

interface Participant {
  user_id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  utterance_count: number;
  total_speaking_time_ms: number;
}

interface TranscriptionSegment {
  id: string;
  user_id: string;
  username: string;
  display_name: string;
  text: string;
  start_ts: number;      // Unix timestamp (ms)
  end_ts: number;
  duration_ms: number;
  confidence: number;
  language: string;
}

interface SessionStats {
  total_segments: number;
  total_duration_ms: number;
  avg_segment_duration_ms: number;
  avg_confidence: number;
  words_per_minute: number;
  participant_count: number;
}
```

### 4.2 サンプル JSON

```json
{
  "version": "1.0.0",
  "session_id": "session-001",
  "guild_id": "123456789012345678",
  "guild_name": "My Server",
  "channel_id": "987654321098765432",
  "channel_name": "雑談",
  "session_start": "2024-12-05T10:23:14.000+09:00",
  "session_end": "2024-12-05T11:30:45.000+09:00",
  "duration_ms": 4051000,
  "participants": [
    {
      "user_id": "111111111111111111",
      "username": "alice",
      "display_name": "Alice",
      "avatar_url": "https://cdn.discordapp.com/avatars/111111111111111111/abc.png",
      "utterance_count": 85,
      "total_speaking_time_ms": 1200000
    },
    {
      "user_id": "222222222222222222",
      "username": "bob",
      "display_name": "Bob",
      "avatar_url": null,
      "utterance_count": 92,
      "total_speaking_time_ms": 1350000
    }
  ],
  "segments": [
    {
      "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "user_id": "111111111111111111",
      "username": "alice",
      "display_name": "Alice",
      "text": "こんにちは、今日はよろしくお願いします。",
      "start_ts": 1733389394000,
      "end_ts": 1733389398000,
      "duration_ms": 4000,
      "confidence": 0.95,
      "language": "ja"
    },
    {
      "id": "b2c3d4e5-f6a7-8901-bcde-f23456789012",
      "user_id": "222222222222222222",
      "username": "bob",
      "display_name": "Bob",
      "text": "はい、よろしくお願いします。",
      "start_ts": 1733389398500,
      "end_ts": 1733389401000,
      "duration_ms": 2500,
      "confidence": 0.92,
      "language": "ja"
    }
  ],
  "stats": {
    "total_segments": 234,
    "total_duration_ms": 3600000,
    "avg_segment_duration_ms": 15385,
    "avg_confidence": 0.89,
    "words_per_minute": 120,
    "participant_count": 3
  }
}
```

### 4.3 実装

```typescript
// output/json-store.ts
import * as fs from 'fs/promises';
import * as path from 'path';

class JsonStoreService {
  private config: JsonStoreConfig;
  private session: TranscriptionSession | null = null;
  private jsonPath: string | null = null;
  private saveTimer: NodeJS.Timeout | null = null;

  constructor(config: Partial<JsonStoreConfig> = {}) {
    this.config = {
      baseDir: './logs',
      saveIntervalMs: 10000,
      prettyPrint: true,
      ...config,
    };
  }

  async startSession(
    guildId: string,
    guildName: string,
    channelId: string,
    channelName: string,
  ): Promise<void> {
    const now = new Date();
    const sessionId = this.generateSessionId();

    this.session = {
      version: '1.0.0',
      session_id: sessionId,
      guild_id: guildId,
      guild_name: guildName,
      channel_id: channelId,
      channel_name: channelName,
      session_start: now.toISOString(),
      session_end: '',
      duration_ms: 0,
      participants: [],
      segments: [],
      stats: this.initStats(),
    };

    // ファイルパス設定
    const dateDir = path.join(this.config.baseDir, now.toISOString().split('T')[0]);
    await fs.mkdir(dateDir, { recursive: true });
    
    const timeStr = now.toTimeString().slice(0, 8).replace(/:/g, '-');
    this.jsonPath = path.join(dateDir, `${sessionId}-${timeStr}.json`);

    // 定期保存開始
    this.startSaveTimer();
  }

  async addSegment(result: TranscriptionResult): Promise<void> {
    if (!this.session) {
      throw new Error('No active session');
    }

    // セグメント追加
    const segment: TranscriptionSegment = {
      id: result.id || this.generateId(),
      user_id: result.user_id,
      username: result.username,
      display_name: result.display_name || result.username,
      text: result.text,
      start_ts: result.start_ts,
      end_ts: result.end_ts,
      duration_ms: result.duration_ms,
      confidence: result.confidence,
      language: result.language || 'ja',
    };

    this.session.segments.push(segment);

    // 参加者情報更新
    this.updateParticipant(result);

    // 統計更新
    this.updateStats(segment);
  }

  async endSession(): Promise<void> {
    if (!this.session) return;

    this.stopSaveTimer();

    // セッション終了情報
    const endTime = new Date();
    this.session.session_end = endTime.toISOString();
    this.session.duration_ms = 
      endTime.getTime() - new Date(this.session.session_start).getTime();

    // 最終統計計算
    this.finalizeStats();

    // 保存
    await this.save();

    this.session = null;
    this.jsonPath = null;
  }

  private updateParticipant(result: TranscriptionResult): void {
    let participant = this.session!.participants.find(
      p => p.user_id === result.user_id
    );

    if (!participant) {
      participant = {
        user_id: result.user_id,
        username: result.username,
        display_name: result.display_name || result.username,
        avatar_url: null, // TODO: 取得方法
        utterance_count: 0,
        total_speaking_time_ms: 0,
      };
      this.session!.participants.push(participant);
    }

    participant.utterance_count++;
    participant.total_speaking_time_ms += result.duration_ms;
  }

  private updateStats(segment: TranscriptionSegment): void {
    const stats = this.session!.stats;
    stats.total_segments++;
    stats.total_duration_ms += segment.duration_ms;
    
    // 信頼度の移動平均
    const n = stats.total_segments;
    stats.avg_confidence = 
      (stats.avg_confidence * (n - 1) + segment.confidence) / n;
  }

  private finalizeStats(): void {
    const stats = this.session!.stats;
    
    if (stats.total_segments > 0) {
      stats.avg_segment_duration_ms = 
        stats.total_duration_ms / stats.total_segments;
    }
    
    stats.participant_count = this.session!.participants.length;
    
    // WPM計算（日本語は文字数ベース）
    const totalChars = this.session!.segments
      .reduce((sum, s) => sum + s.text.length, 0);
    const durationMinutes = this.session!.duration_ms / 60000;
    stats.words_per_minute = durationMinutes > 0 
      ? Math.round(totalChars / durationMinutes)
      : 0;
  }

  private async save(): Promise<void> {
    if (!this.session || !this.jsonPath) return;

    const content = this.config.prettyPrint
      ? JSON.stringify(this.session, null, 2)
      : JSON.stringify(this.session);

    await fs.writeFile(this.jsonPath, content, 'utf-8');
  }

  private startSaveTimer(): void {
    this.saveTimer = setInterval(
      () => this.save(),
      this.config.saveIntervalMs,
    );
  }

  private stopSaveTimer(): void {
    if (this.saveTimer) {
      clearInterval(this.saveTimer);
      this.saveTimer = null;
    }
  }

  private initStats(): SessionStats {
    return {
      total_segments: 0,
      total_duration_ms: 0,
      avg_segment_duration_ms: 0,
      avg_confidence: 0,
      words_per_minute: 0,
      participant_count: 0,
    };
  }

  private generateSessionId(): string {
    return `session-${Date.now().toString(36)}`;
  }

  private generateId(): string {
    return crypto.randomUUID();
  }
}
```

---

## 5. 出力マネージャー

### 5.1 統合インターフェース

```typescript
// output/manager.ts
import { DiscordOutputService } from './discord';
import { FileLoggerService } from './file-logger';
import { JsonStoreService } from './json-store';
import { MarkdownWriterService } from './markdown-writer';

interface OutputConfig {
  discord: {
    enabled: boolean;
    config: DiscordOutputConfig;
  };
  fileLog: {
    enabled: boolean;
    config: FileLoggerConfig;
  };
  jsonStore: {
    enabled: boolean;
    config: JsonStoreConfig;
  };
  markdown: {
    enabled: boolean;
    config: MarkdownWriterConfig;
  };
}

class OutputManager {
  private discord: DiscordOutputService | null = null;
  private fileLogger: FileLoggerService | null = null;
  private jsonStore: JsonStoreService | null = null;
  private markdownWriter: MarkdownWriterService | null = null;

  constructor(private config: OutputConfig) {
    if (config.discord.enabled) {
      this.discord = new DiscordOutputService(config.discord.config);
    }
    if (config.fileLog.enabled) {
      this.fileLogger = new FileLoggerService(config.fileLog.config);
    }
    if (config.jsonStore.enabled) {
      this.jsonStore = new JsonStoreService(config.jsonStore.config);
    }
    if (config.markdown.enabled) {
      this.markdownWriter = new MarkdownWriterService(config.markdown.config);
    }
  }

  async startSession(context: SessionContext): Promise<void> {
    const promises: Promise<any>[] = [];

    if (this.discord && context.outputChannel) {
      this.discord.setChannel(context.outputChannel);
    }

    if (this.fileLogger) {
      promises.push(this.fileLogger.startSession(context.channelName));
    }

    if (this.jsonStore) {
      promises.push(this.jsonStore.startSession(
        context.guildId,
        context.guildName,
        context.channelId,
        context.channelName,
      ));
    }

    if (this.markdownWriter) {
      promises.push(this.markdownWriter.startSession(
        context.channelName,
        context.guildName,
      ));
    }

    await Promise.all(promises);
  }

  async output(result: TranscriptionResult): Promise<void> {
    const promises: Promise<any>[] = [];

    if (this.discord) {
      promises.push(
        this.discord.post(result).catch(err => {
          console.error('Discord output failed:', err);
        })
      );
    }

    if (this.fileLogger) {
      promises.push(
        this.fileLogger.log(result).catch(err => {
          console.error('File log failed:', err);
        })
      );
    }

    if (this.jsonStore) {
      promises.push(
        this.jsonStore.addSegment(result).catch(err => {
          console.error('JSON store failed:', err);
        })
      );
    }

    if (this.markdownWriter) {
      // Markdownはセッション終了時にまとめて書き込むため、ここでは蓄積のみ
      this.markdownWriter.addSegment(result);
    }

    await Promise.all(promises);
  }

  async endSession(): Promise<void> {
    const promises: Promise<any>[] = [];

    if (this.fileLogger) {
      promises.push(this.fileLogger.endSession());
    }

    if (this.jsonStore) {
      promises.push(this.jsonStore.endSession());
    }

    if (this.markdownWriter) {
      promises.push(this.markdownWriter.endSession());
    }

    await Promise.all(promises);
  }
}
```

---

## 6. Markdown 出力

### 6.1 ファイル構造

```
logs/
├── 2024-12-05/
│   ├── session-001-10-23-14.log
│   ├── session-001-10-23-14.json
│   └── session-001-10-23-14.md     # Markdown形式
└── 2024-12-06/
    └── ...
```

### 6.2 Markdownフォーマット

```markdown
# 会議メモ - 2024-12-05 10:23

## 📋 セッション情報

| 項目 | 内容 |
|------|------|
| チャンネル | 雑談 |
| 開始時刻 | 10:23:14 |
| 終了時刻 | 11:30:45 |
| 参加者 | Alice, Bob, Charlie |

---

## 💬 会話ログ

### 10:23:14 - Alice
こんにちは、今日はよろしくお願いします。

### 10:23:18 - Bob
はい、よろしくお願いします。

### 10:23:25 - Alice
それでは、今日のアジェンダを確認しましょう。

---

## 📊 統計

| 指標 | 値 |
|------|-----|
| 発話数 | 234件 |
| セッション時間 | 1:07:31 |
| 参加者数 | 3人 |
```

### 6.3 実装

```typescript
// output/markdown-writer.ts
import * as fs from 'fs/promises';
import * as path from 'path';

interface MarkdownWriterConfig {
  baseDir: string;
  includeStats: boolean;
  includeTimestamps: boolean;
}

class MarkdownWriterService {
  private config: MarkdownWriterConfig;
  private session: Session | null = null;
  private segments: TranscriptionResult[] = [];
  private mdPath: string | null = null;

  constructor(config: Partial<MarkdownWriterConfig> = {}) {
    this.config = {
      baseDir: './logs',
      includeStats: true,
      includeTimestamps: true,
      ...config,
    };
  }

  async startSession(
    channelName: string,
    guildName: string,
  ): Promise<void> {
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

    const timeStr = now.toTimeString().slice(0, 8).replace(/:/g, '-');
    this.mdPath = path.join(dateDir, `${sessionId}-${timeStr}.md`);
  }

  addSegment(result: TranscriptionResult): void {
    if (!this.session) return;
    
    this.segments.push(result);
    this.session.participants.add(result.display_name || result.username);
  }

  async endSession(): Promise<void> {
    if (!this.session || !this.mdPath) return;

    const endTime = new Date();
    const content = this.generateMarkdown(endTime);
    
    await fs.writeFile(this.mdPath, content, 'utf-8');

    this.session = null;
    this.segments = [];
    this.mdPath = null;
  }

  private generateMarkdown(endTime: Date): string {
    const session = this.session!;
    const startDate = session.startTime;
    const dateStr = this.formatDate(startDate);
    const startTimeStr = this.formatTime(startDate);
    const endTimeStr = this.formatTime(endTime);
    const duration = this.formatDuration(endTime.getTime() - startDate.getTime());
    const participants = Array.from(session.participants).join(', ');

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
    for (const segment of this.segments) {
      const time = this.formatTime(new Date(segment.start_ts));
      const name = segment.display_name || segment.username;
      
      if (this.config.includeTimestamps) {
        md += `### ${time} - ${name}\n`;
      } else {
        md += `### ${name}\n`;
      }
      md += `${segment.text}\n\n`;
    }

    // 統計を追加
    if (this.config.includeStats) {
      md += `---

## 📊 統計

| 指標 | 値 |
|------|-----|
| 発話数 | ${this.segments.length}件 |
| セッション時間 | ${duration} |
| 参加者数 | ${session.participants.size}人 |
`;
    }

    return md;
  }

  private formatDate(date: Date): string {
    return date.toLocaleDateString('ja-JP', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  }

  private formatTime(date: Date): string {
    return date.toTimeString().slice(0, 8);
  }

  private formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }

  private generateSessionId(date: Date): string {
    return `session-${Date.now().toString(36)}`;
  }

  private getDateDir(date: Date): string {
    const dateStr = date.toISOString().split('T')[0];
    return path.join(this.config.baseDir, dateStr);
  }
}
```

---

## 7. SRT/VTT 字幕出力（将来拡張）

### 7.1 SRT フォーマット

```
1
00:00:03,000 --> 00:00:07,000
[Alice] こんにちは、今日はよろしくお願いします。

2
00:00:07,500 --> 00:00:10,000
[Bob] はい、よろしくお願いします。
```

### 7.2 実装スケルトン

```typescript
// output/subtitle.ts
class SubtitleService {
  generateSRT(segments: TranscriptionSegment[]): string {
    const baseTime = segments[0]?.start_ts || 0;
    
    return segments.map((seg, i) => {
      const startOffset = seg.start_ts - baseTime;
      const endOffset = seg.end_ts - baseTime;
      
      return [
        i + 1,
        `${this.formatSRTTime(startOffset)} --> ${this.formatSRTTime(endOffset)}`,
        `[${seg.display_name}] ${seg.text}`,
        '',
      ].join('\n');
    }).join('\n');
  }

  private formatSRTTime(ms: number): string {
    const hours = Math.floor(ms / 3600000);
    const minutes = Math.floor((ms % 3600000) / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    const millis = ms % 1000;
    
    return [
      hours.toString().padStart(2, '0'),
      minutes.toString().padStart(2, '0'),
      seconds.toString().padStart(2, '0'),
    ].join(':') + ',' + millis.toString().padStart(3, '0');
  }
}
```

---

## 8. 設定パラメータ

```typescript
// config/output.ts
export const outputConfig = {
  discord: {
    enabled: process.env.OUTPUT_DISCORD_ENABLED !== 'false',
    format: process.env.OUTPUT_DISCORD_FORMAT || 'standard',
    showTimestamp: true,
    showConfidence: false,
    batchMessages: true,
    batchIntervalMs: 3000,
  },
  fileLog: {
    enabled: process.env.OUTPUT_FILE_ENABLED !== 'false',
    baseDir: process.env.OUTPUT_LOG_DIR || './logs',
    encoding: 'utf-8' as const,
    flushIntervalMs: 5000,
  },
  jsonStore: {
    enabled: process.env.OUTPUT_JSON_ENABLED !== 'false',
    baseDir: process.env.OUTPUT_LOG_DIR || './logs',
    saveIntervalMs: 10000,
    prettyPrint: true,
  },
  markdown: {
    enabled: process.env.OUTPUT_MARKDOWN_ENABLED !== 'false',
    baseDir: process.env.OUTPUT_LOG_DIR || './logs',
    includeStats: true,
    includeTimestamps: true,
  },
};
```

---

## 9. 次のドキュメント

- [05-integration.md](./05-integration.md) - Bot⇔API連携
- [06-config-env.md](./06-config-env.md) - 環境変数設定

