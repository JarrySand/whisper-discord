# 🤖 Phase 1: Discord Bot 基盤

> **目標**: Discord VC に参加し、ユーザーごとの音声を受信・セグメント化する基盤を構築
>
> **期間目安**: 3-4日
>
> **仕様書**: [01-discord-bot.md](../docs/details/01-discord-bot.md) | [02-audio-processing.md](../docs/details/02-audio-processing.md)

---

## 📋 タスク一覧

### 1.1 プロジェクト初期化 (Day 1)

#### タスク

- [x] **T-1.1.1**: Bot プロジェクトディレクトリ作成
- [x] **T-1.1.2**: package.json 作成・依存関係インストール
- [x] **T-1.1.3**: TypeScript 設定 (tsconfig.json)
- [x] **T-1.1.4**: ESLint/Prettier 設定
- [x] **T-1.1.5**: 環境変数設定 (.env.example, .env)
- [x] **T-1.1.6**: ディレクトリ構造作成

#### 成果物

```
bot/
├── src/
│   ├── index.ts
│   ├── bot.ts
│   ├── config/
│   │   └── index.ts
│   └── types/
│       └── index.ts
├── package.json
├── tsconfig.json
├── .eslintrc.js
├── .env.example
└── .env
```

#### 依存関係

```json
{
  "dependencies": {
    "discord.js": "^14.14.1",
    "@discordjs/voice": "^0.17.0",
    "@discordjs/opus": "^0.9.0",
    "prism-media": "^1.3.5",
    "sodium-native": "^4.0.4",
    "dotenv": "^16.3.1",
    "winston": "^3.11.0",
    "uuid": "^9.0.0"
  },
  "devDependencies": {
    "typescript": "^5.3.2",
    "@types/node": "^20.10.0",
    "@types/uuid": "^9.0.0",
    "tsx": "^4.6.0",
    "eslint": "^8.55.0",
    "@typescript-eslint/eslint-plugin": "^6.13.0",
    "jest": "^29.7.0",
    "ts-jest": "^29.1.1",
    "@types/jest": "^29.5.11"
  }
}
```

> **Note**: Phase 3 で `axios`, `form-data` を追加します

---

### 1.2 Discord Client 初期化 (Day 1)

#### タスク

- [x] **T-1.2.1**: Discord Client 作成（Intents設定）
- [x] **T-1.2.2**: Bot ログイン処理
- [x] **T-1.2.3**: Ready イベントハンドラ
- [x] **T-1.2.4**: エラーハンドリング
- [x] **T-1.2.5**: Graceful shutdown 実装

#### 実装ポイント

```typescript
// src/bot.ts
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
  ],
});
```

#### 検証項目

- [x] Bot がオンラインになる（要 .env 設定）
- [x] Discord Developer Portal で権限確認
- [x] Ctrl+C で正常終了

---

### 1.3 スラッシュコマンド実装 (Day 2)

#### タスク

- [x] **T-1.3.1**: コマンドローダー作成
- [x] **T-1.3.2**: `/join` コマンド実装
- [x] **T-1.3.3**: `/leave` コマンド実装
- [x] **T-1.3.4**: コマンド登録スクリプト
- [x] **T-1.3.5**: `/status` コマンド実装（オプション）

#### /join コマンド仕様

```typescript
{
  name: 'join',
  description: 'Botをボイスチャンネルに参加させます',
  options: [
    {
      name: 'channel',
      type: ApplicationCommandOptionType.Channel,
      description: '参加するボイスチャンネル',
      required: false,
    },
    {
      name: 'output_channel',
      type: ApplicationCommandOptionType.Channel,
      description: '文字起こし結果の出力先',
      required: false,
    },
  ],
}
```

#### 検証項目

- [x] `/join` でVCに参加
- [x] `/leave` でVCから離脱
- [x] エラーメッセージが適切に表示

---

### 1.4 音声受信機構 (Day 2-3)

#### タスク

- [x] **T-1.4.1**: VoiceConnection 管理クラス作成
- [x] **T-1.4.2**: VoiceReceiver セットアップ
- [x] **T-1.4.3**: SSRC → UserID マッピング
- [x] **T-1.4.4**: Opus → PCM デコード
- [x] **T-1.4.5**: ユーザー別バッファリング

#### 実装ポイント

```typescript
// 音声受信
receiver.speaking.on('start', (userId: string) => {
  const opusStream = receiver.subscribe(userId, {
    end: {
      behavior: EndBehaviorType.AfterSilence,
      duration: 600, // 600ms の無音で終了
    },
  });
  // ...
});
```

#### 検証項目

- [x] 複数ユーザーの音声が分離される
- [x] SSRC マッピングが正しく動作
- [x] バッファが蓄積される

---

### 1.5 音声セグメント化 (Day 3-4)

#### タスク

- [x] **T-1.5.1**: 無音検知クラス (SilenceDetector)
- [x] **T-1.5.2**: セグメンター (AudioSegmenter)
- [x] **T-1.5.3**: リサンプリング (48kHz → 16kHz)
- [x] **T-1.5.4**: ステレオ → モノラル変換
- [x] **T-1.5.5**: セグメント作成・ID付与

#### セグメント仕様

| 項目 | 値 |
|------|-----|
| 最小長 | 500ms |
| 最大長 | 10秒 |
| 無音閾値 | 600ms |
| サンプルレート | 16kHz |
| チャンネル | Mono |

#### 検証項目

- [x] 無音で正しく区切られる
- [x] 最大長で強制分割
- [x] 短すぎるセグメントは破棄

---

### 1.6 音声エンコード (Day 4)

#### タスク

- [x] **T-1.6.1**: OGG/Opus エンコーダー（FFmpeg）
- [x] **T-1.6.2**: WAV エンコーダー（フォールバック）
- [x] **T-1.6.3**: セグメントファイル保存（オプション）
- [x] **T-1.6.4**: ファイルサイズ最適化

#### エンコード仕様

| 項目 | 値 |
|------|-----|
| フォーマット | OGG/Opus |
| ビットレート | 32kbps |
| 目標サイズ | 1分あたり < 1MB |

#### 検証項目

- [ ] OGG ファイルが正常に生成（FFmpegインストール後に確認）
- [x] FFmpeg なしでも WAV で動作
- [x] ファイルサイズが適切

---

## 🧪 Phase 1 完了テスト

### 単体テスト

- [ ] SSRCMapper テスト
- [ ] SilenceDetector テスト
- [ ] AudioSegmenter テスト
- [ ] AudioEncoder テスト

### 結合テスト

- [x] VC参加 → 音声受信 → セグメント生成 の一連フロー
- [ ] 複数ユーザー同時発話（追加テスト推奨）
- [ ] 長時間セッション（10分以上）（追加テスト推奨）

### 手動テスト

```
1. /join でVC参加
2. 複数人で会話
3. ログでセグメント生成を確認
4. /leave でVC離脱
5. セグメントファイル（保存設定時）を確認
```

---

## 📁 成果物ディレクトリ構造

```
bot/
├── src/
│   ├── index.ts              # エントリーポイント
│   ├── bot.ts                # Discord Client
│   ├── commands/
│   │   ├── index.ts          # コマンドローダー
│   │   ├── join.ts
│   │   └── leave.ts
│   ├── voice/
│   │   ├── connection.ts     # VC接続管理
│   │   ├── receiver.ts       # 音声受信
│   │   └── ssrc-mapper.ts    # SSRC管理
│   ├── audio/
│   │   ├── buffer.ts         # ユーザー別バッファ
│   │   ├── segmenter.ts      # セグメント分割
│   │   ├── silence-detector.ts
│   │   └── encoder.ts        # OGG/WAVエンコード
│   ├── config/
│   │   └── index.ts
│   ├── utils/
│   │   ├── logger.ts
│   │   └── time.ts
│   └── types/
│       └── index.ts
├── package.json
├── tsconfig.json
└── .env
```

---

## ⚠️ 注意事項

### Discord 権限

```
GUILD_VOICE_STATES     - VC状態の監視
CONNECT                - VCへの接続
SPEAK                  - VCでの発言（音声受信に必要）
SEND_MESSAGES          - テキストチャンネルへの投稿
USE_APPLICATION_COMMANDS
```

### システム要件

- **FFmpeg**: OGG エンコードに必要
  - Windows: `choco install ffmpeg`
  - Linux: `apt install ffmpeg`
  - macOS: `brew install ffmpeg`

### トラブルシューティング

| 問題 | 原因 | 対策 |
|------|------|------|
| Bot が VC に参加できない | 権限不足 | Bot に CONNECT 権限付与 |
| 音声が受信できない | selfDeaf が true | `selfDeaf: false` に設定 |
| Opus エラー | @discordjs/opus 未インストール | `pnpm add @discordjs/opus` |

---

**次のステップ**: [Phase 2 - Whisper API サーバー](./PHASE_2.md)

