# 🎯 文字起こし品質向上プロジェクト

> **目的**: Discord ボイスチャンネルの**高品質な日本語文字起こし**を提供する
>
> **作成日**: 2025-12-05
>
> **ステータス**: 計画中

---

## 🎯 品質目標

| メトリクス | 現状 | 目標 | 優先度 |
|-----------|------|------|--------|
| 文字起こし精度 | 70-80% | **95%+** | 🔴 最高 |
| 空結果率 | ~20% | **5%以下** | 🔴 最高 |
| 平均遅延 | 10-15秒 | **5秒以下** | 🟡 高 |
| 成功率 | 82% | **98%+** | 🟡 高 |
| 平均信頼度 | 76% | **90%+** | 🟡 高 |

---

## 📋 確認された問題点

### 🔴 重大な問題

#### 0. Whisper API の重複起動（解決済み）
**症状:**
- 文字起こし精度が著しく低下
- 処理時間が通常の2倍以上に
- 誤認識が多発

**原因:**
- **Whisper API が複数のターミナルで同時に起動していた**
- CPU リソースが競合し、処理能力が著しく低下
- large-v3 モデルが複数ロードされ、メモリ圧迫

**教訓:**
- 起動前に既存プロセスを確認する
- `tasklist | findstr python` でプロセス確認
- `http://localhost:8000/health` でヘルスチェック

**対策:**
```powershell
# 起動前に既存プロセスを停止
taskkill /F /IM python.exe
# または
Get-Process python | Stop-Process -Force
```

---

#### 1. DAVE プロトコルによる音声デコードエラー
**症状:**
```
Error decoding audio for user XXXXX: The compressed data passed is corrupted
```

**発生条件:**
- `/leave` 後、短時間で再度 `/join` した場合
- Discord の DAVE (Discord Audio Video Encryption) プロトコルの暗号化キー不整合

**影響:**
- 音声データが全く受信できない
- 文字起こしが完全に停止

**現状の回避策:**
- Bot を完全に再起動する
- 再接続前に30秒〜1分待つ

---

#### 2. 空の文字起こし結果が多発
**症状:**
```
[21:55:31] Suna: 
[21:55:41] Suna: 
[21:59:31] Suna: 
```

**考えられる原因:**
- 音声データが正しく受信できていない
- 無音と誤判定されている
- Whisper が音声を認識できなかった
- 音声データの品質劣化

**影響:**
- 発話の約20%が記録されない
- 会話の文脈が失われる

---

#### 3. 誤認識・精度低下
**症状:**
```
期待: 「ボイスチャンネルに参加させて」
実際: 「魔女腰が動いていることを」

期待: 「原因を念のため確認してもらえますか」
実際: 「エンジンをかかしてもらえます」

期待: 「お、見て、出てきた」
実際: 「電流に乗せたメタル」
```

**パターン:**
- 日本語の音韻が類似した誤変換
- 文脈を無視した単語選択
- 専門用語やカタカナの誤認識

**考えられる原因:**
- 音声データの品質劣化（WAV フォールバック）
- CPU 処理による遅延でデータ欠落
- Whisper モデルへの入力が最適でない

---

#### 4. 繰り返しパターンの発生
**症状:**
```
しょうがないんだろう しょうがないんだろう しょうがないんだろう
```

**考えられる原因:**
- Whisper のハルシネーション（幻覚）
- 短い発話の繰り返し検出
- 無音区間でのノイズ誤認識

---

### 🟡 中程度の問題

#### 5. タイムスタンプの順序異常
**症状:**
```
[22:02:16] Suna: ...
[22:00:42] Suna: ...  ← 時間が逆転
[22:00:31] Suna: ...
```

**原因:**
- 処理キューのオーバーフロー
- 非同期処理の競合
- CPU 負荷による処理遅延

**影響:**
- ログの時系列が乱れる
- 会話の流れが分かりにくくなる

---

#### 6. FFmpeg 未インストールによる WAV フォールバック
**症状:**
```
[warn]: OGG encoding failed, falling back to WAV: FFmpeg is not available
```

**影響:**
- ファイルサイズが大きくなる（OGG の約10倍）
- アップロード時間が長くなる
- Whisper API への負荷増加

---

#### 7. CPU での重い処理
**症状:**
- 平均処理時間: 6.5〜10秒
- large-v3 モデルが CPU で動作

**影響:**
- リアルタイム性の低下
- 発話から表示まで10秒以上の遅延
- 長時間セッションでの蓄積遅延

---

### 🟢 軽微な問題

#### 8. セグメント分割の最適化不足
**現状の設定:**
```
AUDIO_MAX_SEGMENT_DURATION=10000  # 10秒
AUDIO_SILENCE_THRESHOLD=600       # 600ms
AUDIO_MIN_SEGMENT_DURATION=500    # 500ms
```

**問題:**
- 10秒セグメントが長すぎて精度低下
- 600ms の無音検知が短く、発話が分断される

---

#### 9. サーキットブレーカー発動時のデータロス
**症状:**
- API 停止 → 復帰後にキューのセグメントが処理される
- 一部のセグメントがタイムアウトで失われる可能性

---

#### 10. Opus デコードエラーの散発
**症状:**
```
Error decoding audio for user XXXXX: The compressed data passed is corrupted
```

**発生頻度:** 低（主に再接続時）

---

## 🔍 原因分析

### A. 音声処理パイプライン

```
Discord VC → DAVE暗号化 → Bot受信 → Opus復号 → PCM → WAV/OGG → Whisper API
     ↓           ↓           ↓         ↓        ↓         ↓
   正常      問題あり      正常     問題あり   問題あり    正常
```

| 段階 | 現状 | 問題点 | 深刻度 |
|------|------|--------|--------|
| Discord → Bot | DAVE 暗号化 + Opus | 再接続時に復号エラー | 🔴 |
| Opus → PCM | prism-media | デコードエラーが散発 | 🟡 |
| PCM → WAV/OGG | AudioEncoder | FFmpeg なしで WAV フォールバック | 🟡 |
| WAV → Whisper | HTTP POST | 大きなファイルで遅延 | 🟢 |

### B. Whisper API

| 項目 | 現状 | 問題点 | 深刻度 |
|------|------|--------|--------|
| モデル | large-v3 | CPU で重い（処理に10秒以上） | 🟡 |
| デバイス | CPU | GPU なしで遅い | 🟡 |
| 入力形式 | WAV (PCM) | OGG より大きい | 🟢 |
| 日本語特化 | なし | 汎用モデルのため精度に限界 | 🟡 |

### C. セグメント処理

| 項目 | 現状 | 問題点 | 深刻度 |
|------|------|--------|--------|
| 最大長 | 10秒 | 長すぎると精度低下 | 🟡 |
| 無音検知 | 600ms | 短い発話が分断される | 🟢 |
| バッファ | メモリ上 | 大量のセグメントでメモリ圧迫 | 🟢 |

---

## 🛠️ 改善計画

### Phase 1: 即座に対応可能（高優先度）

#### 1.1 FFmpeg のインストール
**効果**: OGG 形式でファイルサイズ削減、処理高速化

```powershell
# Windows での FFmpeg インストール
winget install FFmpeg
# または
choco install ffmpeg
```

**確認:**
```powershell
ffmpeg -version
```

**期待効果:**
- ファイルサイズ 1/10 に削減
- アップロード時間短縮
- Whisper API 負荷軽減

---

#### 1.2 セグメント設定の最適化
**効果**: 精度と遅延のバランス改善

```env
AUDIO_MAX_SEGMENT_DURATION=8000   # 10秒 → 8秒
AUDIO_SILENCE_THRESHOLD=800       # 600ms → 800ms
AUDIO_MIN_SEGMENT_DURATION=1000   # 500ms → 1秒
```

**期待効果:**
- 短いセグメントで精度向上
- 適切な無音検知で分断防止

---

#### 1.3 空セグメントのフィルタリング
**効果**: 空の文字起こし結果を Discord に投稿しない

```typescript
// 空結果をスキップ
if (!result.text || result.text.trim() === '') {
  logger.debug('Skipping empty transcription result');
  return;
}
```

---

#### 1.4 DAVE プロトコルエラーの自動復旧
**効果**: 再接続時のエラーを自動的に解決

```typescript
// エラー検出時に接続をリセット
if (isDAVEError(error)) {
  await resetVoiceConnection(guildId);
}
```

---

### Phase 2: 中期的な改善（中優先度）

#### 2.1 音声前処理の追加
- ノイズ除去（Discord 音声のノイズ対策）
- 音量正規化（小さい声も認識可能に）
- サンプルレート最適化（48kHz → 16kHz for Whisper）

#### 2.2 Whisper モデルの最適化
```env
# 処理速度優先
WHISPER_MODEL=medium

# または精度優先（GPU 必須）
WHISPER_MODEL=large-v3
WHISPER_DEVICE=cuda
```

#### 2.3 日本語特化の設定
```python
# Whisper API で言語を明示指定
result = model.transcribe(
    audio,
    language="ja",
    task="transcribe",
    initial_prompt="これは日本語の会話です。"
)
```

#### 2.4 ハルシネーション対策
- 繰り返しパターンの検出と除去
- 信頼度が低いセグメントのフラグ付け
- 短すぎるセグメントの結合

---

### Phase 3: 長期的な改善（低優先度）

#### 3.1 GPU サポート
- CUDA 対応 Whisper の導入
- GPU メモリ管理
- 処理時間を 1/5 以下に短縮

#### 3.2 話者識別の精度向上
- 声紋認識の導入
- 話者ごとの音声特性学習
- 同時発話の分離精度向上

#### 3.3 リアルタイム処理の最適化
- ストリーミング Whisper の検討
- WebSocket ベースの処理
- 遅延を 2秒以下に

#### 3.4 日本語特化モデルの検討
- ReazonSpeech など日本語特化モデルの評価
- ファインチューニングの検討

---

## 📊 品質メトリクス

### 現在の測定値（2025-12-05 テスト結果）

| メトリクス | 値 | 目標 | 差分 |
|-----------|-----|------|------|
| 成功率 | 82% | 98%+ | -16% |
| 平均処理時間 | 6.5秒 | 3秒以下 | +3.5秒 |
| 空結果率 | ~20% | 5%以下 | +15% |
| 平均信頼度 | 76% | 90%+ | -14% |
| 遅延（発話→表示） | 10-15秒 | 5秒以下 | +5-10秒 |

### 測定方法
1. `/status` コマンドで成功率確認
2. JSON ログファイルの `confidence` 値を集計
3. 空文字列のセグメント数をカウント
4. タイムスタンプ差分から遅延を計測

---

## ✅ 実装チェックリスト

### Phase 1（即座に対応）
- [x] FFmpeg をインストール ✅ 2025-12-05
- [x] OGG エンコーディングが動作することを確認 ✅ 2025-12-05
- [x] セグメント設定を調整（env.template.txt 更新: 8秒/800ms/1秒）✅ 2025-12-05
- [x] 空セグメントのフィルタリング実装 ✅ 2025-12-05
- [x] DAVE エラー時の自動復旧機構（通知機能付き）✅ 2025-12-05

### Phase 2（中期）
- [ ] 音声前処理モジュールの設計（スキップ：リサンプラー既存）
- [x] サンプルレート変換の実装（既存）
- [x] 日本語言語指定の追加（initial_prompt 強化）✅ 2025-12-05
- [x] ハルシネーション対策（hallucination_filter.py 追加）✅ 2025-12-05
- [x] 低エネルギーセグメント除去（RMSフィルタリング）✅ 2025-12-05
- [ ] エラーハンドリングの改善

### Phase 3（長期）
- [ ] GPU 環境の構築
- [ ] ストリーミング処理の調査
- [ ] 日本語特化モデルの評価

---

## 📝 関連ドキュメント

- [MANUAL_TEST_CHECKLIST.md](./MANUAL_TEST_CHECKLIST.md) - 手動テスト結果
- [CHECKLIST.md](./CHECKLIST.md) - 開発チェックリスト
- [docs/spec.md](../docs/spec.md) - システム仕様

---

## 🔧 コードベースレビューで発見された問題（2025-12-05）

### 即座に修正済み

#### ✅ routes.py インデントエラー
- **ファイル**: `whisper-api/src/api/routes.py` (143-154行目)
- **症状**: hotwords パース処理のインデントが崩れていた
- **ステータス**: 修正済み

---

### 中期的に対応が必要

#### 11. Python requirements.txt に faster-whisper 未記載
**ファイル**: `whisper-api/requirements.txt`

**問題:**
- `faster-whisper` パッケージが requirements.txt に含まれていない
- 新規環境で `pip install -r requirements.txt` してもエラーになる

**対策:**
```txt
# requirements.txt に追加
faster-whisper>=0.10.0
```

---

#### 12. CORS設定がワイルドカード
**ファイル**: `whisper-api/src/main.py` (106-112行目)

**問題:**
```python
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # 全オリジン許可
    ...
)
```

**リスク:**
- 本番環境でのセキュリティリスク
- 任意のドメインからAPIアクセス可能

**対策:**
- 本番環境では特定のオリジンのみ許可
- 環境変数で切り替え可能にする

---

#### 13. TypeScript型の不整合（TranscriptionServiceStatus）
**ファイル**: `bot/src/services/transcription-service.ts` (283行目)

**問題:**
- `getOutputPaths()` の戻り値に `sqlite` フィールドがあるが、型定義に含まれていない
- 型定義とランタイム値が不一致

**対策:**
```typescript
// types/index.ts で型を更新
outputPaths?: { 
  log: string | null; 
  json: string | null; 
  markdown: string | null;
  sqlite: string | null;  // 追加
}
```

---

#### 14. 未使用クラス RMSSilenceDetector
**ファイル**: `bot/src/audio/silence-detector.ts`

**問題:**
- `RMSSilenceDetector` クラスが定義されているが使用されていない
- デッドコードとなっている可能性

**対策:**
- 必要であれば使用箇所を実装
- 不要であれば削除してコードベースをクリーンに

---

#### 15. 自動離脱設定のハードコード
**ファイル**: `bot/src/voice/connection.ts` (41-44行目)

**問題:**
```typescript
private autoLeaveConfig: AutoLeaveConfig = {
  enabled: true,
  timeoutMs: 10 * 60 * 1000, // 10分（ハードコード）
};
```

**対策:**
- 環境変数 `AUTO_LEAVE_TIMEOUT_MS` で設定可能にする
- デフォルト値は維持

---

### 長期的に対応が必要

#### 16. Discord Voice暗号化の互換性問題
**関連エラー:** `No compatible encryption modes`

**問題:**
- `@discordjs/voice` と `sodium-native` の互換性問題
- Discord の新しい暗号化モードに対応できていない可能性

**対策:**
- `@discordjs/sodium` パッケージの追加インストール
- `sodium-native` のバージョン更新
- node_modules の完全再インストール

---

#### 17. ESLint無視コメントの改善
**ファイル**: `bot/src/commands/join.ts` (84行目)

**問題:**
```typescript
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any
const connection = joinVoiceChannel({
  ...
  adapterCreator: guild.voiceAdapterCreator as any,
});
```

**対策:**
- `@discordjs/voice` の型定義を確認
- 適切な型アサーションに置き換え

---

## 📅 更新履歴

| 日付 | 更新内容 |
|------|---------|
| 2025-12-05 | 初版作成、問題点の洗い出し、全問題点を詳細に記録 |
| 2025-12-05 | **重要発見**: Whisper API 重複起動が品質低下の主因と判明 |
| 2025-12-05 | コードベースレビュー実施、問題点11-17を追加、routes.pyインデントエラー修正 |
| 2025-12-05 | **Phase 1 完了**: FFmpegインストール、セグメント設定最適化、空セグメントフィルタリング、DAVEエラー復旧機構 |
| 2025-12-05 | **Phase 2 一部完了**: 日本語initial_prompt強化、ハルシネーションフィルター追加 |
| 2025-12-05 | **コードベース修正**: requirements.txtにfaster-whisper追加、TypeScript型不整合修正 |
