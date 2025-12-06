# 📘 Discord Bot 詳細仕様書

> **関連**: [spec.md](../spec.md) - 全体概要

---

## 1. 概要

Discord ボイスチャンネル（VC）に参加し、ユーザーごとの音声ストリームを受信・管理するBotコンポーネント。

### 技術スタック

| 項目 | 技術 |
|------|------|
| 言語 | TypeScript |
| ランタイム | Node.js 20+ |
| フレームワーク | discord.js v14 |
| 音声ライブラリ | @discordjs/voice, @discordjs/opus |
| パッケージマネージャ | pnpm (推奨) |

---

## 2. ディレクトリ構造

```
bot/
├── src/
│   ├── index.ts              # エントリーポイント
│   ├── bot.ts                # Discord Client 初期化
│   ├── commands/
│   │   ├── index.ts          # コマンドローダー
│   │   ├── join.ts           # /join コマンド
│   │   └── leave.ts          # /leave コマンド
│   ├── voice/
│   │   ├── connection.ts     # VC接続管理
│   │   ├── receiver.ts       # 音声受信ハンドラ
│   │   └── ssrc-mapper.ts    # SSRC → UserID マッピング
│   ├── audio/
│   │   ├── buffer.ts         # ユーザー別音声バッファ
│   │   ├── segmenter.ts      # セグメント分割
│   │   └── encoder.ts        # 音声エンコード
│   ├── api/
│   │   └── whisper-client.ts # Whisper API クライアント
│   ├── output/
│   │   ├── discord.ts        # Discord投稿
│   │   ├── file-logger.ts    # ファイルログ
│   │   └── json-store.ts     # JSON保存
│   ├── config/
│   │   └── index.ts          # 設定読み込み
│   ├── utils/
│   │   ├── logger.ts         # ログユーティリティ
│   │   └── time.ts           # タイムスタンプ処理
│   └── types/
│       └── index.ts          # 型定義
├── package.json
├── tsconfig.json
├── .env
└── .env.example
```

---

## 3. Discord Bot セットアップ

### 3.1 必要な権限 (Permissions)

```
GUILD_VOICE_STATES     - VC状態の監視
CONNECT                - VCへの接続
SPEAK                  - VCでの発言（音声受信に必要）
SEND_MESSAGES          - テキストチャンネルへの投稿
USE_APPLICATION_COMMANDS - スラッシュコマンド
```

### 3.2 Gateway Intents

```typescript
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
  ],
});
```

### 3.3 Bot トークン取得手順

1. [Discord Developer Portal](https://discord.com/developers/applications) にアクセス
2. "New Application" で新規アプリ作成
3. "Bot" タブで Bot を追加
4. "Reset Token" でトークン取得
5. "Privileged Gateway Intents" で必要なIntentsを有効化

---

## 4. コマンド仕様

### 4.1 `/join` コマンド

**機能**: コマンド実行者がいるVCにBotを参加させる

```typescript
// コマンド定義
{
  name: 'join',
  description: 'Botをボイスチャンネルに参加させます',
  options: [
    {
      name: 'channel',
      type: ApplicationCommandOptionType.Channel,
      description: '参加するボイスチャンネル（省略時は実行者のVC）',
      required: false,
      channel_types: [ChannelType.GuildVoice, ChannelType.GuildStageVoice],
    },
    {
      name: 'output_channel',
      type: ApplicationCommandOptionType.Channel,
      description: '文字起こし結果を投稿するテキストチャンネル',
      required: false,
      channel_types: [ChannelType.GuildText],
    },
  ],
}
```

**処理フロー**:

```
1. 実行者のVC確認（またはオプション指定）
2. 既に参加中か確認
3. VoiceConnection 作成
4. 音声受信開始
5. 成功メッセージ返却
```

**レスポンス例**:

```
✅ ボイスチャンネル「雑談」に参加しました
📝 文字起こし結果は #議事録 に投稿されます
```

---

### 4.2 `/leave` コマンド

**機能**: BotをVCから離脱させる

```typescript
{
  name: 'leave',
  description: 'Botをボイスチャンネルから離脱させます',
  options: [
    {
      name: 'save',
      type: ApplicationCommandOptionType.Boolean,
      description: 'セッションログを保存するか（デフォルト: true）',
      required: false,
    },
  ],
}
```

**処理フロー**:

```
1. 現在のVC接続確認
2. 未送信の音声セグメントを処理
3. セッションログ保存（オプション）
4. VoiceConnection 破棄
5. 完了メッセージ返却
```

---

### 4.3 `/status` コマンド（任意）

**機能**: 現在の状態を表示

```typescript
{
  name: 'status',
  description: '現在の文字起こし状態を表示します',
}
```

**レスポンス例**:

```
📊 Status
─────────────────
🎤 VC: 雑談
👥 参加者: 3人
⏱️ セッション時間: 00:15:32
📝 文字起こし数: 47件
💾 Whisper API: 正常
```

---

## 5. 音声受信仕様

### 5.1 VoiceConnection 設定

```typescript
import {
  joinVoiceChannel,
  VoiceConnectionStatus,
  entersState,
} from '@discordjs/voice';

const connection = joinVoiceChannel({
  channelId: voiceChannel.id,
  guildId: voiceChannel.guild.id,
  adapterCreator: voiceChannel.guild.voiceAdapterCreator,
  selfDeaf: false,  // 重要: 音声を受信するため false
  selfMute: true,   // Botは発言しない
});
```

### 5.2 音声受信ハンドラ

```typescript
import { VoiceReceiver, EndBehaviorType } from '@discordjs/voice';

const receiver: VoiceReceiver = connection.receiver;

// ユーザーが話し始めた時
receiver.speaking.on('start', (userId: string) => {
  const opusStream = receiver.subscribe(userId, {
    end: {
      behavior: EndBehaviorType.AfterSilence,
      duration: 600, // 600ms の無音で終了
    },
  });
  
  // OpusストリームをPCMにデコード
  const decoder = new prism.opus.Decoder({
    rate: 48000,
    channels: 2,
    frameSize: 960,
  });
  
  opusStream.pipe(decoder).pipe(userBuffer);
});
```

### 5.3 SSRC → UserID マッピング

Discord の音声パケットには SSRC (Synchronization Source) というIDが含まれる。
`@discordjs/voice` はこのマッピングを自動で行うため、直接 `userId` でストリームを取得可能。

```typescript
// SSRCMapper クラス（内部管理用）
interface SSRCUserInfo {
  userId: string;
  username: string;
  displayName: string;
  joinedAt: Date;
}

class SSRCMapper {
  private map = new Map<number, SSRCUserInfo>();

  register(ssrc: number, userId: string, member: GuildMember): void {
    this.map.set(ssrc, {
      userId: userId,
      username: member.user.username,
      displayName: member.displayName,
      joinedAt: new Date(),
    });
  }

  get(ssrc: number): SSRCUserInfo | undefined {
    return this.map.get(ssrc);
  }

  getByUserId(userId: string): SSRCUserInfo | undefined {
    for (const info of this.map.values()) {
      if (info.userId === userId) return info;
    }
    return undefined;
  }
}
```

---

## 6. ユーザー別音声バッファ

### 6.1 バッファ構造

```typescript
interface UserAudioBuffer {
  userId: string;
  username: string;
  displayName: string;
  chunks: AudioChunk[];
  startTimestamp: number | null;
  lastActivityTimestamp: number;
}

interface AudioChunk {
  data: Buffer;
  timestamp: number;
}
```

### 6.2 バッファ管理クラス

```typescript
class AudioBufferManager {
  private buffers = new Map<string, UserAudioBuffer>();
  private readonly maxBufferDuration = 10000; // 10秒
  private readonly silenceThreshold = 600;    // 600ms

  constructor(
    private segmenter: AudioSegmenter,
    private whisperClient: WhisperClient,
  ) {}

  // 音声データを追加
  appendAudio(userId: string, data: Buffer): void {
    const buffer = this.getOrCreateBuffer(userId);
    const now = Date.now();
    
    if (buffer.startTimestamp === null) {
      buffer.startTimestamp = now;
    }
    
    buffer.chunks.push({ data, timestamp: now });
    buffer.lastActivityTimestamp = now;
    
    // 最大長に達したら強制セグメント化
    if (this.getBufferDuration(buffer) >= this.maxBufferDuration) {
      this.flushBuffer(userId);
    }
  }

  // 無音検知でセグメント化
  checkSilence(userId: string): void {
    const buffer = this.buffers.get(userId);
    if (!buffer) return;
    
    const silenceDuration = Date.now() - buffer.lastActivityTimestamp;
    if (silenceDuration >= this.silenceThreshold) {
      this.flushBuffer(userId);
    }
  }

  // バッファをセグメントとして出力
  private async flushBuffer(userId: string): Promise<void> {
    const buffer = this.buffers.get(userId);
    if (!buffer || buffer.chunks.length === 0) return;
    
    const segment = this.segmenter.createSegment(buffer);
    this.resetBuffer(userId);
    
    // Whisper APIへ送信
    await this.whisperClient.transcribe(segment);
  }
}
```

---

## 7. エラーハンドリング

### 7.1 接続エラー

```typescript
connection.on(VoiceConnectionStatus.Disconnected, async () => {
  try {
    // 再接続を試みる（5秒以内）
    await Promise.race([
      entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
      entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
    ]);
  } catch {
    // 再接続失敗 → 切断
    connection.destroy();
    logger.error('VC connection lost and could not reconnect');
  }
});
```

### 7.2 エラーコード定義

```typescript
enum BotErrorCode {
  // 接続系
  NOT_IN_VOICE_CHANNEL = 'E001',
  ALREADY_CONNECTED = 'E002',
  CONNECTION_FAILED = 'E003',
  CONNECTION_LOST = 'E004',
  
  // 権限系
  MISSING_PERMISSIONS = 'E101',
  BOT_NOT_INVITED = 'E102',
  
  // 音声処理系
  AUDIO_BUFFER_OVERFLOW = 'E201',
  ENCODING_FAILED = 'E202',
  
  // API系
  WHISPER_API_UNAVAILABLE = 'E301',
  WHISPER_API_TIMEOUT = 'E302',
}
```

---

## 8. イベントフロー図

```
User speaks in VC
        │
        ▼
┌─────────────────────┐
│ receiver.speaking   │
│ 'start' event       │
└─────────────────────┘
        │
        ▼
┌─────────────────────┐
│ Subscribe to        │
│ OpusStream          │
└─────────────────────┘
        │
        ▼
┌─────────────────────┐
│ Decode Opus → PCM   │
│ (prism-media)       │
└─────────────────────┘
        │
        ▼
┌─────────────────────┐
│ Append to           │
│ UserAudioBuffer     │
└─────────────────────┘
        │
        ├──────────────────────────────┐
        │                              │
        ▼                              ▼
┌─────────────────────┐    ┌─────────────────────┐
│ Silence detected    │    │ Max duration        │
│ (600ms)             │    │ reached (10s)       │
└─────────────────────┘    └─────────────────────┘
        │                              │
        └──────────────┬───────────────┘
                       │
                       ▼
              ┌─────────────────────┐
              │ Create Segment      │
              │ (encode to OGG)     │
              └─────────────────────┘
                       │
                       ▼
              ┌─────────────────────┐
              │ Send to Whisper API │
              └─────────────────────┘
```

---

## 9. 依存パッケージ

```json
{
  "dependencies": {
    "discord.js": "^14.14.1",
    "@discordjs/voice": "^0.17.0",
    "@discordjs/opus": "^0.9.0",
    "prism-media": "^1.3.5",
    "sodium-native": "^4.0.4",
    "axios": "^1.6.2",
    "dotenv": "^16.3.1",
    "winston": "^3.11.0"
  },
  "devDependencies": {
    "typescript": "^5.3.2",
    "@types/node": "^20.10.0",
    "tsx": "^4.6.0",
    "eslint": "^8.55.0",
    "@typescript-eslint/eslint-plugin": "^6.13.0"
  }
}
```

---

## 10. 設定パラメータ

```typescript
// config/index.ts
export const botConfig = {
  // Discord
  token: process.env.DISCORD_BOT_TOKEN!,
  clientId: process.env.DISCORD_CLIENT_ID!,
  
  // 音声処理
  audio: {
    sampleRate: 48000,
    channels: 2,
    silenceThreshold: 600,      // 無音判定閾値 (ms)
    maxSegmentDuration: 10000,  // 最大セグメント長 (ms)
    minSegmentDuration: 500,    // 最小セグメント長 (ms)
  },
  
  // Whisper API
  whisper: {
    apiUrl: process.env.WHISPER_API_URL || 'http://localhost:8000',
    timeout: 60000,  // 60秒
    retryCount: 3,
    retryDelay: 1000,
  },
  
  // 出力
  output: {
    logDir: './logs',
    segmentDir: './segments',
    enableDiscordPost: true,
    enableFileLog: true,
    enableJsonStore: true,
  },
};
```

---

## 11. 次のドキュメント

- [02-audio-processing.md](./02-audio-processing.md) - 音声セグメント化詳細
- [03-whisper-api.md](./03-whisper-api.md) - Whisper API仕様

