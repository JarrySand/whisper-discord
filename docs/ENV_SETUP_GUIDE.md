# 🔧 環境設定ガイド

このガイドでは、whisper-discord Bot の環境変数（`.env`ファイル）の設定方法を説明します。

---

## 📋 クイックスタート

```bash
# 1. テンプレートをコピー
cd bot
cp env.template.txt .env

# 2. .env を編集して必要な値を設定
```

---

## 🔑 必須設定

### Discord Bot 認証情報

Discord Developer Portal から取得した情報を設定します。

| 環境変数 | 説明 | 取得方法 |
|----------|------|----------|
| `DISCORD_BOT_TOKEN` | Botトークン | [Discord Developer Portal](https://discord.com/developers/applications) → Bot → Token |
| `DISCORD_CLIENT_ID` | アプリケーションID | [Discord Developer Portal](https://discord.com/developers/applications) → General Information → Application ID |

```bash
DISCORD_BOT_TOKEN=your_discord_bot_token_here
DISCORD_CLIENT_ID=your_discord_client_id_here
```

---

## 🎤 文字起こしプロバイダー設定

3つのプロバイダーから選択できます。

### プロバイダー比較

| プロバイダー | モデル | 速度 | コスト | 特徴 |
|-------------|--------|------|--------|------|
| **Groq** ⭐推奨 | whisper-large-v3 | 超高速 | $0.0001/秒 | クラウド API、最もコスパが良い |
| **OpenAI** | whisper-1 | 高速 | $0.006/分 | 安定性が高い |
| **Self-hosted** | large-v3 等 | 環境依存 | 無料（電気代のみ） | プライバシー重視 |

### Groq（推奨）

```bash
TRANSCRIPTION_PROVIDER=groq
GROQ_API_KEY=gsk_xxxxxxxxxxxxx
GROQ_MODEL=whisper-large-v3
```

**API キー取得**: https://console.groq.com

**利用可能なモデル**:
- `whisper-large-v3` - 高精度
- `whisper-large-v3-turbo` - より高速

---

### OpenAI

```bash
TRANSCRIPTION_PROVIDER=openai
OPENAI_API_KEY=sk-xxxxxxxxxxxxx
```

**API キー取得**: https://platform.openai.com/api-keys

---

### Self-hosted (自前サーバー)

whisper-api/ ディレクトリのサーバーを使用する場合：

```bash
TRANSCRIPTION_PROVIDER=self-hosted
WHISPER_API_URL=http://localhost:8000
WHISPER_API_TIMEOUT=60000
```

---

## 🔊 音声処理設定

### 基本パラメータ

| 環境変数 | デフォルト | 説明 |
|----------|-----------|------|
| `AUDIO_SILENCE_THRESHOLD` | `1500` | 無音検知閾値（ms）。発話の区切りを検出する時間 |
| `AUDIO_MAX_SEGMENT_DURATION` | `30000` | 最大セグメント長（ms）。これより長い発話は分割 |
| `AUDIO_MIN_SEGMENT_DURATION` | `1000` | 最小セグメント長（ms）。これより短い発話は破棄 |
| `AUDIO_MIN_RMS_THRESHOLD` | `0.005` | 最小音量閾値。これ以下の音量は無視 |

### 推奨設定

```bash
# 標準設定（推奨）
AUDIO_SILENCE_THRESHOLD=1500
AUDIO_MAX_SEGMENT_DURATION=30000
AUDIO_MIN_SEGMENT_DURATION=1000
AUDIO_MIN_RMS_THRESHOLD=0.005
```

### チューニングガイド

#### 無音検知閾値 (`AUDIO_SILENCE_THRESHOLD`)

| 値 | 効果 |
|----|------|
| `500-1000ms` | 短い間で分割。早口の会話向け |
| `1000-2000ms` | **推奨**。自然な区切り |
| `2000ms以上` | 長い文脈が繋がる。講演・プレゼン向け |

#### 最大セグメント長 (`AUDIO_MAX_SEGMENT_DURATION`)

| 値 | 効果 | 注意点 |
|----|------|--------|
| `5000ms` | 低メモリ環境向け | 文脈が途切れやすい |
| `15000ms` | バランス型 | |
| `30000ms` | **推奨**。Whisper推奨上限 | 高精度、API呼び出し削減 |

#### 最小RMS閾値 (`AUDIO_MIN_RMS_THRESHOLD`)

| 値 | 検出レベル |
|----|------------|
| `0.005` | 非常に静かな音声も検出 |
| `0.01` | 静かな音声を検出 |
| `0.02` | 通常会話のみ検出（ノイズカット） |

---

## 📤 出力設定

### 出力先の有効化

```bash
OUTPUT_ENABLE_DISCORD_POST=true   # Discord チャンネルに投稿
OUTPUT_ENABLE_FILE_LOG=true       # テキストログファイル
OUTPUT_ENABLE_JSON_STORE=true     # JSONファイル保存
OUTPUT_ENABLE_MARKDOWN=true       # Markdownファイル出力
```

### 出力ディレクトリ

```bash
OUTPUT_LOG_DIR=./logs        # ログファイルの保存先
OUTPUT_SEGMENT_DIR=./segments  # 音声セグメントの保存先
```

### Discord 出力フォーマット

```bash
OUTPUT_DISCORD_FORMAT=standard           # standard / compact / embed
OUTPUT_DISCORD_SHOW_TIMESTAMP=true       # タイムスタンプ表示
OUTPUT_DISCORD_SHOW_CONFIDENCE=false     # 信頼度スコア表示
OUTPUT_DISCORD_BATCH_MESSAGES=true       # メッセージをバッチ処理
OUTPUT_DISCORD_BATCH_INTERVAL_MS=3000    # バッチ間隔（ms）
```

#### フォーマット例

**standard** (デフォルト):
```
🎤 ユーザー名 [12:34:56]
こんにちは、今日はよろしくお願いします。
```

**compact**:
```
[12:34] ユーザー名: こんにちは、今日はよろしくお願いします。
```

**embed**:
Discord Embed形式で表示（リッチな見た目）

---

## 🗄️ SQLite 検索機能（オプション）

過去の文字起こしを検索可能にする機能です。

```bash
ENABLE_SQLITE=false          # true で有効化
SQLITE_DB_DIR=./data         # DBファイルの保存先
SQLITE_CLEANUP_DAYS=30       # 30日以上前のデータを自動削除
```

**注意**: サーバーごとに個別のDBファイル（`guild_{guildId}.db`）が作成されます。

---

## 📊 ログ設定

```bash
LOG_LEVEL=info   # debug / info / warn / error
```

| レベル | 内容 |
|--------|------|
| `debug` | すべての詳細ログ（開発・デバッグ用） |
| `info` | 通常の動作ログ（**推奨**） |
| `warn` | 警告のみ |
| `error` | エラーのみ |

---

## 📦 設定例

### 最小構成（Groq 使用）

```bash
# Discord
DISCORD_BOT_TOKEN=your_token
DISCORD_CLIENT_ID=your_client_id

# Transcription
TRANSCRIPTION_PROVIDER=groq
GROQ_API_KEY=gsk_xxxxx
GROQ_MODEL=whisper-large-v3
```

### ⭐ 本番推奨設定（Render 運用実績あり）

以下は実際の本番環境で使用されている設定です。迷ったらこの設定をベースにしてください。

```bash
# ===========================================
# Discord Bot 認証（※自分の値に置き換え）
# ===========================================
DISCORD_BOT_TOKEN=your_token
DISCORD_CLIENT_ID=your_client_id

# ===========================================
# 文字起こしプロバイダー
# ===========================================
TRANSCRIPTION_PROVIDER=groq
GROQ_API_KEY=gsk_xxxxx           # ※自分のAPIキーに置き換え
GROQ_MODEL=whisper-large-v3

# ===========================================
# 音声処理（本番検証済み）
# ===========================================
AUDIO_SILENCE_THRESHOLD=1500       # 1.5秒の無音で発話区切り
AUDIO_MAX_SEGMENT_DURATION=30000   # 最大30秒（Whisper推奨上限）
AUDIO_MIN_SEGMENT_DURATION=1000    # 1秒未満の音声は破棄
AUDIO_MIN_RMS_THRESHOLD=0.005      # 静かな音声も拾う

# ===========================================
# 出力設定
# ===========================================
OUTPUT_LOG_DIR=./logs
OUTPUT_SEGMENT_DIR=./segments
OUTPUT_ENABLE_DISCORD_POST=true    # Discordに投稿
OUTPUT_ENABLE_FILE_LOG=true        # ログファイル保存
OUTPUT_ENABLE_JSON_STORE=true      # JSON保存（AI解析用）
OUTPUT_ENABLE_MARKDOWN=true        # Markdown議事録

# ===========================================
# Discord 出力フォーマット
# ===========================================
OUTPUT_DISCORD_FORMAT=standard
OUTPUT_DISCORD_SHOW_TIMESTAMP=true
OUTPUT_DISCORD_SHOW_CONFIDENCE=false
OUTPUT_DISCORD_BATCH_MESSAGES=true
OUTPUT_DISCORD_BATCH_INTERVAL_MS=3000   # 3秒ごとにバッチ送信

# ===========================================
# SQLite 検索機能（有効推奨）
# ===========================================
ENABLE_SQLITE=true                 # 過去の発言を検索可能に
SQLITE_DB_DIR=./data
SQLITE_CLEANUP_DAYS=30             # 30日で自動削除

# ===========================================
# ログ
# ===========================================
LOG_LEVEL=info
```

> 💡 **ポイント**:
> - `ENABLE_SQLITE=true` で `/search` コマンドが使えるようになります
> - `OUTPUT_DISCORD_BATCH_MESSAGES=true` で API レート制限を回避
> - `AUDIO_MAX_SEGMENT_DURATION=30000` で高精度な文字起こしを実現

---

## ❓ トラブルシューティング

### 「API key is invalid」エラー

- API キーが正しくコピーされているか確認
- キーの前後に空白がないか確認
- Groq/OpenAI のダッシュボードでキーが有効か確認

### 音声が検出されない

1. `AUDIO_MIN_RMS_THRESHOLD` を下げる（例: `0.003`）
2. `AUDIO_MIN_SEGMENT_DURATION` を下げる（例: `500`）

### 発話が途中で切れる

1. `AUDIO_SILENCE_THRESHOLD` を上げる（例: `2000`）
2. `AUDIO_MAX_SEGMENT_DURATION` を上げる（例: `30000`）

### メモリ不足

1. `AUDIO_MAX_SEGMENT_DURATION` を下げる（例: `5000`）
2. Self-hosted の場合は小さいモデルを使用

---

## 📚 関連ドキュメント

- [ユーザーガイド](USER_GUIDE.md) - 基本的な使い方
- [デプロイガイド](DEPLOY.md) - 本番環境へのデプロイ
- [詳細仕様: 環境変数](details/06-config-env.md) - 技術的な詳細

