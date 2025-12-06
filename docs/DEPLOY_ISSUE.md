# 🚧 デプロイ問題：メモリ不足

## 📋 現状

Discord 音声文字起こし Bot を **Render** (Background Worker, 512MB RAM, $7/月) にデプロイしたが、**メモリ不足 (OOM)** でクラッシュする問題が発生中。

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

## 🔧 実施済みの対策

### 1. 環境変数で不要機能を無効化

```env
ENABLE_SQLITE=false
OUTPUT_ENABLE_FILE_LOG=false
OUTPUT_ENABLE_JSON_STORE=false
OUTPUT_ENABLE_MARKDOWN=false
```

### 2. `better-sqlite3` を条件付きインポートに変更

- `bot/src/output/manager.ts`
- `bot/src/bot.ts`
- `bot/src/commands/search.ts`

SQLite を使わない場合はモジュールをロードしない → メモリ節約

### 3. Node.js メモリ最適化フラグ

```dockerfile
CMD ["node", "--max-old-space-size=384", "--optimize-for-size", "dist/index.js"]
```

## 📊 メモリ使用量テスト結果

### 静的インポート時（モジュール読み込みのみ）

```
=== メモリ使用量テスト ===

[初期状態]
  Heap: 4.64 MB
  RSS:  30.82 MB

[discord.js]
  Heap: 21.44 MB (+16.78 MB)
  RSS:  67.96 MB (+37.11 MB)

[@discordjs/voice]
  Heap: 19.32 MB (+-2.17 MB)
  RSS:  70.65 MB (+2.69 MB)

[better-sqlite3]
  Heap: 19.80 MB (+0.44 MB)
  RSS:  70.67 MB (+0.02 MB)

=== 最終状態 ===
  Heap: 23.14 MB
  RSS:  74.18 MB
```

**静的インポート時は約 74 MB** → 512MB には程遠い

**問題は動的な使用時（音声処理中）にあると推測**

## 🧪 次のステップ：ローカルでメモリ監視テスト

### テスト用スクリプト

```bash
# ビルド
cd bot
npm run build

# メモリ監視しながらBot起動
node dist/scripts/memory-monitor.js
```

### テスト手順

1. **Render の Bot を停止**（同じトークンで2つ動かさない）
2. ローカルで `node dist/scripts/memory-monitor.js` を実行
3. Discord で `/join` コマンドを実行
4. ボイスチャンネルで話しかける
5. メモリ使用量の変化を観察

### 観察ポイント

- `/join` 前後のメモリ変化
- 話しかけた時のメモリ変化
- メモリリークの有無（時間経過で増加し続けるか）

## 💡 追加の最適化案（未実施）

### 高効果

1. **音声バッファサイズの縮小** - `maxSegmentDuration` を短く
2. **同時接続ユーザー数の制限**
3. **不要なモジュールの削除** - `better-sqlite3` を package.json から削除

### 低効果

1. **Dockerfile からビルドツール削除** - 最終イメージサイズは変わらない（マルチステージビルド済み）

## 📁 関連ファイル

- `bot/Dockerfile` - Docker 設定
- `bot/src/scripts/memory-test.ts` - 静的メモリテスト
- `bot/src/scripts/memory-monitor.ts` - 動的メモリ監視
- `bot/src/audio/buffer.ts` - 音声バッファ管理
- `bot/src/voice/receiver.ts` - 音声受信ハンドラ

## 🎯 目標

**512MB 以内で安定動作** させる、または最適なプラン/プラットフォームを決定する。

## 💰 代替プラン

| オプション | RAM | 月額 | 備考 |
|-----------|-----|------|------|
| Render Standard | 1GB | $25 | 高い |
| Railway | 柔軟 | ~$10-15 | 従量課金 |
| Hetzner VPS | 2GB+ | ~$5 | 設定が複雑 |
| DigitalOcean | 1GB | $6 | 中程度の難易度 |

