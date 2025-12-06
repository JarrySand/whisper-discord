# 🚧 デプロイ問題：メモリ不足

## 📋 現状

Discord 音声文字起こし Bot を **Render** (Background Worker, 512MB RAM, $7/月) にデプロイしたが、**メモリ不足 (OOM)** でクラッシュする問題が発生中。

## ✅ 実施済みの最適化（2024-12-06）

### 1. 音声セグメント長の短縮

```diff
- maxSegmentDuration: 10000ms (10秒)
+ maxSegmentDuration: 5000ms (5秒)
```

**効果**: 音声バッファのメモリ使用量を約50%削減

### 2. メモリ解放の明示化

- `segmenter.ts`: PCMデータ結合後に元のchunksへの参照を解除
- `buffer.ts`: バッファリセット時に明示的にメモリをクリア

### 3. Opusデコーダーの適切な管理

- `receiver.ts`: ユーザーごとにデコーダーを管理し、ストリーム終了時に破棄
- メモリリークの防止

### 4. メモリ監視スクリプトの強化

- `memory-monitor.ts`: 512MB制限を想定した詳細な監視
- `memory-stress-test.ts`: Discord接続なしでの負荷テスト

## 📊 メモリ使用量テスト結果

### 静的インポート時（モジュール読み込みのみ）

```
初期状態:      30 MB
discord.js:    70 MB (+40 MB)
@discordjs/voice: 75 MB (+5 MB)
最終:          75 MB
```

### 動的ストレステスト（音声処理シミュレーション）

| テスト | RSS使用量 | 512MB比 |
|--------|-----------|---------|
| 初期状態 | 42 MB | 8.3% |
| 単一ユーザー 5秒 | 48 MB | 9.3% |
| 3ユーザー同時 | 55 MB | 10.8% |
| 5ユーザー同時 | 57 MB | 11.2% |
| 負荷テスト後 | 60 MB | 11.6% |

**結論**: ローカルテストでは512MB制限の約12%しか使用していない。

## 🔍 問題の経緯

### 試したプラットフォーム

| サービス | 結果 |
|----------|------|
| **Fly.io (無料, 256MB)** | メモリ不足でクラッシュ |
| **Render ($7/月, 512MB)** | メモリ不足でクラッシュ |

### エラーメッセージ

```
Ran out of memory (used over 512MB) while running your code
```

### 暗号化エラーも発生

```
Opus stream error: Failed to decrypt: DecryptionFailed(UnencryptedWhenPassthroughDisabled)
```

→ `libsodium-dev` を Dockerfile に追加済み

## 🧪 テスト手順

### ローカルでメモリ監視テスト

```bash
# ビルド
cd bot
npm run build

# 静的メモリテスト（モジュールインポートのみ）
node dist/scripts/memory-test.js

# ストレステスト（音声処理シミュレーション）
node --expose-gc dist/scripts/memory-stress-test.js

# 実際のBot起動テスト
# ※ 事前に Render の Bot を停止してください
node dist/scripts/memory-monitor.js
```

### 観察ポイント

- `/join` 前後のメモリ変化
- 話しかけた時のメモリ変化
- メモリリークの有無（時間経過で増加し続けるか）

## 🔧 Dockerfile設定

```dockerfile
CMD ["node", "--max-old-space-size=384", "--optimize-for-size", "dist/index.js"]
```

## 💡 追加の最適化案（未実施）

### 高効果

1. **同時接続ユーザー数の制限** - 3人以下に制限
2. **音声チャンネル接続時間の制限** - 自動離脱を短く
3. **`better-sqlite3` の完全削除** - `ENABLE_SQLITE=false` でも動的インポート

### 中効果

1. **より積極的なGC** - `--expose-gc` フラグで手動GC
2. **ストリーム処理の最適化** - バッファサイズの調整

## 📁 関連ファイル

- `bot/Dockerfile` - Docker 設定
- `bot/src/scripts/memory-test.ts` - 静的メモリテスト
- `bot/src/scripts/memory-stress-test.ts` - 動的ストレステスト
- `bot/src/scripts/memory-monitor.ts` - リアルタイム監視
- `bot/src/audio/buffer.ts` - 音声バッファ管理
- `bot/src/audio/segmenter.ts` - セグメント処理
- `bot/src/voice/receiver.ts` - 音声受信ハンドラ

## 🎯 目標

**512MB 以内で安定動作** させる、または最適なプラン/プラットフォームを決定する。

## 🔄 次のステップ

1. **実際のDiscord接続でテスト** - ローカルでBot起動して確認
2. **Renderに再デプロイ** - 最適化後の動作確認
3. **必要に応じて追加最適化** - OOMが続く場合

## 💰 代替プラン

| オプション | RAM | 月額 | 備考 |
|-----------|-----|------|------|
| Render Standard | 1GB | $25 | 高い |
| Railway | 柔軟 | ~$10-15 | 従量課金 |
| Hetzner VPS | 2GB+ | ~$5 | 設定が複雑 |
| DigitalOcean | 1GB | $6 | 中程度の難易度 |
