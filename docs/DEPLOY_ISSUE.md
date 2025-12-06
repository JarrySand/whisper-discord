# ✅ デプロイ問題：メモリ不足 - 解決済み

## 📋 結果サマリー

Discord 音声文字起こし Bot を **Render** (Background Worker, 512MB RAM, $7/月) に正常にデプロイ完了。

| 項目 | 結果 |
|------|------|
| **メモリ使用量** | 約80MB / 512MB (16%) |
| **安定性** | ✅ OOMなし、安定動作 |
| **機能** | ✅ 文字起こし、検索、ファイルログ全て動作 |

---

## 🔧 実施した最適化（2024-12-06）

### 1. 同時フラッシュ防止（根本原因の修正）

**問題**: `flushBuffer()` が同一ユーザーに対して複数回同時実行され、大量のFFmpegプロセスとAPI呼び出しが発生してOOMを引き起こしていた。

```typescript
// buffer.ts
private flushingUsers = new Set<string>();

async flushBuffer(userId: string): Promise<void> {
  if (this.flushingUsers.has(userId)) return; // 既にフラッシュ中なら何もしない
  this.flushingUsers.add(userId);
  try {
    // ... フラッシュ処理 ...
  } finally {
    this.flushingUsers.delete(userId);
  }
}
```

### 2. セグメント長の最適化

```diff
- maxSegmentDuration: 10000ms (10秒)
+ maxSegmentDuration: 30000ms (30秒)
```

**効果**: 
- API呼び出し回数を1/3に削減
- より自然な文脈でのWhisper処理
- コスト効率の向上

### 3. 沈黙閾値の調整

```diff
- silenceThreshold: 600ms (0.6秒)
+ silenceThreshold: 1500ms (1.5秒)
```

**効果**: 自然な会話の間で不要な分断を防止

### 4. メモリ解放の明示化

- `segmenter.ts`: PCMデータ結合後に元のchunksへの参照を解除
- `buffer.ts`: バッファリセット時に明示的にメモリをクリア
- `receiver.ts`: Opusデコーダーの適切な破棄

### 5. DAVEプロトコルの無効化

```typescript
// index.ts - E2EE非対応サーバーでのエラー防止
// import '@snazzah/davey';  // コメントアウト
```

### 6. SQLite共有問題の修正

`bot.ts` と `OutputManager` で別々のSqliteStoreManagerインスタンスが作成されていた問題を修正。
共有インスタンスを使用するように変更。

---

## 📊 メモリ使用量テスト結果

### 実際のBot動作時（30秒セグメント、SQLite有効）

```
[04:35:02] RSS:  80.1MB/512MB (15.6%) ████░░░░░░░░░░░░░░░░░░░░░░░░░░
[04:35:07] RSS:  80.3MB/512MB (15.7%) ████░░░░░░░░░░░░░░░░░░░░░░░░░░
[04:35:12] RSS:  80.4MB/512MB (15.7%) ████░░░░░░░░░░░░░░░░░░░░░░░░░░
```

| 状態 | RSS使用量 | 512MB比 |
|------|-----------|---------|
| 起動直後 | 65 MB | 12.7% |
| VC参加後 | 75 MB | 14.6% |
| 文字起こし中 | 80 MB | 15.6% |
| ピーク時 | 85 MB | 16.6% |

**結論**: 512MBの約17%しか使用せず、非常に安定。

---

## 🎯 推奨環境変数設定

```env
# 音声処理（最適化済み）
AUDIO_MAX_SEGMENT_DURATION=30000    # 30秒セグメント
AUDIO_SILENCE_THRESHOLD=1500        # 1.5秒沈黙閾値
AUDIO_MIN_SEGMENT_DURATION=1000     # 最小1秒
AUDIO_MIN_RMS_THRESHOLD=0.005       # ノイズ除去

# 機能有効化
ENABLE_SQLITE=true                  # 検索機能
OUTPUT_ENABLE_FILE_LOG=true         # ファイルログ
OUTPUT_ENABLE_JSON_STORE=true       # JSON保存
OUTPUT_ENABLE_MARKDOWN=true         # Markdown保存
```

---

## 📁 変更ファイル一覧

| ファイル | 変更内容 |
|----------|----------|
| `bot/src/audio/buffer.ts` | flushingUsersフラグ追加 |
| `bot/src/audio/segmenter.ts` | タイムスタンプフォールバック追加 |
| `bot/src/voice/receiver.ts` | デコーダー管理改善 |
| `bot/src/config/index.ts` | デフォルト値更新 |
| `bot/src/filters/hallucination-filter.ts` | パターン追加 |
| `bot/src/index.ts` | DAVE無効化 |
| `bot/src/bot.ts` | SQLite初期化を非同期に |
| `bot/src/commands/join.ts` | SQLite共有設定 |
| `bot/src/output/manager.ts` | setSqliteStoreManager追加 |
| `bot/env.template.txt` | 推奨値更新 |

---

## 🧪 ローカルテスト手順

```bash
cd bot
npm run build

# 実際のBot起動テスト
node dist/scripts/memory-monitor.js
```

---

## ✅ 完了チェックリスト

- [x] メモリ使用量が512MB以内で安定
- [x] 文字起こし機能が正常動作
- [x] 検索機能（/search）が正常動作
- [x] ファイルログが正常出力
- [x] タイムスタンプが正確
- [x] ハルシネーション除去が機能
- [x] 30秒セグメントで文脈が繋がる
