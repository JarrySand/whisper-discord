# 📘 Discord 自動文字起こしBot（話者識別付き）

## 詳細要件定義書（Spec-Driven Development 用）

> **本ドキュメントは全体概要です。**
> 
> **ユーザー向け・技術者向けドキュメント:**
> 
> | ドキュメント | 内容 | 対象読者 |
> |-------------|------|---------|
> | [USER_GUIDE.md](./USER_GUIDE.md) | 使い方・機能一覧・トラブルシューティング | 一般ユーザー |
> | [TECHNICAL_OVERVIEW.md](./TECHNICAL_OVERVIEW.md) | 高品質日本語文字起こしの技術解説 | エンジニア |
> 
> **詳細仕様:**
> 
> | ドキュメント | 内容 |
> |-------------|------|
> | [01-discord-bot.md](./details/01-discord-bot.md) | Bot基盤・コマンド・音声受信 |
> | [02-audio-processing.md](./details/02-audio-processing.md) | 音声セグメント化・無音検知 |
> | [03-whisper-api.md](./details/03-whisper-api.md) | Whisper API サーバー |
> | [04-output-logging.md](./details/04-output-logging.md) | 出力・ログ・JSON保存 |
> | [05-integration.md](./details/05-integration.md) | Bot⇔API連携・リトライ |
> | [06-config-env.md](./details/06-config-env.md) | 環境変数・ディレクトリ構造 |
> | [07-testing.md](./details/07-testing.md) | テスト戦略・型定義統一 |
> | [08-post-processing.md](./details/08-post-processing.md) | 相槌フィルター・hotwords・検索（Phase5） |

---

# 0. プロジェクト概要

Discord のボイスチャット（VC）から音声を取得し、
ユーザーごとに話者識別した上で Whisper による文字起こしを行い、
結果をログ/ファイル/チャンネルに出力するシステムを構築する。

本システムは以下の思想に基づく：

* Bot と Whisper（推論）は **疎結合**
* Whisper はまず **ローカル実行**
* 将来的に Whisper を **VPS / GPUサーバーに移行できる設計**
* Bot は無料サーバーでも動作可能
* 音声処理と話者識別は **Discord の SSRC → UserID マッピング** を利用し、
  Whisper には純粋に音声→テキストのみを行わせる

---

# 1. 目的・ゴール

### 1.1 最終ゴール

* Discord VC の会話を **話者ごとに識別した文字起こしログ** として保存できる
* Whisper large を利用して **高精度な文字起こし** を行う
* “ローカル Whisper → サーバー Whisper” に自然に移行できる API 構成を採用する

### 1.2 主要ユースケース

* オンライン会議の自動議事録化
* ゲームVCのログ作成
* 社内Discordコミュニケーションの文書化
* Whisper の精度向上実験環境として利用

---

# 2. システム全体アーキテクチャ

```
[Discord Voice Channel]
         |
   (Voice Packet/SSRC)
         |
[Discord Bot Server (Free VPS OK)]
         |
  (audio segment + metadata)
         |
[Whisper API Server]  ← 初期はローカルPC
         |
  (transcribed text + speaker info)
         |
 [Output Service]
   - Discord Text Channel
   - Local log file
   - JSON storage
```

---

# 3. 詳細要件

---

# 3.1 Discord Bot 要件

## 3.1.1 最低要件

* Discord Developer Portal で Bot アカウントを作成
* Gateway Intent: `GUILD_VOICE_STATES` が必要
* Bot は常時 VC に参加可能
* 音声受信機能がある（`discord.js` または `discord.py` フォーク版）

---

## 3.1.2 機能要件（Bot）

### F-BOT-1: VC 参加 / 離脱

* 管理者が指定したテキストチャンネルで
  `/join` → VC に参加
  `/leave` → VC から離脱

---

### F-BOT-2: ユーザーごとの音声ストリーム受信

* Discord の `SSRC → UserID` マッピングを取得する
* 各ユーザーの音声を別々にバッファリングする
* 語尾切れ防止のため、**無音判定によるファイル区切り方式**を採用

---

### F-BOT-3: 音声セグメント化

音声セグメント作成要件：

* セグメント長：3〜10秒（可変）
* 条件：

  * 無音期間が一定時間（例：600ms）続いたら区切る
  * または最大長に達したら強制区切り
* フォーマット：OGG/PCM/WEBM — Whisper が ingest 可能な形式

メタデータ：

```
{
  "user_id": "123456789",
  "username": "Alice",
  "start_timestamp": 1733389200.123,
  "end_timestamp":   1733389203.954,
  "audio_path": "./segments/speaker_123456_001.ogg"
}
```

---

### F-BOT-4: Whisper API サーバーへの送信

* HTTP POST
* Whisper サーバーの URL は `.env` で指定
* Whisper サーバーが落ちている場合はリトライ

Payload 例：

```
POST /transcribe
{
    "user_id": "...",
    "username": "...",
    "start_ts": ...,
    "end_ts": ...,
    "audio_file": <multipart file>
}
```

---

# 3.2 Whisper API サーバー要件

### W-API-1: Whisper モデル選択

初期：

* ローカルPCで `faster-whisper` + `large-v3` を利用

将来：

* VPSやGPUサーバーにデプロイし、
  Bot 側の URL を切り替えるだけで移行できる構成

---

### W-API-2: HTTP API インターフェース

FastAPI を想定：

```
POST /transcribe
Request:
  - audio_file: binary
  - user_id: string
  - username: string
  - start_ts: number
  - end_ts: number

Response:
{
  "user_id": "...",
  "username": "...",
  "text": "こんにちは。今日はよろしくお願いします。",
  "start_ts": ...,
  "end_ts": ...
}
```

---

### W-API-3: Whisper推論要件

* バッチ推論可能（1件ずつでもOK）
* 出力はPure text
* 「話者識別」は行わない（話者識別はDiscord側の役割）
* モデルはローカルに置いてキャッシュ
  速度優先なら `faster-whisper`
  精度優先なら `openai-whisper` 系

---

# 3.3 出力要件

### O-1: Discord チャンネルへの逐次投稿（オプション）

```
[Alice 10:23:14]
こんにちは、今日はよろしくお願いします。
```

---

### O-2: ログファイル出力

保存形式：

```
logs/2024-12-05/session-001-10-23-14.log
```

構造：

```
[10:23:14] Alice: こんにちは、今日はよろしくお願いします。
[10:23:18] Bob: はい、よろしくお願いします。
```

---

### O-3: JSON 保存（AI解析用）

```
{
  "session_start": "...",
  "session_end": "...",
  "segments": [
    {
      "user_id": "...",
      "username": "Alice",
      "text": "こんにちは〜",
      "start_ts": 1733389200.1,
      "end_ts": 1733389203.9
    },
    ...
  ]
}
```

---

### O-4: Markdown 保存（議事録用）

保存形式：

```
logs/2024-12-05/meeting-01.md
```

構造：

```markdown
# 会議メモ - 2024-12-05 10:23

## 📋 セッション情報
- **チャンネル**: 雑談
- **開始**: 10:23:14
- **終了**: 11:30:45
- **参加者**: Alice, Bob, Charlie

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
- 発話数: 234件
- セッション時間: 1:07:31
```

---

# 3.4 非機能要件

### NF-1: Whisper サーバーは 1〜5分遅延まで許容

リアルタイム逐次反映は必須ではない

### NF-2: Bot は無料サーバーでも稼働可能な軽量設計

CPU1コア / RAM512MBでも動作

### NF-3: Whisper 推論サーバーは高負荷を想定

* largeモデルはCPUで10〜60秒の遅延を許容
* 将来GPUに乗せ換え可能な構造

### NF-4: 音声ファイルはサイズ最適化

1分あたり1MB以内を目指す

---

# 4. 技術選定（確定）

### Discord Bot ✅

| 項目 | 技術 |
|------|------|
| 言語 | **TypeScript** |
| ランタイム | Node.js 20+ |
| フレームワーク | discord.js v14 |
| 音声 | @discordjs/voice, @discordjs/opus |
| パッケージ管理 | pnpm |

---

### Whisper 推論 ✅

| 項目 | 技術 |
|------|------|
| 言語 | **Python 3.10+** |
| ライブラリ | faster-whisper (CTranslate2) |
| モデル | large-v3 |
| 初期環境 | CPU (int8量子化) |
| 将来 | GPU サーバー移行予定 |

---

### API Framework ✅

| 項目 | 技術 |
|------|------|
| フレームワーク | **FastAPI** |
| ASGIサーバー | Uvicorn |
| バリデーション | Pydantic v2 |

---

### アーキテクチャ決定理由

```
┌─────────────────────────┐     HTTP      ┌─────────────────────────┐
│   Discord Bot           │ ────────────→ │   Whisper API Server    │
│   (TypeScript)          │               │   (Python)              │
│                         │               │                         │
│ • discord.js 最活発     │               │ • faster-whisper 最成熟 │
│ • 豊富なドキュメント    │               │ • GPU対応が容易         │
│ • 型安全                │               │ • 疎結合で移行容易      │
└─────────────────────────┘               └─────────────────────────┘
```

---

# 5. 未来の拡張性要求

* 人物アイコンや名前をDiscordから自動取得
* タイムスタンプ付き字幕（SRT形式）生成
* 会議サマリ自動生成（LLM）
* 匿名化（UserA/Bに変換）
* 独自UI（Web Dashboard）
* Slack / Zoom など他VC対応

---

# 6. 実装タスク一覧（AIエージェント用分解）

## Phase 1: Discord Bot 基盤
> 📖 [01-discord-bot.md](./details/01-discord-bot.md) | [02-audio-processing.md](./details/02-audio-processing.md)

* [ ] Bot トークン読み込み・Client初期化
* [ ] /join /leave コマンド実装
* [ ] 音声受信機構（SSRC→UserIDマップ）実装
* [ ] 音声セグメント化（無音検知）
* [ ] OGG/Opusエンコード

## Phase 2: Whisper API サーバー
> 📖 [03-whisper-api.md](./details/03-whisper-api.md)

* [ ] FastAPI サーバー起動
* [ ] POST /transcribe 実装
* [ ] faster-whisper large-v3 推論実装
* [ ] ヘルスチェックエンドポイント

## Phase 3: 結合
> 📖 [05-integration.md](./details/05-integration.md)

* [ ] Whisper APIクライアント実装
* [ ] 処理キュー実装
* [ ] サーキットブレーカー実装
* [ ] ヘルスモニタリング

## Phase 4: 出力 & 安定化
> 📖 [04-output-logging.md](./details/04-output-logging.md)

* [ ] Discord テキストチャンネル投稿
* [ ] ログファイル出力 (.log)
* [ ] JSON保存 (AI解析用)
* [ ] Markdown保存 (議事録用)
* [ ] リトライ・エラーハンドリング

## Phase 5: 後処理・拡張機能
> 📖 [08-post-processing.md](./details/08-post-processing.md)

* [ ] 相槌フィルター実装（うん・はい等の除去）
* [ ] hotwords設定（専門用語・固有名詞対応）
* [ ] SQLiteストレージ実装
* [ ] `/search` コマンド実装

## Phase 6（任意・将来）

* [ ] WhisperをVPSへ移行（Docker化）
* [ ] GPU版へ移行 (CUDA)
* [ ] SRT/VTT字幕出力
* [ ] Web Dashboard 作成

---

# 7. ディレクトリ構造

```
whisper-discord/
├── bot/                      # Discord Bot (TypeScript)
│   ├── src/
│   │   ├── index.ts          # エントリーポイント
│   │   ├── commands/         # スラッシュコマンド
│   │   ├── voice/            # 音声受信・SSRC管理
│   │   ├── audio/            # セグメント化・エンコード
│   │   ├── api/              # Whisper APIクライアント
│   │   ├── output/           # 出力管理
│   │   └── config/           # 設定
│   ├── package.json
│   ├── tsconfig.json
│   └── .env
│
├── whisper-api/              # Whisper API (Python)
│   ├── src/
│   │   ├── main.py           # FastAPIアプリ
│   │   ├── api/              # エンドポイント
│   │   ├── services/         # Whisper推論
│   │   └── core/             # 設定・ログ
│   ├── models/               # モデルキャッシュ
│   ├── requirements.txt
│   ├── Dockerfile
│   └── .env
│
├── logs/                     # ログ出力
│   └── YYYY-MM-DD/
├── segments/                 # 音声セグメント（オプション）
├── docs/
│   ├── spec.md               # 本ドキュメント
│   └── details/              # 詳細仕様
└── docker-compose.yml
```

> 📖 詳細は [06-config-env.md](./details/06-config-env.md) を参照

---

# 8. テスト要件

> 📖 詳細は [07-testing.md](./details/07-testing.md) を参照

### T-1: 後追い話者識別テスト

複数ユーザーが同時に話したときに正しいユーザーに割り当てられるか

### T-2: 無音判定の精度テスト

会話が途切れやすい環境で誤分割が起きないか

### T-3: Whisper推論結果の正しさ

雑音・重複・聞き取りづらい音声を想定

### T-4: 全体遅延テスト

3秒〜30秒遅延以内で安定的に結果が得られるか

---

