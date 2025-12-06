# 📖 Discord 文字起こしBot ユーザーガイド

> **バージョン**: 1.1.0  
> **最終更新**: 2025-12-05

---

## 📋 目次

1. [概要](#概要)
2. [機能一覧](#機能一覧)
3. [セットアップ](#セットアップ)
4. [使い方](#使い方)
5. [コマンドリファレンス](#コマンドリファレンス)
6. [出力形式](#出力形式)
7. [プロバイダー選択ガイド](#プロバイダー選択ガイド)
8. [設定オプション](#設定オプション)
9. [トラブルシューティング](#トラブルシューティング)

---

## 概要

Discord 文字起こしBotは、Discordのボイスチャンネルの会話をリアルタイムで文字起こしするツールです。話者識別機能により、**誰が何を話したか**を自動で記録できます。

### 主な特徴

| 特徴 | 説明 |
|------|------|
| 🎤 **リアルタイム文字起こし** | VC参加中の会話を即座にテキスト化 |
| 👥 **話者識別** | 発言者を自動で識別してラベル付け |
| 🇯🇵 **日本語特化** | 高精度な日本語音声認識 |
| 📝 **複数形式出力** | Discord投稿、ログファイル、JSON、Markdown |
| 🔍 **検索機能** | 過去の発言をサーバー別に検索可能 |
| ☁️ **複数プロバイダー対応** | ローカル/Groq/OpenAI から選択可能 |
| ⚙️ **カスタマイズ可能** | 専門用語対応、相槌フィルターなど |
| 💾 **サーバー設定記憶** | デフォルト出力チャンネルを記憶 |

### システム構成

```
Discord VC  →  Bot (TypeScript)  →  Whisper API (Python)  →  文字起こし結果
     ↓              ↓                      ↓                      ↓
  音声受信      話者識別            音声→テキスト変換         複数形式で出力
              フィルタリング     (Local/Groq/OpenAI)
```

---

## 機能一覧

### 🎯 コア機能

#### 1. リアルタイム文字起こし
- ボイスチャンネルの会話をリアルタイムで文字起こし
- 発話から約3〜10秒後にテキスト化（CPU環境）
- Whisper large-v3モデルによる高精度認識

#### 2. 話者識別
- Discord のユーザー情報を活用した正確な話者識別
- 各発言に発言者名とタイムスタンプを自動付与
- サーバーでの表示名（ニックネーム）にも対応

#### 3. 複数形式出力
| 形式 | 用途 | 保存先 |
|------|------|--------|
| Discord投稿 | リアルタイム確認 | 指定テキストチャンネル |
| ログファイル (.log) | シンプルなテキスト記録 | `logs/YYYY-MM-DD/` |
| JSON (.json) | プログラム処理用 | `logs/YYYY-MM-DD/` |
| Markdown (.md) | 議事録・ドキュメント用 | `logs/YYYY-MM-DD/` |
| SQLite (オプション) | 検索用データベース | `data/guild_{guildId}.db` |

#### 4. サーバー設定の永続化 🆕
- `/join` を実行したテキストチャンネルをデフォルト出力先として記憶
- 次回以降、同じサーバーで自動的に前回のチャンネルを使用
- サーバーごとに個別の設定を保存

### ☁️ プロバイダー選択 🆕

3つの文字起こしプロバイダーから選択可能：

| プロバイダー | 特徴 | コスト | 速度 |
|-------------|------|--------|------|
| **Local** (デフォルト) | ローカルGPU/CPUで処理 | 無料 | 中速 |
| **Groq** | クラウドAPI、超高速 | $0.0001/秒 | 超高速 |
| **OpenAI** | 公式Whisper API | $0.006/分 | 高速 |

### 🔧 高品質化機能

#### 5. 相槌フィルター (Bot側で処理)
「うん」「はい」「なるほど」などの相槌を自動除去し、クリーンなログを生成。

**対象例**:
- 基本相槌: うん、はい、ええ、へー
- フィラー: えーと、あのー、なんか
- 同意: そうですね、確かに、だね
- 感嘆: おー、すごい、ふーん
- 笑い: www、(笑)、ふふふ

#### 6. ハルシネーション対策 (Bot側で処理)
Whisperが稀に生成する幻覚（意味不明な繰り返しなど）を検出・除去。

**検出パターン**:
- 同じフレーズの過度な繰り返し
- 「字幕提供」「ご視聴ありがとうございました」等の定型句
- 意味のない記号の羅列

#### 7. Hotwords（専門用語対応）
DAO、NFT、Web3などの専門用語を事前登録することで認識精度を向上。

```json
// config/hotwords.json
{
  "hotwords": ["DAO", "NFT", "Ethereum", "スマートコントラクト"]
}
```

#### 8. 低音量セグメント除去
マイクの環境ノイズや無音に近いセグメントを自動除去し、API負荷を軽減。

### 🛡️ 信頼性機能

#### 9. サーキットブレーカー
API障害時に自動でリクエストを停止し、復旧後に再開。

#### 10. ヘルスモニタリング
Whisper APIの状態を常時監視し、異常を検知。

#### 11. 処理キュー
複数の音声セグメントを効率的に処理するキューシステム。

#### 12. サーバー別データベース 🆕
SQLite機能有効時、各サーバーのデータは独立したDBファイルに保存。他サーバーのデータにアクセス不可能なセキュアな設計。

---

## セットアップ

### 必要環境

| 項目 | 要件 |
|------|------|
| OS | Windows 10/11, Linux, macOS |
| Node.js | 20.x 以上 |
| Python | 3.10 以上 |
| RAM | 8GB 以上（16GB推奨）※ローカル使用時 |
| ストレージ | 10GB 以上（モデル用）※ローカル使用時 |
| FFmpeg | 必須（音声エンコード用） |

### クイックスタート

#### 1. Whisper API サーバーの起動

```powershell
# whisper-api ディレクトリに移動
cd whisper-api

# 仮想環境を有効化
.\venv\Scripts\Activate.ps1  # Windows
# source venv/bin/activate   # Linux/macOS

# .env を設定（プロバイダーを選択）
# WHISPER_PROVIDER=local  # または groq, openai

# サーバー起動
uvicorn src.main:app --port 8000
```

#### 2. Discord Bot の起動

```powershell
# bot ディレクトリに移動
cd bot

# .env ファイルを作成（env.template.txt をコピー）
cp env.template.txt .env
# DISCORD_BOT_TOKEN と DISCORD_CLIENT_ID を設定

# 依存関係インストール（初回のみ）
npm install

# コマンド登録（初回のみ）
npm run register-commands

# Bot 起動
npm start
```

### Discord Bot の作成・招待

1. [Discord Developer Portal](https://discord.com/developers/applications) でアプリ作成
2. Bot タブで Bot を追加し、トークンをコピー
3. OAuth2 → URL Generator で以下を選択:
   - Scopes: `bot`, `applications.commands`
   - Bot Permissions: `Connect`, `Speak`, `Send Messages`, `Read Message History`
4. 生成されたURLでサーバーに招待

---

## 使い方

### 基本的な流れ

```
1. Bot をボイスチャンネルに招待  →  /join
2. 会話を開始                    →  自動で文字起こし
3. テキストチャンネルで確認      →  リアルタイム表示
4. 終了                          →  /leave
```

### ステップバイステップ

#### 1. Bot をボイスチャンネルに参加させる

1. 自分がボイスチャンネルに接続
2. テキストチャンネルで `/join` コマンドを実行
3. Bot がボイスチャンネルに参加

```
/join
```

**注意**: 事前に自分がボイスチャンネルにいる必要があります。

**🆕 自動記憶機能**: `/join` を実行したテキストチャンネルは自動的にデフォルト出力先として記憶されます。次回以降は `/join` だけで同じチャンネルに出力されます。

#### 2. 会話を行う

- 普通に会話するだけで自動的に文字起こしされます
- 結果は `/join` を実行したテキストチャンネルに投稿されます
- 相槌（うん、はい等）は自動的にフィルタリングされます 🆕

**出力例**:
```
[14:23:15] Alice: こんにちは、今日の会議を始めましょう
[14:23:22] Bob: よろしくお願いします
```

#### 3. ステータスを確認する

```
/status
```

現在の処理状況、成功率、キューの状態などを確認できます。

#### 4. 過去の発言を検索する（SQLite有効時）

```
/search keyword:議事録
/search keyword:予算 user:@Alice
```

**🆕 サーバー別検索**: 検索は実行したサーバーのデータのみを対象とします。他サーバーのデータは見えません。

#### 5. Bot を退出させる

```
/leave
```

Bot がボイスチャンネルから退出し、セッションが終了します。
ログファイルは `logs/YYYY-MM-DD/` に保存されます。

---

## コマンドリファレンス

### `/join`
Bot をボイスチャンネルに参加させます。

| 項目 | 説明 |
|------|------|
| 権限 | なし（誰でも使用可能） |
| 前提条件 | コマンド実行者がVCに接続中 |
| 出力先 | コマンド実行したテキストチャンネル |
| 🆕 自動記憶 | 出力チャンネルをサーバー設定として保存 |

### `/leave`
Bot をボイスチャンネルから退出させます。

| 項目 | 説明 |
|------|------|
| 権限 | なし |
| 効果 | セッション終了、ログファイル確定 |

### `/status`
現在の文字起こしステータスを表示します。

**表示項目**:
- 接続状態（接続中/未接続）
- 処理統計（成功率、処理件数）
- キュー状態（待機中のセグメント数）
- API状態（正常/異常）
- 出力ファイルパス
- 🆕 フィルター統計（相槌/ハルシネーション除去数）

### `/search` (オプション)
過去の発言を検索します。SQLite機能が有効な場合のみ使用可能。

| オプション | 説明 | 必須 |
|-----------|------|------|
| `keyword` | 検索キーワード | ✅ |
| `user` | 特定ユーザーに絞り込み | ❌ |
| `limit` | 結果の最大件数（1-50） | ❌ |

---

## 出力形式

### Discord 投稿形式

```
[14:23:15] Alice: こんにちは、今日の会議を始めましょう
```

設定により以下の表示も可能:
- タイムスタンプの表示/非表示
- 信頼度の表示
- バッチ投稿（複数発言をまとめて投稿）

### ログファイル (.log)

```
=== セッション開始 2025-12-05 14:23:00 ===
チャンネル: 雑談部屋

[14:23:15] Alice: こんにちは、今日の会議を始めましょう
[14:23:22] Bob: よろしくお願いします
[14:24:01] Alice: では議題1から進めていきます

=== セッション終了 15:30:45 ===
発話数: 156件 | 参加者: Alice, Bob, Charlie
```

### JSON形式 (.json)

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

### Markdown形式 (.md)

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

---

## 📊 統計
- 発話数: 156件
- セッション時間: 1:07:45
```

---

## プロバイダー選択ガイド 🆕

### 比較表

| 項目 | Local | Groq | OpenAI |
|------|-------|------|--------|
| **コスト** | 無料 | $0.0001/秒 | $0.006/分 |
| **速度** | 中速（CPU依存） | 超高速 | 高速 |
| **モデル** | large-v3 | large-v3 / large-v3-turbo | whisper-1 |
| **精度** | ★★★★★ | ★★★★★ | ★★★★☆ |
| **インターネット** | 不要 | 必要 | 必要 |
| **セットアップ** | やや複雑 | 簡単 | 簡単 |

### 用途別おすすめ

| 用途 | おすすめ | 理由 |
|------|---------|------|
| 日常使用（コスト重視） | **Local** | 無料で高品質 |
| 会議議事録（品質重視） | **Local/Groq** | large-v3の高精度 |
| 低スペックPC | **Groq** | サーバー処理で高速 |
| 安定性重視 | **OpenAI** | 公式APIで安定 |

### 設定方法

`whisper-api/.env` で設定:

```bash
# ローカル (デフォルト)
WHISPER_PROVIDER=local

# Groq (要APIキー)
WHISPER_PROVIDER=groq
WHISPER_GROQ_API_KEY=gsk_xxxxx

# OpenAI (要APIキー)
WHISPER_PROVIDER=openai
WHISPER_OPENAI_API_KEY=sk-xxxxx
```

---

## 設定オプション

### Bot 設定 (`bot/.env`)

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

# === Discord出力形式 ===
OUTPUT_DISCORD_SHOW_TIMESTAMP=true
OUTPUT_DISCORD_SHOW_CONFIDENCE=false
OUTPUT_DISCORD_BATCH_MESSAGES=true
OUTPUT_DISCORD_BATCH_INTERVAL_MS=3000

# === SQLite検索（オプション）===
ENABLE_SQLITE=false
SQLITE_DB_DIR=./data              # サーバー別DBの保存先
SQLITE_CLEANUP_DAYS=30
```

### Whisper API 設定 (`whisper-api/.env`)

```bash
# === プロバイダー選択 ===
WHISPER_PROVIDER=local    # local, groq, openai

# === API キー (クラウド使用時) ===
WHISPER_GROQ_API_KEY=     # Groq APIキー
WHISPER_OPENAI_API_KEY=   # OpenAI APIキー

# === ローカルモデル設定 ===
WHISPER_MODEL_NAME=large-v3
WHISPER_DEVICE=auto           # cpu, cuda, auto
WHISPER_COMPUTE_TYPE=auto     # int8, float16, float32

# === 日本語特化設定 ===
WHISPER_LANGUAGE=ja
WHISPER_HOTWORDS_FILE=../config/hotwords.json

# === サーバー設定 ===
SERVER_HOST=0.0.0.0
SERVER_PORT=8000
```

---

## トラブルシューティング

### よくある問題

#### Bot がVCに参加できない
- Bot の権限を確認（Connect, Speak 権限）
- VCに自分が接続しているか確認
- Bot を一度キックして再招待

#### 文字起こし結果が空になる
- マイクの音量を確認
- `AUDIO_MIN_RMS_THRESHOLD` の値を下げる
- Whisper API が起動しているか確認

#### 認識精度が低い
- Whisper API が複数起動していないか確認
  ```powershell
  tasklist | findstr python
  ```
- 十分なメモリ（8GB以上）があるか確認
- `WHISPER_MODEL_NAME=large-v3` になっているか確認
- 🆕 クラウドプロバイダー（Groq）への切り替えを検討

#### "Error decoding audio" エラー
- Bot を完全に再起動
- 30秒〜1分待ってから再度 `/join`

#### 処理が遅い
- CPU環境では1セグメントあたり5〜10秒が目安
- 🆕 **Groq プロバイダーを使用**すると大幅に高速化
- GPU環境への移行を検討
- セグメント長を短くする（`AUDIO_MAX_SEGMENT_DURATION=5000`）

### ログの確認

```powershell
# Bot ログ
cat bot/logs/combined.log

# エラーログ
cat bot/logs/error.log

# Whisper API のヘルスチェック
curl http://localhost:8000/health
```

### データファイルの場所

| ファイル | 説明 |
|---------|------|
| `bot/data/guild-settings.json` | サーバー設定（出力チャンネル等） |
| `bot/data/guild_{guildId}.db` | サーバー別の検索用DB |
| `bot/logs/YYYY-MM-DD/` | 日別のログファイル |

### サポート

問題が解決しない場合は、以下の情報と共に報告してください：
- エラーメッセージ全文
- `bot/logs/error.log` の内容
- 使用環境（OS、Node.js/Pythonバージョン）
- 使用プロバイダー（local/groq/openai）
- 再現手順

---

## 📚 関連ドキュメント

- [技術概要](./TECHNICAL_OVERVIEW.md) - 高品質日本語文字起こしの技術解説
- [システム仕様](./spec.md) - 詳細な設計仕様
- [品質改善プラン](../plan/QUALITY_IMPROVEMENT.md) - 品質改善の取り組み
