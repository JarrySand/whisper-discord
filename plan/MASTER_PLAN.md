# 🎯 Discord 自動文字起こしBot マスタープラン

> **作成日**: 2024-12-05
> **仕様書**: [docs/spec.md](../docs/spec.md)

---

## 📋 目次

1. [プロジェクト概要](#1-プロジェクト概要)
2. [システムアーキテクチャ](#2-システムアーキテクチャ)
3. [開発フェーズ](#3-開発フェーズ)
4. [技術スタック](#4-技術スタック)
5. [タイムライン](#5-タイムライン)
6. [リスクと対策](#6-リスクと対策)
7. [成功基準](#7-成功基準)

---

## 1. プロジェクト概要

### 1.1 目的

Discord のボイスチャンネル（VC）から音声を取得し、ユーザーごとに話者識別した上で Whisper による文字起こしを行い、結果をログ/ファイル/チャンネルに出力するシステム。

### 1.2 主要ユースケース

- オンライン会議の自動議事録化
- ゲームVCのログ作成
- 社内Discordコミュニケーションの文書化
- Whisper の精度向上実験環境

### 1.3 設計思想

| 原則 | 説明 |
|------|------|
| **疎結合** | Bot と Whisper は HTTP API で通信 |
| **スケーラブル** | Whisper を VPS/GPU に移行可能 |
| **軽量 Bot** | 無料サーバー（CPU1コア/RAM512MB）でも動作 |
| **話者識別** | Discord の SSRC マッピングを利用 |

---

## 2. システムアーキテクチャ

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Discord Voice Channel                         │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                            Voice Packet / SSRC
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    Discord Bot Server (TypeScript)                   │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌────────────┐  │
│  │  Commands   │  │   Voice     │  │   Audio     │  │    API     │  │
│  │  /join      │  │  Receiver   │  │  Segmenter  │  │  Client    │  │
│  │  /leave     │  │  SSRC Map   │  │  Encoder    │  │  Queue     │  │
│  └─────────────┘  └─────────────┘  └─────────────┘  └────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                            HTTP POST (multipart)
                            audio + metadata
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    Whisper API Server (Python)                       │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                  │
│  │  FastAPI    │  │  Whisper    │  │   Audio     │                  │
│  │  Endpoints  │  │  Service    │  │  Processor  │                  │
│  └─────────────┘  └─────────────┘  └─────────────┘                  │
│                     faster-whisper (large-v3)                        │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                            JSON Response
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         Output Services                              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌────────────┐  │
│  │  Discord    │  │    Log      │  │    JSON     │  │  Markdown  │  │
│  │  Channel    │  │   File      │  │   Store     │  │   Writer   │  │
│  └─────────────┘  └─────────────┘  └─────────────┘  └────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 3. 開発フェーズ

### 概要

| Phase | 名称 | 目的 | 期間目安 |
|-------|------|------|---------|
| **Phase 1** | [Discord Bot 基盤](./PHASE_1.md) | Bot の基本機能とVC音声受信 | 3-4日 |
| **Phase 2** | [Whisper API サーバー](./PHASE_2.md) | 文字起こしAPI構築 | 2-3日 |
| **Phase 3** | [結合](./PHASE_3.md) | Bot⇔API連携・安定化 | 2-3日 |
| **Phase 4** | [出力 & 安定化](./PHASE_4.md) | 出力機能・エラー処理 | 2-3日 |
| **Phase 5** | 将来拡張 | GPU移行・機能追加 | - |

### フェーズ依存関係

```
Phase 1 ─────┬─────> Phase 3 ─────> Phase 4 ─────> Phase 5
             │
Phase 2 ─────┘
```

Phase 1 と Phase 2 は **並行開発可能**

---

## 4. 技術スタック

### Discord Bot

| 項目 | 技術 |
|------|------|
| 言語 | **TypeScript** |
| ランタイム | Node.js 20+ |
| フレームワーク | discord.js v14 |
| 音声ライブラリ | @discordjs/voice, @discordjs/opus |
| パッケージ管理 | pnpm |

### Whisper API

| 項目 | 技術 |
|------|------|
| 言語 | **Python 3.10+** |
| フレームワーク | FastAPI |
| ASGIサーバー | Uvicorn |
| Whisper | faster-whisper (CTranslate2) |
| モデル | large-v3 |
| 初期環境 | CPU (int8量子化) |

---

## 5. タイムライン

```
Week 1
├── Day 1-2: Phase 1.1 - Bot初期化・コマンド
├── Day 3-4: Phase 1.2 - 音声受信・SSRC管理
├── Day 4-5: Phase 1.3 - セグメント化・エンコード
│
├── Day 2-3: Phase 2.1 - FastAPI基盤（並行）
├── Day 3-4: Phase 2.2 - Whisper推論（並行）

Week 2
├── Day 1-2: Phase 3.1 - Bot⇔API連携
├── Day 2-3: Phase 3.2 - キュー・サーキットブレーカー
├── Day 4-5: Phase 4.1 - Discord出力
├── Day 5-6: Phase 4.2 - ファイル出力

Week 3
├── Day 1-2: Phase 4.3 - テスト・安定化
├── Day 3+: 本番運用・改善
```

---

## 6. リスクと対策

| リスク | 影響 | 対策 |
|--------|------|------|
| Whisper推論が遅い（CPU） | 遅延増大 | int8量子化、キュー管理 |
| Discord API制限 | メッセージ送信失敗 | レート制限対策、バッチ送信 |
| 音声パケットロス | 音声欠落 | バッファリング、リトライ |
| SSRC マッピング失敗 | 話者識別不能 | フォールバック処理 |
| Whisper API ダウン | 処理停止 | サーキットブレーカー、オフラインキュー |

---

## 7. 成功基準

### 機能要件

- [ ] `/join` `/leave` コマンドが動作する
- [ ] ユーザーごとの音声が正しく分離される
- [ ] 無音検知による自然なセグメント分割
- [ ] 3秒〜30秒の遅延で文字起こし完了
- [ ] Discord / ログ / JSON / Markdown 出力

### 非機能要件

- [ ] Bot は CPU1コア/RAM512MB で動作
- [ ] 1分あたり1MB以内の音声サイズ
- [ ] Whisper API エラー時の graceful degradation
- [ ] セッション復旧可能（オフラインキュー）

### テスト

- [ ] T-1: 話者識別テスト（複数同時発話）
- [ ] T-2: 無音検知テスト（誤分割なし）
- [ ] T-3: Whisper推論テスト（ノイズ耐性）
- [ ] T-4: 全体遅延テスト（30秒以内）

---

## 📁 関連ドキュメント

| ファイル | 内容 |
|----------|------|
| [PHASE_1.md](./PHASE_1.md) | Discord Bot 基盤 詳細計画 |
| [PHASE_2.md](./PHASE_2.md) | Whisper API サーバー 詳細計画 |
| [PHASE_3.md](./PHASE_3.md) | 結合 詳細計画 |
| [PHASE_4.md](./PHASE_4.md) | 出力 & 安定化 詳細計画 |
| [CHECKLIST.md](./CHECKLIST.md) | 開発チェックリスト |

---

## 🚀 開始方法

### Windows (PowerShell)

```powershell
# 1. リポジトリのセットアップ
git clone <repository>
cd whisper-discord

# 2. Bot セットアップ
cd bot
pnpm install
Copy-Item .env.example .env
# .env に Discord トークンを設定

# 3. Whisper API セットアップ
cd ..\whisper-api
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt
pip install -r requirements-dev.txt  # テスト用
Copy-Item .env.example .env

# 4. 開発開始
# Phase 1.1 から順に実装
```

### Linux / macOS

```bash
# 1. リポジトリのセットアップ
git clone <repository>
cd whisper-discord

# 2. Bot セットアップ
cd bot
pnpm install
cp .env.example .env
# .env に Discord トークンを設定

# 3. Whisper API セットアップ
cd ../whisper-api
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
pip install -r requirements-dev.txt  # テスト用
cp .env.example .env

# 4. 開発開始
# Phase 1.1 から順に実装
```

---

**次のステップ**: [Phase 1 - Discord Bot 基盤](./PHASE_1.md) を参照

