# ✅ 開発チェックリスト

> **このドキュメントは開発進捗を追跡するためのチェックリストです**
>
> 各タスク完了時にチェックを入れてください

---

## 📋 Phase 1: Discord Bot 基盤 ✅

### 1.1 プロジェクト初期化

- [x] Bot プロジェクトディレクトリ作成
- [x] package.json 作成
- [x] 依存関係インストール
  - [x] discord.js
  - [x] @discordjs/voice
  - [x] @discordjs/opus
  - [x] prism-media
  - [x] sodium-native
  - [x] dotenv
  - [x] winston
  - [x] uuid
  - [x] jest, ts-jest, @types/jest (dev)
- [x] TypeScript 設定 (tsconfig.json)
- [x] ESLint/Prettier 設定
- [x] .env.example 作成
- [x] ディレクトリ構造作成

### 1.2 Discord Client 初期化

- [x] Discord Client 作成
- [x] Intents 設定
- [x] Bot ログイン処理
- [x] Ready イベントハンドラ
- [x] エラーハンドリング
- [x] Graceful shutdown

### 1.3 スラッシュコマンド

- [x] コマンドローダー
- [x] `/join` コマンド
  - [x] VC 参加処理
  - [x] 出力チャンネル設定
  - [x] エラーハンドリング
- [x] `/leave` コマンド
  - [x] VC 離脱処理
  - [x] セッション保存
- [x] コマンド登録スクリプト

### 1.4 音声受信機構

- [x] VoiceConnection 管理
- [x] VoiceReceiver セットアップ
- [x] SSRC → UserID マッピング
  - [x] SSRCMapper クラス
  - [x] register メソッド
  - [x] get メソッド
- [x] Opus → PCM デコード
- [x] ユーザー別バッファリング
  - [x] AudioBufferManager クラス
  - [x] appendAudio メソッド
  - [x] checkSilence メソッド

### 1.5 音声セグメント化

- [x] SilenceDetector クラス
  - [x] analyze メソッド
  - [x] shouldSegment メソッド
- [x] AudioSegmenter クラス
  - [x] createSegment メソッド
- [x] リサンプリング (48kHz → 16kHz)
- [x] ステレオ → モノラル変換
- [x] セグメント ID 付与

### 1.6 音声エンコード

- [x] AudioEncoder クラス
- [x] OGG/Opus エンコード (FFmpeg)
- [x] WAV エンコード (フォールバック)
- [x] ファイル保存 (オプション)

---

## 📋 Phase 2: Whisper API サーバー

### 2.1 プロジェクト初期化

- [x] whisper-api ディレクトリ作成
- [x] requirements.txt 作成
- [ ] 依存関係インストール
  - [x] fastapi
  - [x] uvicorn
  - [x] python-multipart
  - [x] pydantic
  - [x] pydantic-settings
  - [x] faster-whisper
  - [x] torch
  - [x] pytest, pytest-cov, httpx (dev)
- [x] .env.example 作成
- [x] ディレクトリ構造作成

### 2.2 FastAPI 基盤

- [x] FastAPI アプリケーション作成
- [x] 設定管理 (pydantic-settings)
- [x] CORS 設定
- [x] Lifespan イベント
- [x] `GET /health` エンドポイント

### 2.3 Pydantic スキーマ

- [x] TranscribeRequest
- [x] TranscriptionResult
- [x] TranscribeResponse
- [x] HealthResponse
- [x] ErrorDetail

### 2.4 Whisper サービス

- [x] WhisperService クラス
- [x] load_model メソッド
- [x] transcribe メソッド
- [x] 信頼度スコア計算
- [x] TranscriptionStats

### 2.5 文字起こしエンドポイント

- [x] `POST /transcribe` 実装
- [x] ファイルアップロード処理
- [x] 一時ファイル管理
- [x] 入力バリデーション
- [x] エラーハンドリング

### 2.6 バッチ処理 (オプション)

- [x] `POST /transcribe/batch` 実装
- [x] 複数ファイル受信
- [x] メタデータ配列解析

### 2.7 デバイス検出

- [x] GPU 検出ロジック
- [x] 計算精度自動選択
- [x] CPU 最適化設定

### 2.8 Docker 対応

- [x] Dockerfile (CPU版)
- [x] Dockerfile.gpu (GPU版)
- [x] docker-compose.yml
- [x] .dockerignore

---

## 📋 Phase 3: Bot⇔API 結合 ✅

### 3.0 追加依存関係

- [x] axios インストール
- [x] form-data インストール
- [x] @types/form-data インストール (dev)

### 3.1 Whisper クライアント

- [x] WhisperClient クラス
- [x] transcribe メソッド
- [x] transcribeBatch メソッド
- [x] healthCheck メソッド
- [x] リトライロジック
  - [x] executeWithRetry
  - [x] 指数バックオフ

### 3.2 処理キュー

- [x] TranscriptionQueue クラス
- [x] enqueue メソッド
- [x] 優先度付きキュー
- [x] 並行処理制御
- [x] イベントエミッター
  - [x] completed イベント
  - [x] failed イベント
  - [x] retry イベント

### 3.3 サーキットブレーカー

- [x] CircuitBreaker クラス
- [x] 状態管理 (CLOSED/OPEN/HALF_OPEN)
- [x] execute メソッド
- [x] onSuccess / onFailure

### 3.4 ヘルスモニタリング

- [x] HealthMonitor クラス
- [x] 定期ヘルスチェック
- [x] healthy イベント
- [x] unhealthy イベント

### 3.5 TranscriptionService 統合

- [x] TranscriptionService クラス
- [x] start メソッド
- [x] stop メソッド
- [x] transcribe メソッド
- [x] getStatus メソッド

### 3.6 オフラインハンドリング

- [x] OfflineHandler クラス
- [x] saveForLater メソッド
- [x] loadPending メソッド
- [x] processOfflineQueue メソッド

### 3.7 メトリクス収集

- [x] MetricsCollector クラス
- [x] recordRequest メソッド
- [x] getMetrics メソッド

---

## 📋 Phase 4: 出力 & 安定化 ✅

### 4.1 Discord チャンネル出力

- [x] DiscordOutputService クラス
- [x] formatStandard
- [x] formatCompact
- [x] formatEmbed
- [x] バッチメッセージ送信
- [x] レート制限対策

### 4.2 ログファイル出力

- [x] FileLoggerService クラス
- [x] startSession メソッド
- [x] log メソッド
- [x] endSession メソッド
- [x] writeHeader / writeFooter

### 4.3 JSON 出力

- [x] JsonStoreService クラス
- [x] startSession メソッド
- [x] addSegment メソッド
- [x] endSession メソッド
- [x] updateParticipant
- [x] updateStats

### 4.4 Markdown 出力

- [x] MarkdownWriterService クラス
- [x] startSession メソッド
- [x] addSegment メソッド
- [x] endSession メソッド
- [x] generateMarkdown

### 4.5 出力マネージャー統合

- [x] OutputManager クラス
- [x] startSession メソッド
- [x] output メソッド
- [x] endSession メソッド

### 4.6 テスト実装

> 📖 単体テスト詳細: [TESTING.md](./TESTING.md)
>
> 📖 手動テスト手順: [MANUAL_TEST_CHECKLIST.md](./MANUAL_TEST_CHECKLIST.md)

- [x] T-1: 話者識別テスト (SSRCMapper - 14 tests)
- [x] T-2: 無音検知テスト (SilenceDetector - 18 tests)
- [x] T-3: Whisper推論テスト (WhisperService - 21 tests)
- [x] T-4: 全体遅延テスト (Latency - 5 tests)
- [x] 結合テスト (CircuitBreaker: 22, Queue: 19, Discord: 13 tests)

### 4.7 エラーハンドリング強化

- [x] グローバルエラーハンドラ
- [x] 未処理例外キャッチ
- [x] エラーログ出力
- [x] Graceful degradation

---

## 📋 完了確認

### 機能要件

- [x] `/join` `/leave` コマンドが動作する
- [x] ユーザーごとの音声が正しく分離される
- [x] 無音検知による自然なセグメント分割
- [x] 3秒〜30秒の遅延で文字起こし完了
- [x] Discord チャンネル出力
- [x] ログファイル出力
- [x] JSON 出力
- [x] Markdown 出力

### 非機能要件

- [ ] Bot は CPU1コア/RAM512MB で動作
- [ ] 1分あたり1MB以内の音声サイズ
- [x] Whisper API エラー時の graceful degradation
- [x] セッション復旧可能（オフラインキュー）

### テスト

- [x] 単体テスト通過 (Bot: 89 tests, API: 37 tests)
- [x] 結合テスト通過 (モック経由の結合テスト)
- [ ] 手動テスト通過
- [ ] 10分以上のセッションで安定動作

---

## 📝 メモ

```
開発中のメモをここに記録
```

---

## 📅 進捗ログ

| 日付 | 作業内容 | 完了タスク |
|------|---------|-----------|
| 2024-12-05 | テスト実装完了 | T-1〜T-4 全テスト実装、Bot 89件/API 37件 Pass |
| 2024-12-05 | Phase 4 出力 & 安定化実装完了 | T-4.1〜T-4.5, T-4.7 完了（テスト除く） |
| 2024-12-05 | Phase 3 Bot⇔API 結合実装完了 | T-3.0〜T-3.7 全完了 |
| 2024-12-05 | Phase 2 Whisper API サーバー実装完了 | T-2.1〜T-2.8 全完了 |
| 2024-12-05 | Phase 1 Discord Bot 基盤実装完了 | T-1.1〜T-1.6 全完了、動作確認済み |
| | | |

---

## 🐛 既知の問題

| # | 問題 | 状態 | 解決策 |
|---|------|------|--------|
| 1 | - | - | - |
| | | | |

