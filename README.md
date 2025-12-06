# 🎙️ Whisper Discord Bot

> Discord ボイスチャンネルの会話を、**話者識別付き**でリアルタイム文字起こしする Bot

<p align="center">
  <img src="https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Python-3776AB?style=for-the-badge&logo=python&logoColor=white" alt="Python" />
  <img src="https://img.shields.io/badge/Discord-5865F2?style=for-the-badge&logo=discord&logoColor=white" alt="Discord" />
  <img src="https://img.shields.io/badge/Whisper-412991?style=for-the-badge&logo=openai&logoColor=white" alt="Whisper" />
</p>

---

## 💡 このプロジェクトについて

本プロジェクトは、「Discord VC の議事録を高精度で作成したい」という要望から生まれました。

既存の文字起こしBot（Seavoice等）では以下の課題がありました：

> - Discord音声の圧縮（Opus）による品質劣化
> - 複数人同時発話での精度低下
> - 「うん」「はい」等の相槌まみれ
> - 専門用語（DAO、NFT等）の誤認識
> - 話者識別の精度不足
> - Whisperのハルシネーション（幻覚）

これらすべての課題を解決し、**高品質な日本語文字起こし**を実現しています。

### ✅ 要件達成状況

| 元の要件 | 実装状況 |
|---------|----------|
| 🎯 後から全文検索できる | ✅ `/search` コマンド（SQLite） |
| 🎯 話者識別（誰が何を話したか） | ✅ Discord SSRC で100%正確 |
| 🎯 相槌を自動削除 | ✅ 30+パターンの相槌フィルター |
| 🎯 高精度STT（Whisper large-v3） | ✅ Local / Groq / OpenAI 選択可能 |
| 🎯 日本語特化 | ✅ initial_prompt + hotwords対応 |
| 🎯 ユーザーごとの音声取得 | ✅ Voice Receive API で個別録音 |
| 🎯 リアルタイム性は不要 | ✅ **さらにリアルタイム投稿も実装** |
| 🎯 議事録化は不要 | ✅ **さらにMarkdown議事録も自動生成** |

> 📄 開発経緯の詳細は [`difficulty.md`](./difficulty.md) を参照

---

## 📖 目次

- [💡 このプロジェクトについて](#-このプロジェクトについて)
- [🚀 クイックスタート](#-クイックスタート)
- [✨ 機能一覧](#-機能一覧)
- [📋 使い方](#-使い方)
- [🔬 高品質文字起こしの仕組み](#-高品質文字起こしの仕組み)
- [🏗️ システムアーキテクチャ](#️-システムアーキテクチャ)
- [⚙️ 設定オプション](#️-設定オプション)
- [📚 ドキュメント](#-ドキュメント)

---

# 🚀 クイックスタート

## 必要環境

| 項目 | 要件 |
|------|------|
| OS | Windows 10/11, Linux, macOS |
| Node.js | 20.x 以上 |
| Python | 3.10 以上 |
| FFmpeg | 必須（音声エンコード用） |
| RAM | 8GB 以上（16GB推奨）※ローカル使用時 |

## セットアップ

### 1. Whisper API サーバーの起動

```powershell
cd whisper-api

# 仮想環境を作成・有効化
python -m venv venv
.\venv\Scripts\Activate.ps1  # Windows
# source venv/bin/activate   # Linux/macOS

# 依存関係インストール
pip install -r requirements.txt

# 環境設定
cp env.example .env
# .env を編集してプロバイダーを選択

# サーバー起動
uvicorn src.main:app --port 8000
```

### 2. Discord Bot の起動

```powershell
cd bot

# 環境設定
cp env.template.txt .env
# .env に DISCORD_BOT_TOKEN と DISCORD_CLIENT_ID を設定

# 依存関係インストール
npm install

# コマンド登録（初回のみ）
npm run register-commands

# Bot 起動
npm start
```

### 3. Discord Developer Portal での設定

1. [Discord Developer Portal](https://discord.com/developers/applications) でアプリ作成
2. Bot タブで Bot を追加し、トークンをコピー
3. OAuth2 → URL Generator で選択:
   - Scopes: `bot`, `applications.commands`
   - Bot Permissions: `Connect`, `Speak`, `Send Messages`, `Read Message History`
4. 生成されたURLでサーバーに招待

---

# ✨ 機能一覧

| 機能 | 説明 |
|------|------|
| 🎤 **リアルタイム文字起こし** | VC参加中の会話を即座にテキスト化 |
| 👥 **話者識別** | 発言者を自動で識別してラベル付け |
| 🇯🇵 **日本語特化** | 高精度な日本語音声認識 |
| 📝 **複数形式出力** | Discord投稿、ログファイル、JSON、Markdown |
| 🔍 **検索機能** | 過去の発言をサーバー別に検索可能 |
| ☁️ **複数プロバイダー対応** | ローカル/Groq/OpenAI から選択可能 |
| 🧹 **相槌フィルター** | 「うん」「はい」等を自動除去 |
| 🛡️ **ハルシネーション対策** | Whisperの幻覚を検出・除去 |

---

# 📋 使い方

## 基本的な流れ

```
1. Bot をボイスチャンネルに招待  →  /join
2. 会話を開始                    →  自動で文字起こし
3. テキストチャンネルで確認      →  リアルタイム表示
4. 終了                          →  /leave
```

## コマンド一覧

### `/join`
Bot をボイスチャンネルに参加させます。
- 事前に自分がボイスチャンネルに接続している必要があります
- 文字起こし結果はコマンドを実行したテキストチャンネルに投稿されます
- 出力チャンネルは自動的に記憶され、次回以降も同じチャンネルに出力されます

### `/leave`
Bot をボイスチャンネルから退出させます。
- セッションが終了し、ログファイルが確定します

### `/status`
現在の文字起こしステータスを表示します。
- 接続状態、処理統計、キュー状態、API状態など

### `/search keyword:検索ワード` (SQLite有効時)
過去の発言を検索します。
- `user:@ユーザー名` で特定ユーザーに絞り込み可能

## 📂 出力形式

セッション終了時（`/leave`）に、以下の形式でログが自動保存されます。

| 形式 | ファイル | 用途 |
|------|---------|------|
| 📢 Discord投稿 | - | リアルタイム確認 |
| 📄 ログファイル | `logs/YYYY-MM-DD/session-*.log` | シンプルなテキスト記録 |
| 📊 JSON | `logs/YYYY-MM-DD/session-*.json` | プログラム処理・AI解析用 |
| 📝 **Markdown議事録** | `logs/YYYY-MM-DD/session-*.md` | 議事録・ドキュメント共有 |
| 🗄️ SQLite | `data/guild_{guildId}.db` | 検索用データベース（オプション） |

### Discord リアルタイム投稿

```
[14:23:15] Alice: こんにちは、今日の会議を始めましょう
[14:23:22] Bob: よろしくお願いします
[14:24:01] Alice: では議題1から進めていきます
```

### 📝 Markdown 議事録（自動生成）

会議終了後、そのまま共有できる議事録形式で自動出力されます。

```markdown
# 会議メモ - 2025-12-05 14:23

## 📋 セッション情報
- **チャンネル**: 雑談部屋
- **開始**: 14:23:00
- **終了**: 15:30:45
- **参加者**: Alice, Bob, Charlie

---

## 💬 会話ログ

### 14:23:15 - Alice
こんにちは、今日の会議を始めましょう

### 14:23:22 - Bob
よろしくお願いします

### 14:24:01 - Alice
では議題1から進めていきます

---

## 📊 統計
- 発話数: 156件
- セッション時間: 1:07:45
```

### 📊 JSON 形式（AI解析用）

```json
{
  "session": {
    "id": "session-2025-12-05-14-23-00",
    "started_at": "2025-12-05T14:23:00.000Z",
    "ended_at": "2025-12-05T15:30:45.000Z",
    "channel": "雑談部屋"
  },
  "utterances": [
    {
      "user_id": "123456789",
      "username": "Alice",
      "display_name": "アリス",
      "text": "こんにちは、今日の会議を始めましょう",
      "start_ts": 1733403795000,
      "end_ts": 1733403798500,
      "confidence": 0.95
    }
  ]
}
```

---

# 🔬 高品質文字起こしの仕組み

## なぜ日本語文字起こしは難しいのか

| 課題 | 説明 |
|------|------|
| **同音異義語** | 日本語は同じ発音で異なる意味の単語が多い |
| **文脈依存性** | 文末まで聞かないと意味が確定しない言語構造 |
| **相槌文化** | 「うん」「はい」「なるほど」等の大量の相槌 |
| **専門用語** | カタカナ語、略語、固有名詞の認識困難 |

## 本システムの解決策

### 1. 100%正確な話者識別

Discord の SSRC（Synchronization Source）を活用した話者識別を実装。AIベースの声紋認識は不要で、同時発話でも個別に記録可能。

```
Discord SSRC → User ID マッピング → 確実な話者識別
```

### 2. 日本語特化 Initial Prompt

Whisper に日本語会話のコンテキストを事前に与えることで認識精度を向上。

```python
initial_prompt = "これは日本語の会話です。Discordのボイスチャンネルで話しています。"
```

### 3. Hotwords（専門用語対応）

`config/hotwords.json` に専門用語を登録することで、認識精度を向上。

```json
{
  "hotwords": ["DAO", "NFT", "Ethereum", "スマートコントラクト"]
}
```

### 4. 最適なセグメント分割

日本語の発話パターンに最適化したパラメータ設計。

| パラメータ | 値 | 理由 |
|-----------|-----|------|
| 最大長 | 8秒 | Whisperが処理しやすい長さ |
| 最小長 | 1秒 | 相槌レベルの短い発話は除外 |
| 無音閾値 | 800ms | 日本語の「間」を考慮 |

### 5. Bot側フィルタリング

文字起こし後に以下のフィルターを適用：

- **相槌フィルター**: 「うん」「はい」「なるほど」等を除去
- **ハルシネーションフィルター**: 繰り返しパターン、定型句を検出・除去
- **低音量セグメント除去**: 環境ノイズを事前に除外

### 6. マルチプロバイダー対応

用途に応じて最適なプロバイダーを選択可能。

| プロバイダー | 特徴 | コスト | 速度 |
|-------------|------|--------|------|
| **Local** (デフォルト) | ローカルGPU/CPUで処理 | 無料 | 中速 |
| **Groq** | クラウドAPI、超高速 | $0.0001/秒 | 超高速 |
| **OpenAI** | 公式Whisper API | $0.006/分 | 高速 |

---

# 🏗️ システムアーキテクチャ

## コンポーネント構成

```
┌─────────────────────────────────────────────────────────────────┐
│                      Discord Voice Channel                       │
│    User A ─────┐                                                 │
│    User B ─────┼──── Opus Audio Stream (48kHz, Stereo)          │
│    User C ─────┘          │                                      │
└───────────────────────────┼─────────────────────────────────────┘
                            ▼
┌───────────────────────────────────────────────────────────────────┐
│                     Discord Bot (TypeScript)                      │
│  • Voice Receiver: SSRC → User ID マッピング（話者識別の核心）    │
│  • Audio Segmenter: 無音検知、セグメント分割、OGGエンコード       │
│  • Transcription Service: サーキットブレーカー、キュー管理        │
└────────────────────────────┼──────────────────────────────────────┘
                             │ HTTP POST (multipart/form-data)
                             ▼
┌───────────────────────────────────────────────────────────────────┐
│                    Whisper API Server (Python)                    │
│  • Provider Selector: Local / Groq / OpenAI から選択              │
│  • Hotwords & Japanese Context: 日本語特化設定                    │
└────────────────────────────┼──────────────────────────────────────┘
                             │ JSON Response
                             ▼
┌───────────────────────────────────────────────────────────────────┐
│              Post-Processing Filters (Bot側)                      │
│  • AizuchiFilter (相槌フィルター)                                 │
│  • HallucinationFilter (ハルシネーション除去)                     │
└────────────────────────────┼──────────────────────────────────────┘
                             ▼
┌───────────────────────────────────────────────────────────────────┐
│                       Output Manager                              │
│  • Discord 投稿 (リアルタイム)                                    │
│  • ログファイル (.log)                                            │
│  • JSON ストレージ (.json)                                        │
│  • Markdown 議事録 (.md)                                          │
│  • SQLite データベース (サーバー別)                               │
└───────────────────────────────────────────────────────────────────┘
```

## 技術スタック

| コンポーネント | 技術 | 選定理由 |
|--------------|------|---------|
| Bot | TypeScript + discord.js v14 | 型安全性、活発なコミュニティ |
| 音声処理 | @discordjs/voice, prism-media | Discord公式ライブラリ |
| Whisper (Local) | faster-whisper (CTranslate2) | CPU/GPU両対応、高速推論 |
| Whisper (Cloud) | Groq API, OpenAI API | 高速、スケーラブル |
| API | FastAPI + Uvicorn | 高性能非同期処理 |
| モデル | Whisper large-v3 | 日本語認識精度最高 |

## ディレクトリ構造

```
whisper-discord/
├── bot/                      # Discord Bot (TypeScript)
│   ├── src/
│   │   ├── index.ts          # エントリーポイント
│   │   ├── commands/         # スラッシュコマンド
│   │   ├── voice/            # 音声受信・SSRC管理
│   │   ├── audio/            # セグメント化・エンコード
│   │   ├── api/              # Whisper APIクライアント
│   │   ├── filters/          # 相槌・ハルシネーションフィルター
│   │   ├── output/           # 出力管理
│   │   └── services/         # ビジネスロジック
│   └── .env
│
├── whisper-api/              # Whisper API (Python)
│   ├── src/
│   │   ├── main.py           # FastAPIアプリ
│   │   ├── api/              # エンドポイント
│   │   ├── services/         # Whisper推論
│   │   └── core/             # 設定・ログ
│   └── .env
│
├── config/
│   └── hotwords.json         # 専門用語登録
│
├── docs/                     # ドキュメント
│   ├── USER_GUIDE.md         # ユーザーガイド
│   ├── TECHNICAL_OVERVIEW.md # 技術概要
│   └── spec.md               # 詳細仕様
│
└── logs/                     # ログ出力
    └── YYYY-MM-DD/
```

---

# ⚙️ 設定オプション

## Bot 設定 (`bot/.env`)

```bash
# === Discord ===
DISCORD_BOT_TOKEN=your_token_here
DISCORD_CLIENT_ID=your_client_id

# === Whisper API接続 ===
WHISPER_API_URL=http://localhost:8000
WHISPER_API_TIMEOUT=60000

# === 音声処理 ===
AUDIO_SILENCE_THRESHOLD=800      # 無音検知閾値 (ms)
AUDIO_MAX_SEGMENT_DURATION=8000  # 最大セグメント長 (ms)
AUDIO_MIN_SEGMENT_DURATION=1000  # 最小セグメント長 (ms)
AUDIO_MIN_RMS_THRESHOLD=0.005    # 最小音量閾値

# === 出力設定 ===
OUTPUT_LOG_DIR=./logs
OUTPUT_ENABLE_DISCORD_POST=true  # Discord投稿
OUTPUT_ENABLE_FILE_LOG=true      # ログファイル
OUTPUT_ENABLE_JSON_STORE=true    # JSON保存
OUTPUT_ENABLE_MARKDOWN=true      # Markdown保存

# === SQLite検索（オプション）===
ENABLE_SQLITE=false
SQLITE_DB_DIR=./data
```

## Whisper API 設定 (`whisper-api/.env`)

```bash
# === プロバイダー選択 ===
WHISPER_PROVIDER=local    # local, groq, openai

# === API キー (クラウド使用時) ===
WHISPER_GROQ_API_KEY=     # Groq APIキー
WHISPER_OPENAI_API_KEY=   # OpenAI APIキー

# === ローカルモデル設定 ===
WHISPER_MODEL_NAME=large-v3
WHISPER_DEVICE=auto       # cpu, cuda, auto
WHISPER_COMPUTE_TYPE=auto # int8, float16, float32

# === 日本語特化設定 ===
WHISPER_LANGUAGE=ja
WHISPER_HOTWORDS_FILE=../config/hotwords.json
```

---

# 📚 ドキュメント

| ドキュメント | 内容 | 対象読者 |
|-------------|------|---------|
| [USER_GUIDE.md](./docs/USER_GUIDE.md) | 使い方・機能一覧・トラブルシューティング | 一般ユーザー |
| [TECHNICAL_OVERVIEW.md](./docs/TECHNICAL_OVERVIEW.md) | 高品質日本語文字起こしの技術解説 | エンジニア |
| [spec.md](./docs/spec.md) | 詳細な設計仕様 | 開発者 |

### 詳細仕様

| ドキュメント | 内容 |
|-------------|------|
| [01-discord-bot.md](./docs/details/01-discord-bot.md) | Bot基盤・コマンド・音声受信 |
| [02-audio-processing.md](./docs/details/02-audio-processing.md) | 音声セグメント化・無音検知 |
| [03-whisper-api.md](./docs/details/03-whisper-api.md) | Whisper API サーバー |
| [04-output-logging.md](./docs/details/04-output-logging.md) | 出力・ログ・JSON保存 |
| [05-integration.md](./docs/details/05-integration.md) | Bot⇔API連携・リトライ |

---

## 📄 ライセンス

MIT License

---

## 🤝 Contributing

Issue や Pull Request を歓迎します！

