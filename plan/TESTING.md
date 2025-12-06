# 🧪 テスト手順書

> **目標**: システム全体の品質を保証するための網羅的なテスト手順
>
> **関連**: [07-testing.md](../docs/details/07-testing.md) | [PHASE_4.md](./PHASE_4.md)

---

## 📋 テスト概要

### テストレベル

| レベル | 対象 | ツール | 自動化 |
|--------|------|--------|--------|
| 単体テスト | 個別モジュール | Jest (Bot) / pytest (API) | ✅ |
| 結合テスト | Bot⇔API連携 | Jest + MSW / pytest + httpx | ✅ |
| 手動テスト | E2E フロー | Discord実機 | ❌ |
| 負荷テスト | 長時間安定性 | 手動 | ❌ |

### テスト要件 (spec.md T-1〜T-4)

| ID | テスト | 目的 |
|----|--------|------|
| T-1 | 話者識別テスト | 複数ユーザー同時発話時の正しい割り当て |
| T-2 | 無音検知テスト | 誤分割が起きないか |
| T-3 | Whisper推論テスト | ノイズ・重複音声への耐性 |
| T-4 | 全体遅延テスト | 3〜30秒以内で安定 |

---

## 📁 テスト環境準備

### 1. 前提条件

```
必須:
- Node.js 20+
- Python 3.10+
- Discord Bot トークン（テスト用サーバー）
- Whisper API サーバー（起動済み）

オプション:
- FFmpeg（音声変換用）
- GPU（高速テスト用）
```

### 2. テスト用Discordサーバー準備

```
1. テスト専用Discordサーバーを作成
2. 以下のチャンネルを作成:
   - #general（テキスト）
   - #bot-output（テキスト - 出力先）
   - 🎤テスト用VC（ボイス）
3. Botを招待（必要な権限付与）
4. テストユーザー2-3人を招待
```

### 3. 環境変数設定

```bash
# bot/.env
DISCORD_BOT_TOKEN=your_test_bot_token
DISCORD_CLIENT_ID=your_client_id
WHISPER_API_URL=http://localhost:8000
OUTPUT_LOG_DIR=./logs
OUTPUT_ENABLE_DISCORD_POST=true
OUTPUT_ENABLE_FILE_LOG=true
OUTPUT_ENABLE_JSON_STORE=true
OUTPUT_ENABLE_MARKDOWN=true
LOG_LEVEL=debug
```

---

## 🔧 Phase 1: 単体テスト（自動）

### 1.1 Bot 単体テスト

#### テスト対象

| モジュール | ファイル | テスト項目 |
|-----------|----------|-----------|
| SSRCMapper | `voice/ssrc-mapper.ts` | ユーザー登録/取得/削除 |
| SilenceDetector | `audio/silence-detector.ts` | 無音検知/リセット |
| AudioSegmenter | `audio/segmenter.ts` | セグメント生成 |
| CircuitBreaker | `api/circuit-breaker.ts` | 状態遷移 |
| TranscriptionQueue | `api/queue.ts` | キュー操作/優先度 |
| DiscordOutputService | `output/discord.ts` | メッセージフォーマット |
| FileLoggerService | `output/file-logger.ts` | ログ出力 |
| JsonStoreService | `output/json-store.ts` | JSON保存 |

#### 実行コマンド

```bash
cd bot
npm test                    # 全テスト実行
npm test -- --coverage      # カバレッジ付き
npm test -- --watch         # ウォッチモード
```

#### T-1: 話者識別テスト

```typescript
// bot/src/__tests__/voice/ssrc-mapper.test.ts

describe('SSRCMapper', () => {
  test('複数ユーザーを同時に管理できる', () => {
    const mapper = new SSRCMapper();
    
    mapper.register(11111, 'user-1', mockMember1);
    mapper.register(22222, 'user-2', mockMember2);
    mapper.register(33333, 'user-3', mockMember3);

    expect(mapper.get(11111)?.userId).toBe('user-1');
    expect(mapper.get(22222)?.userId).toBe('user-2');
    expect(mapper.get(33333)?.userId).toBe('user-3');
  });

  test('同一ユーザーのSSRC変更を処理できる', () => {
    const mapper = new SSRCMapper();
    
    mapper.register(11111, 'user-1', mockMember1);
    mapper.register(99999, 'user-1', mockMember1); // SSRC変更

    expect(mapper.getByUserId('user-1')).toBeDefined();
  });
});
```

#### T-2: 無音検知テスト

```typescript
// bot/src/__tests__/audio/silence-detector.test.ts

describe('SilenceDetector', () => {
  test('無音を正しく検出する', () => {
    const detector = new SilenceDetector({ amplitudeThreshold: 500 });
    
    const silentPcm = createSilentPcm(100);
    const result = detector.analyze(silentPcm);
    
    expect(result).toBeGreaterThan(0);
  });

  test('音声後に無音を検出するとセグメント化', () => {
    const detector = new SilenceDetector({
      amplitudeThreshold: 500,
      silenceDuration: 600,
    });
    
    // 音声 → 600ms以上の無音
    detector.analyze(createLoudPcm(1000));
    for (let i = 0; i < 10; i++) {
      detector.analyze(createSilentPcm(100));
    }
    
    expect(detector.shouldSegment()).toBe(true);
  });

  test('短い無音では誤分割しない', () => {
    const detector = new SilenceDetector({
      amplitudeThreshold: 500,
      silenceDuration: 600,
    });
    
    detector.analyze(createLoudPcm(1000));
    detector.analyze(createSilentPcm(300)); // 短い無音
    
    expect(detector.shouldSegment()).toBe(false);
  });
});
```

---

### 1.2 API 単体テスト

#### テスト対象

| モジュール | ファイル | テスト項目 |
|-----------|----------|-----------|
| WhisperService | `services/whisper.py` | 文字起こし精度 |
| AudioProcessor | `services/audio.py` | 音声前処理 |
| Routes | `api/routes.py` | エンドポイント |

#### 実行コマンド

```bash
cd whisper-api
source venv/Scripts/activate  # Windows
pytest                         # 全テスト
pytest -v                      # 詳細表示
pytest --cov=src               # カバレッジ付き
pytest -m "not slow"           # 遅いテストを除外
```

#### T-3: Whisper推論テスト

```python
# whisper-api/tests/test_whisper_service.py

class TestWhisperService:
    def test_クリアな日本語音声(self, whisper_service, audio_path):
        """クリアな日本語の文字起こし"""
        text, confidence = whisper_service.transcribe(
            audio_path / "clear_japanese.ogg",
            language="ja"
        )
        
        assert len(text) > 0
        assert confidence > 0.8
        assert "こんにちは" in text

    def test_ノイズを含む音声(self, whisper_service, audio_path):
        """ノイズ音声でも処理できる"""
        text, confidence = whisper_service.transcribe(
            audio_path / "noisy.ogg",
            language="ja"
        )
        
        assert isinstance(text, str)
        assert 0.0 <= confidence <= 1.0

    def test_短い音声_500ms未満(self, whisper_service, audio_path):
        """短すぎる音声の処理"""
        text, confidence = whisper_service.transcribe(
            audio_path / "short_300ms.ogg",
            language="ja"
        )
        
        # 短すぎる場合は空文字列の可能性
        assert isinstance(text, str)

    def test_無音ファイル(self, whisper_service, audio_path):
        """無音の音声ファイル"""
        text, confidence = whisper_service.transcribe(
            audio_path / "silence.ogg",
            language="ja"
        )
        
        assert text == "" or len(text.strip()) == 0
```

---

## 🔗 Phase 2: 結合テスト（自動）

### 2.1 Bot ⇔ API 結合テスト

```typescript
// bot/src/__tests__/integration/api-integration.test.ts

describe('Bot⇔API結合テスト', () => {
  let service: TranscriptionService;

  beforeAll(async () => {
    service = new TranscriptionService(testConfig);
    await service.start(mockSessionContext);
  });

  afterAll(async () => {
    await service.stop();
  });

  test('セグメントを送信して文字起こし結果を受信', async () => {
    const segment = createMockAudioSegment({ duration: 3000 });
    
    const result = await new Promise<TranscriptionResult>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timeout')), 30000);
      
      service.once('transcribed', (result) => {
        clearTimeout(timeout);
        resolve(result);
      });
      
      service.transcribe(segment);
    });

    expect(result.text).toBeDefined();
    expect(result.confidence).toBeGreaterThan(0);
  });

  test('API障害時にサーキットブレーカーが発動', async () => {
    // APIを停止状態にする（モック）
    mockApiUnavailable();
    
    const segment = createMockAudioSegment();
    
    // 複数回失敗でサーキットブレーカー発動
    for (let i = 0; i < 5; i++) {
      await service.transcribe(segment);
    }
    
    const status = service.getStatus();
    expect(status.circuitBreaker.state).toBe('OPEN');
  });
});
```

### 2.2 T-4: 全体遅延テスト

```typescript
// bot/src/__tests__/integration/latency.test.ts

describe('全体遅延テスト (T-4)', () => {
  test('30秒以内に文字起こし完了', async () => {
    const segment = createMockAudioSegment({ duration: 5000 });
    const startTime = Date.now();
    
    const result = await transcribeWithTimeout(segment, 30000);
    const elapsed = Date.now() - startTime;
    
    expect(result.text).toBeDefined();
    expect(elapsed).toBeLessThan(30000);
    console.log(`遅延: ${elapsed}ms`);
  });

  test('連続10セグメントで安定した遅延', async () => {
    const latencies: number[] = [];
    
    for (let i = 0; i < 10; i++) {
      const segment = createMockAudioSegment({ duration: 3000 });
      const startTime = Date.now();
      
      await transcribeWithTimeout(segment, 30000);
      latencies.push(Date.now() - startTime);
    }

    const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;
    const maxLatency = Math.max(...latencies);

    expect(avgLatency).toBeLessThan(15000);
    expect(maxLatency).toBeLessThan(30000);
    
    console.log(`平均遅延: ${avgLatency}ms`);
    console.log(`最大遅延: ${maxLatency}ms`);
  });
});
```

---

## 👤 Phase 3: 手動テスト（E2E）

### 3.1 環境起動

```bash
# ターミナル1: Whisper API 起動
cd whisper-api
source venv/Scripts/activate
python -m uvicorn src.main:app --reload --host 0.0.0.0 --port 8000

# ターミナル2: Bot 起動
cd bot
npm run dev
```

### 3.2 基本機能テスト

#### テスト 3.2.1: Bot 起動確認

| # | 手順 | 期待結果 | 結果 |
|---|------|----------|------|
| 1 | Botを起動 | コンソールに「Bot is ready!」表示 | ⬜ |
| 2 | Discordでオンライン確認 | Botがオンライン表示 | ⬜ |
| 3 | `/status` コマンド実行 | 「Botは現在ボイスチャンネルに参加していません」 | ⬜ |

#### テスト 3.2.2: VC 参加/離脱

| # | 手順 | 期待結果 | 結果 |
|---|------|----------|------|
| 1 | VCに参加する | - | ⬜ |
| 2 | `/join` コマンド実行 | Botが同じVCに参加 | ⬜ |
| 3 | `/status` コマンド実行 | ステータス情報が表示 | ⬜ |
| 4 | `/leave` コマンド実行 | Botが離脱、セッション情報表示 | ⬜ |

#### テスト 3.2.3: 出力チャンネル指定

| # | 手順 | 期待結果 | 結果 |
|---|------|----------|------|
| 1 | VCに参加する | - | ⬜ |
| 2 | `/join output_channel:#bot-output` | Botが参加、出力先表示 | ⬜ |
| 3 | VCで発話する | #bot-output に文字起こし投稿 | ⬜ |
| 4 | `/leave` | 離脱、ファイルパス表示 | ⬜ |

---

### 3.3 文字起こしテスト

#### テスト 3.3.1: 単一話者

| # | 手順 | 期待結果 | 結果 |
|---|------|----------|------|
| 1 | `/join` でBotを参加 | 参加成功 | ⬜ |
| 2 | 「こんにちは、テストです」と発話 | 3〜30秒後に文字起こし表示 | ⬜ |
| 3 | 話者名が正しいか確認 | 自分の名前が表示 | ⬜ |
| 4 | 内容が正しいか確認 | 発話内容と一致 | ⬜ |

#### テスト 3.3.2: 複数話者（T-1 実機テスト）

| # | 手順 | 期待結果 | 結果 |
|---|------|----------|------|
| 1 | ユーザーA, B, Cが同じVCに参加 | - | ⬜ |
| 2 | `/join` でBotを参加 | 参加成功 | ⬜ |
| 3 | ユーザーAが発話 | A の名前で表示 | ⬜ |
| 4 | ユーザーBが発話 | B の名前で表示 | ⬜ |
| 5 | ユーザーCが発話 | C の名前で表示 | ⬜ |
| 6 | A, B が同時に発話 | 各ユーザーの発言が分離 | ⬜ |

#### テスト 3.3.3: 長文発話

| # | 手順 | 期待結果 | 結果 |
|---|------|----------|------|
| 1 | 30秒以上連続で話す | 適切にセグメント分割 | ⬜ |
| 2 | 各セグメントが正しく表示 | 途切れなく表示 | ⬜ |

---

### 3.4 出力テスト

#### テスト 3.4.1: Discord 出力フォーマット

| # | 手順 | 期待結果 | 結果 |
|---|------|----------|------|
| 1 | `.env` で `OUTPUT_DISCORD_FORMAT=standard` | 🎤 形式で表示 | ⬜ |
| 2 | `.env` で `OUTPUT_DISCORD_FORMAT=compact` | [時刻] 形式で表示 | ⬜ |
| 3 | `.env` で `OUTPUT_DISCORD_FORMAT=embed` | Embed形式で表示 | ⬜ |

#### テスト 3.4.2: ファイル出力

| # | 手順 | 期待結果 | 結果 |
|---|------|----------|------|
| 1 | セッション終了後 | `logs/YYYY-MM-DD/` 確認 | ⬜ |
| 2 | `.log` ファイル | ヘッダー/フッター/ログ形式 | ⬜ |
| 3 | `.json` ファイル | 正しいJSON構造 | ⬜ |
| 4 | `.md` ファイル | Markdown形式の議事録 | ⬜ |

---

### 3.5 エラー処理テスト

#### テスト 3.5.1: Whisper API 停止

| # | 手順 | 期待結果 | 結果 |
|---|------|----------|------|
| 1 | Whisper API を停止 | - | ⬜ |
| 2 | VCで発話 | サーキットブレーカー発動 | ⬜ |
| 3 | `/status` で確認 | API: 🔴 と表示 | ⬜ |
| 4 | Whisper API を再起動 | オフラインキュー処理開始 | ⬜ |
| 5 | 保留されていた発話が処理 | 文字起こし完了 | ⬜ |

#### テスト 3.5.2: 権限エラー

| # | 手順 | 期待結果 | 結果 |
|---|------|----------|------|
| 1 | Botに「接続」権限なしで `/join` | エラーメッセージ表示 | ⬜ |
| 2 | Botに「発言」権限なしで出力 | ログにエラー記録 | ⬜ |

---

### 3.6 負荷テスト

#### テスト 3.6.1: 長時間セッション

| # | 手順 | 期待結果 | 結果 |
|---|------|----------|------|
| 1 | `/join` でBotを参加 | - | ⬜ |
| 2 | 10分間継続して発話 | メモリリーク無し | ⬜ |
| 3 | 全ての発話が記録 | ログファイル確認 | ⬜ |
| 4 | `/status` で確認 | 正常なメトリクス | ⬜ |

#### テスト 3.6.2: 高頻度発話

| # | 手順 | 期待結果 | 結果 |
|---|------|----------|------|
| 1 | 3人で同時に連続発話 | キューが適切に処理 | ⬜ |
| 2 | 5分間継続 | 遅延が30秒以内 | ⬜ |
| 3 | 全発話が記録 | 欠落なし | ⬜ |

---

## 📊 Phase 4: テスト結果記録

### チェックリスト

```
[ ] T-1: 話者識別テスト - 複数ユーザー同時発話で正しく分離
[ ] T-2: 無音検知テスト - 誤分割なし
[ ] T-3: Whisper推論テスト - ノイズ/重複音声での精度確認
[ ] T-4: 全体遅延テスト - 3〜30秒以内

[ ] Discord 出力が正常
[ ] ログファイル出力が正常
[ ] JSON 出力が正常
[ ] Markdown 出力が正常

[ ] サーキットブレーカー動作確認
[ ] オフラインキュー動作確認
[ ] Graceful shutdown 動作確認

[ ] 10分以上のセッションで安定動作
[ ] 複数話者で安定動作
```

### 結果記録テンプレート

```markdown
## テスト結果 - YYYY-MM-DD

### 環境
- OS: Windows 10/11
- Node.js: 20.x
- Python: 3.10
- Whisper Model: large-v3
- Device: CPU/GPU

### 結果サマリー
| カテゴリ | Pass | Fail | Skip |
|---------|------|------|------|
| 単体テスト (Bot) | x | x | x |
| 単体テスト (API) | x | x | x |
| 結合テスト | x | x | x |
| 手動テスト | x | x | x |

### 遅延測定
- 平均遅延: xxxms
- 最大遅延: xxxms
- 最小遅延: xxxms

### 発見した問題
1. [問題の説明]
   - 再現手順: xxx
   - 期待結果: xxx
   - 実際結果: xxx

### 備考
- xxx
```

---

## 🔧 テストユーティリティ

### テスト音声ファイル生成

```python
# scripts/generate_test_audio.py
"""テスト用音声ファイルを生成"""
import wave
import struct
import math

def generate_silence(filename, duration_ms=1000):
    """無音ファイルを生成"""
    with wave.open(filename, 'w') as f:
        f.setnchannels(1)
        f.setsampwidth(2)
        f.setframerate(16000)
        samples = int(16000 * duration_ms / 1000)
        for _ in range(samples):
            f.writeframes(struct.pack('h', 0))

def generate_tone(filename, freq=440, duration_ms=1000, amplitude=10000):
    """トーン音声を生成"""
    with wave.open(filename, 'w') as f:
        f.setnchannels(1)
        f.setsampwidth(2)
        f.setframerate(16000)
        samples = int(16000 * duration_ms / 1000)
        for i in range(samples):
            value = int(amplitude * math.sin(2 * math.pi * freq * i / 16000))
            f.writeframes(struct.pack('h', value))

if __name__ == '__main__':
    generate_silence('silence.wav', 1000)
    generate_tone('tone_440hz.wav', 440, 3000)
    print('Test audio files generated.')
```

### ヘルスチェックスクリプト

```bash
#!/bin/bash
# scripts/health-check.sh

echo "=== Whisper API Health Check ==="
curl -s http://localhost:8000/health | jq .

echo ""
echo "=== Bot Status ==="
# Botのステータスエンドポイントがあれば
```

---

## 📅 テスト実行スケジュール

### 開発中

```
毎回のコミット前:
- npm run lint
- npm test (変更したファイルのみ)

毎日:
- 全単体テスト実行
- API ヘルスチェック

週次:
- 結合テスト
- 手動E2Eテスト
```

### リリース前

```
1. 全単体テスト (Bot + API)
2. 結合テスト
3. 手動E2Eテスト（全シナリオ）
4. 負荷テスト（10分セッション）
5. 遅延測定
6. ログファイル確認
```

---

## ✅ 完了基準

### 合格基準

- [ ] 全単体テスト Pass
- [ ] 結合テスト Pass
- [ ] T-1〜T-4 全て合格
- [ ] 手動テスト 主要シナリオ Pass
- [ ] 10分セッションで安定動作
- [ ] 平均遅延 15秒以内
- [ ] 最大遅延 30秒以内
- [ ] メモリリークなし

### 不合格時の対応

1. 失敗したテストを特定
2. 原因を調査・記録
3. 修正を実施
4. 再テスト

---

**次のステップ**: 単体テストの実装から開始

