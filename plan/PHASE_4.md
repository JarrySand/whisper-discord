# 📝 Phase 4: 出力 & 安定化

> **目標**: 文字起こし結果を複数の形式で出力し、システム全体を安定化
>
> **期間目安**: 2-3日
>
> **仕様書**: [04-output-logging.md](../docs/details/04-output-logging.md) | [07-testing.md](../docs/details/07-testing.md)

---

## 📋 タスク一覧

### 4.1 Discord チャンネル出力 (Day 1)

#### タスク

- [ ] **T-4.1.1**: DiscordOutputService クラス作成
- [ ] **T-4.1.2**: メッセージフォーマット（standard/compact/embed）
- [ ] **T-4.1.3**: バッチメッセージ送信
- [ ] **T-4.1.4**: レート制限対策
- [ ] **T-4.1.5**: 文字数制限対応（2000文字）

#### メッセージフォーマット

**Standard（デフォルト）**:
```
🎤 **Alice** <t:1733389200:T>
こんにちは、今日はよろしくお願いします。
```

**Compact**:
```
[10:23:14] Alice: こんにちは、今日はよろしくお願いします。
```

**Embed**:
```
┌─────────────────────────────────────┐
│ 👤 Alice                            │
│ こんにちは、今日はよろしくお願いします。  │
│ 📊 Confidence: 95% | 10:23:14       │
└─────────────────────────────────────┘
```

#### 設定

```typescript
interface DiscordOutputConfig {
  format: 'standard' | 'compact' | 'embed';
  showTimestamp: boolean;
  showConfidence: boolean;
  batchMessages: boolean;
  batchIntervalMs: number; // 3000
}
```

---

### 4.2 ログファイル出力 (Day 1)

#### タスク

- [ ] **T-4.2.1**: FileLoggerService クラス作成
- [ ] **T-4.2.2**: セッション管理（開始/終了）
- [ ] **T-4.2.3**: ログフォーマット
- [ ] **T-4.2.4**: 定期フラッシュ
- [ ] **T-4.2.5**: ヘッダー/フッター出力

#### ログファイル構造

```
logs/
├── 2024-12-05/
│   ├── session-001-10-23-14.log
│   └── session-002-14-30-00.log
└── 2024-12-06/
    └── ...
```

#### ログフォーマット

```
================================================================================
Discord Voice Transcription Log
Session: session-001
Started: 2024-12-05 10:23:14 JST
Channel: 雑談
================================================================================

[10:23:14] Alice: こんにちは、今日はよろしくお願いします。
[10:23:18] Bob: はい、よろしくお願いします。

================================================================================
Session ended: 2024-12-05 11:30:45 JST
Duration: 1:07:31
Total utterances: 234
Participants: Alice, Bob, Charlie
================================================================================
```

---

### 4.3 JSON 出力 (Day 2)

#### タスク

- [ ] **T-4.3.1**: JsonStoreService クラス作成
- [ ] **T-4.3.2**: セッションスキーマ定義
- [ ] **T-4.3.3**: セグメント追加
- [ ] **T-4.3.4**: 参加者情報更新
- [ ] **T-4.3.5**: 統計情報計算
- [ ] **T-4.3.6**: 定期保存

#### JSON スキーマ

```typescript
interface TranscriptionSession {
  version: string;
  session_id: string;
  guild_id: string;
  guild_name: string;
  channel_id: string;
  channel_name: string;
  session_start: string;  // ISO 8601
  session_end: string;
  duration_ms: number;
  participants: Participant[];
  segments: TranscriptionSegment[];
  stats: SessionStats;
}
```

---

### 4.4 Markdown 出力 (Day 2)

#### タスク

- [ ] **T-4.4.1**: MarkdownWriterService クラス作成
- [ ] **T-4.4.2**: セッション情報テーブル
- [ ] **T-4.4.3**: 会話ログセクション
- [ ] **T-4.4.4**: 統計セクション
- [ ] **T-4.4.5**: セッション終了時に書き込み

#### Markdown フォーマット

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

---

## 📊 統計

| 指標 | 値 |
|------|-----|
| 発話数 | 234件 |
| セッション時間 | 1:07:31 |
```

---

### 4.5 出力マネージャー統合 (Day 2)

#### タスク

- [ ] **T-4.5.1**: OutputManager クラス作成
- [ ] **T-4.5.2**: 各出力サービスの初期化
- [ ] **T-4.5.3**: startSession / endSession
- [ ] **T-4.5.4**: output メソッド（全出力先に配信）
- [ ] **T-4.5.5**: エラーハンドリング（1出力失敗で他は継続）

#### 出力設定

```typescript
interface OutputConfig {
  discord: { enabled: boolean; config: DiscordOutputConfig };
  fileLog: { enabled: boolean; config: FileLoggerConfig };
  jsonStore: { enabled: boolean; config: JsonStoreConfig };
  markdown: { enabled: boolean; config: MarkdownWriterConfig };
}
```

---

### 4.6 テスト実装 (Day 3)

#### タスク

- [ ] **T-4.6.1**: T-1 話者識別テスト
- [ ] **T-4.6.2**: T-2 無音検知テスト
- [ ] **T-4.6.3**: T-3 Whisper推論テスト
- [ ] **T-4.6.4**: T-4 全体遅延テスト
- [ ] **T-4.6.5**: 結合テスト

#### テスト要件 (spec.md より)

| ID | テスト | 目的 |
|----|--------|------|
| T-1 | 話者識別 | 複数ユーザー同時発話時の正しい割り当て |
| T-2 | 無音検知 | 誤分割が起きないか |
| T-3 | Whisper推論 | ノイズ・重複音声への耐性 |
| T-4 | 全体遅延 | 3〜30秒以内で安定 |

---

### 4.7 エラーハンドリング強化 (Day 3)

#### タスク

- [ ] **T-4.7.1**: グローバルエラーハンドラ
- [ ] **T-4.7.2**: 未処理例外キャッチ
- [ ] **T-4.7.3**: エラーログ出力
- [ ] **T-4.7.4**: Graceful degradation
- [ ] **T-4.7.5**: リカバリー処理

#### エラーコード

```typescript
enum BotErrorCode {
  // 接続系
  NOT_IN_VOICE_CHANNEL = 'E001',
  ALREADY_CONNECTED = 'E002',
  CONNECTION_FAILED = 'E003',
  CONNECTION_LOST = 'E004',
  
  // 権限系
  MISSING_PERMISSIONS = 'E101',
  
  // 音声処理系
  AUDIO_BUFFER_OVERFLOW = 'E201',
  ENCODING_FAILED = 'E202',
  
  // API系
  WHISPER_API_UNAVAILABLE = 'E301',
  WHISPER_API_TIMEOUT = 'E302',
}
```

---

## 🧪 Phase 4 完了テスト

### 出力テスト

- [ ] Discord チャンネルにメッセージが投稿される
- [ ] ログファイルが正しく生成される
- [ ] JSON ファイルが正しく生成される
- [ ] Markdown ファイルが正しく生成される

### 統合テスト

```
シナリオ:
1. /join でVC参加
2. 3人で5分間会話
3. /leave で離脱
4. 以下を確認:
   - Discord チャンネルに投稿されている
   - logs/YYYY-MM-DD/session-xxx.log が存在
   - logs/YYYY-MM-DD/session-xxx.json が存在
   - logs/YYYY-MM-DD/session-xxx.md が存在
   - 内容が一致している
```

### エラー復旧テスト

```
シナリオ:
1. セッション中に Whisper API を停止
2. サーキットブレーカーが発動することを確認
3. オフラインキューにセグメントが保存されることを確認
4. Whisper API を再起動
5. オフラインキューが処理されることを確認
```

---

## 📁 成果物ディレクトリ構造

```
bot/src/
├── output/
│   ├── discord.ts          # Discord出力
│   ├── file-logger.ts      # ログファイル出力
│   ├── json-store.ts       # JSON出力
│   ├── markdown-writer.ts  # Markdown出力
│   └── manager.ts          # 出力マネージャー
├── __tests__/
│   ├── voice/
│   │   └── ssrc-mapper.test.ts
│   ├── audio/
│   │   ├── silence-detector.test.ts
│   │   └── segmenter.test.ts
│   ├── api/
│   │   ├── whisper-client.test.ts
│   │   └── circuit-breaker.test.ts
│   ├── output/
│   │   └── discord.test.ts
│   └── integration/
│       └── latency.test.ts
└── ...
```

---

## ⚠️ 注意事項

### Discord レート制限

```
制限:
- チャンネルあたり 5メッセージ/5秒
- グローバル 50リクエスト/秒

対策:
- バッチメッセージ送信（3秒間隔）
- 文字数制限（2000文字）で分割
```

### ファイル出力

```
推奨設定:
- フラッシュ間隔: 5秒
- JSON保存間隔: 10秒
- Markdown: セッション終了時のみ
```

### ログローテーション

```
現状: 日付ベースのディレクトリ分割
将来: 古いログの自動削除（要実装）
```

---

## 📊 完成時の動作フロー

```
ユーザー発話
    │
    ▼
音声受信 (receiver.ts)
    │
    ▼
セグメント化 (segmenter.ts)
    │
    ▼
キュー追加 (queue.ts)
    │
    ▼
Whisper API 送信 (whisper-client.ts)
    │
    ▼
結果取得
    │
    ├─────────────────────────────────────────────────┐
    │                                                 │
    ▼                                                 ▼
Discord 出力                                    ファイル出力
(discord.ts)                                         │
    │                                                 ├── .log (file-logger.ts)
    ▼                                                 ├── .json (json-store.ts)
テキストチャンネル                                    └── .md (markdown-writer.ts)
```

---

## ✅ Phase 4 完了チェックリスト

- [ ] Discord チャンネル出力が動作する
- [ ] ログファイル出力が動作する
- [ ] JSON 出力が動作する
- [ ] Markdown 出力が動作する
- [ ] 出力設定で有効/無効を切り替えられる
- [ ] T-1〜T-4 テストが通過する
- [ ] エラー時に graceful degradation
- [ ] 10分以上のセッションで安定動作

---

**次のステップ**: 本番運用 / [Phase 5 - 将来拡張]

