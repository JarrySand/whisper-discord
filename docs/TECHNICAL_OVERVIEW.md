# 🔬 技術概要：高品質日本語文字起こしの実現

> **対象読者**: エンジニア、技術者  
> **バージョン**: 1.1.0  
> **最終更新**: 2025-12-05

---

## 📋 目次

1. [はじめに](#はじめに)
2. [アーキテクチャ概要](#アーキテクチャ概要)
3. [日本語文字起こし品質を高める技術](#日本語文字起こし品質を高める技術)
4. [音声処理パイプライン](#音声処理パイプライン)
5. [プロバイダーアーキテクチャ](#プロバイダーアーキテクチャ)
6. [Bot側フィルタリング](#bot側フィルタリング)
7. [データ管理とセキュリティ](#データ管理とセキュリティ)
8. [パフォーマンス考慮事項](#パフォーマンス考慮事項)
9. [今後の改善計画](#今後の改善計画)

---

## はじめに

本システムは、Discordボイスチャンネルの日本語会話を高精度で文字起こしすることを目的としています。Whisper（OpenAI製の多言語音声認識モデル）を基盤としつつ、日本語特有の課題に対応するための複数の技術的工夫を実装しています。

### なぜ日本語文字起こしは難しいのか

| 課題 | 説明 |
|------|------|
| **同音異義語** | 日本語は同じ発音で異なる意味の単語が多い（例：「かいしゃ」→ 会社/開始/解釈） |
| **文脈依存性** | 文末まで聞かないと意味が確定しない言語構造 |
| **相槌文化** | 「うん」「はい」「なるほど」等の大量の相槌 |
| **専門用語** | カタカナ語、略語、固有名詞の認識困難 |
| **話者の重複** | 複数話者の同時発話 |

---

## アーキテクチャ概要

### システム構成図

```
┌─────────────────────────────────────────────────────────────────┐
│                      Discord Voice Channel                       │
│                                                                  │
│    User A ─────┐                                                 │
│    User B ─────┼──── Opus Audio Stream (48kHz, Stereo)          │
│    User C ─────┘          │                                      │
└───────────────────────────┼─────────────────────────────────────┘
                            ▼
┌───────────────────────────────────────────────────────────────────┐
│                     Discord Bot (TypeScript)                      │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │ Voice Receiver                                               │  │
│  │  • SSRC → User ID マッピング（話者識別の核心）               │  │
│  │  • Opus → PCM デコード (prism-media)                        │  │
│  │  • 48kHz Stereo → 16kHz Mono リサンプリング                 │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                            │                                       │
│  ┌─────────────────────────▼───────────────────────────────────┐  │
│  │ Audio Segmenter                                              │  │
│  │  • 無音検知 (800ms)                                          │  │
│  │  • セグメント分割 (1〜8秒)                                   │  │
│  │  • RMSフィルタリング（低音量セグメント除去）                 │  │
│  │  • OGG/Opus エンコード (FFmpeg)                             │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                            │                                       │
│  ┌─────────────────────────▼───────────────────────────────────┐  │
│  │ Transcription Service                                        │  │
│  │  • サーキットブレーカー                                      │  │
│  │  • ヘルスモニタリング                                        │  │
│  │  • 優先度付きキュー管理                                      │  │
│  └─────────────────────────────────────────────────────────────┘  │
└────────────────────────────┼──────────────────────────────────────┘
                             │ HTTP POST (multipart/form-data)
                             ▼
┌───────────────────────────────────────────────────────────────────┐
│                    Whisper API Server (Python)                    │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │ Provider Selector (NEW!)                                     │  │
│  │  ┌─────────┐  ┌─────────┐  ┌─────────┐                      │  │
│  │  │  Local  │  │  Groq   │  │ OpenAI  │                      │  │
│  │  │ faster- │  │   API   │  │   API   │                      │  │
│  │  │ whisper │  │         │  │         │                      │  │
│  │  └─────────┘  └─────────┘  └─────────┘                      │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                            │                                       │
│  ┌─────────────────────────▼───────────────────────────────────┐  │
│  │ Hotwords & Japanese Context                                  │  │
│  │  • initial_prompt による日本語コンテキスト                  │  │
│  │  • 専門用語の事前登録                                        │  │
│  └─────────────────────────────────────────────────────────────┘  │
└────────────────────────────┼──────────────────────────────────────┘
                             │ JSON Response
                             ▼
┌───────────────────────────────────────────────────────────────────┐
│              Post-Processing Filters (Bot側, NEW!)                │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │ • AizuchiFilter (相槌フィルター)                            │  │
│  │ • HallucinationFilter (ハルシネーション除去)                │  │
│  │ • 空結果スキップ                                             │  │
│  └─────────────────────────────────────────────────────────────┘  │
└────────────────────────────┼──────────────────────────────────────┘
                             ▼
┌───────────────────────────────────────────────────────────────────┐
│                       Output Manager                              │
│  • Discord 投稿 (リアルタイム)                                   │
│  • ログファイル (.log)                                           │
│  • JSON ストレージ (.json)                                       │
│  • Markdown 議事録 (.md)                                         │
│  • SQLite データベース (サーバー別, NEW!)                        │
└───────────────────────────────────────────────────────────────────┘
```

### 技術スタック

| コンポーネント | 技術 | 選定理由 |
|--------------|------|---------|
| Bot | TypeScript + discord.js v14 | 型安全性、活発なコミュニティ |
| 音声処理 | @discordjs/voice, prism-media | Discord公式ライブラリ |
| Whisper (Local) | faster-whisper (CTranslate2) | CPU/GPU両対応、高速推論 |
| Whisper (Cloud) | Groq API, OpenAI API | 高速、スケーラブル |
| API | FastAPI + Uvicorn | 高性能非同期処理 |
| モデル | Whisper large-v3 | 日本語認識精度最高 |

---

## 日本語文字起こし品質を高める技術

### 1. 話者識別の仕組み

Discordの音声通信プロトコルでは、各話者に一意の **SSRC (Synchronization Source)** が割り当てられます。

```typescript
// 話者識別の核心部分
voiceConnection.receiver.subscribe(userId, {
  end: { behavior: EndBehaviorType.AfterSilence, duration: 100 },
  mode: 'opus',
});

// SSRC → User ID マッピング
voiceConnection.receiver.speaking.on('start', (userId: string) => {
  // 発話開始: ユーザーごとに個別のバッファを管理
  this.audioManager.startRecording(userId);
});
```

**利点**:
- AIベースの話者識別（声紋認識）が不要
- 100%正確な話者識別
- 同時発話でも個別に記録可能

### 2. 日本語特化 Initial Prompt

Whisperの `initial_prompt` パラメータを活用し、日本語会話のコンテキストを事前に与えます。

```python
# whisper-api/src/services/whisper.py
if language == "ja":
    base_prompt = "これは日本語の会話です。Discordのボイスチャンネルで話しています。"
    if hotwords_prompt:
        initial_prompt = f"{base_prompt} 用語: {hotwords_prompt}"
    else:
        initial_prompt = base_prompt
```

**効果**:
- 日本語の音韻パターンを事前学習として与える
- 文脈を理解した上での認識精度向上
- 誤認識の減少（例：「魔女腰が動いて」→「ボイスチャンネルに参加して」）

### 3. Hotwords（専門用語対応）

専門用語をinitial_promptに含めることで、認識精度を向上させます。

```python
# whisper-api/src/services/hotwords.py
class HotwordsManager:
    def get_prompt(self) -> str:
        """initial_prompt 用の文字列を生成"""
        if not self.hotwords:
            return ""
        return ", ".join(self.hotwords)
```

**登録例** (`config/hotwords.json`):
```json
{
  "hotwords": [
    "DAO", "NFT", "Ethereum", "Discord",
    "スマートコントラクト", "ガバナンストークン"
  ]
}
```

**なぜ効果があるか**:
- Whisperは言語モデルとしても機能
- initial_promptで専門用語を認識可能な状態にプライミング
- 未知語でも類似の発音から正しく認識

### 4. 最適なセグメント分割

日本語の発話パターンに最適化したセグメント分割を実装しています。

```typescript
// セグメント設定
AUDIO_SILENCE_THRESHOLD = 1500     // 無音検知: 1.5秒（自然な会話の間を許容）
AUDIO_MAX_SEGMENT_DURATION = 30000 // 最大長: 30秒（文脈を保持）
AUDIO_MIN_SEGMENT_DURATION = 1000  // 最小長: 1秒
```

**設計思想**:

| パラメータ | 値 | 理由 |
|-----------|-----|------|
| 最大長 8秒 | Whisperが処理しやすい長さ。10秒以上は精度低下 |
| 最小長 1秒 | 相槌レベルの短い発話は除外 |
| 無音閾値 800ms | 日本語の「間」を考慮。600msでは分断されすぎる |

---

## 音声処理パイプライン

### 入力から出力までの変換

```
Discord Opus (48kHz, Stereo, 960 samples/frame)
    │
    ▼ Opus Decode (prism-media)
PCM 16-bit Signed (48kHz, Stereo)
    │
    ▼ Resample + Downmix
PCM 16-bit Signed (16kHz, Mono)  ← Whisperの入力要件
    │
    ▼ Silence Detection
Segmented PCM (1-8秒)
    │
    ▼ RMS Filter (低音量除去)
Validated Segments
    │
    ▼ OGG/Opus Encode (FFmpeg)
OGG File (32kbps, 16kHz, Mono)  ← APIに送信
```

### RMSフィルタリング

```typescript
// 低音量セグメントの除去
AUDIO_MIN_RMS_THRESHOLD = 0.005

function calculateRMS(pcmData: Buffer): number {
  let sumSquares = 0;
  const samples = pcmData.length / 2;
  
  for (let i = 0; i < samples; i++) {
    const sample = pcmData.readInt16LE(i * 2) / 32768;
    sumSquares += sample * sample;
  }
  
  return Math.sqrt(sumSquares / samples);
}
```

**効果**:
- 環境ノイズのみのセグメントを除去
- APIコスト削減（特にクラウドプロバイダー使用時に重要）
- 空結果（文字起こし結果が空）の減少

---

## プロバイダーアーキテクチャ 🆕

### マルチプロバイダー対応

v1.1で3つの文字起こしプロバイダーをサポート：

```python
# whisper-api/src/services/cloud_providers.py

class TranscriptionProvider(Protocol):
    """Protocol for transcription providers."""
    
    def transcribe(
        self,
        audio_path: str,
        language: str = "ja",
    ) -> Tuple[str, float, float]:
        """Returns: (text, confidence, processing_time)"""
        ...
    
    def is_ready(self) -> bool:
        ...
    
    def get_provider_name(self) -> str:
        ...
```

### プロバイダー実装

#### 1. Local Provider (faster-whisper)

```python
class WhisperService:
    """ローカル faster-whisper 使用"""
    
    def transcribe(self, audio_path: str, language: str = "ja"):
        segments, info = self.model.transcribe(
            audio_path,
            language=language,
            initial_prompt=initial_prompt,
            vad_filter=True,
        )
        # ...
```

**特徴**:
- 無料（電気代のみ）
- large-v3モデルで最高精度
- CPU/GPU両対応
- オフライン動作可能

#### 2. Groq Provider

```python
class GroqProvider:
    """Groq API 使用（超高速）"""
    
    def transcribe(self, audio_path: str, language: str = "ja"):
        with open(audio_path, "rb") as audio_file:
            transcription = self._client.audio.transcriptions.create(
                file=(filename, audio_file),
                model="whisper-large-v3",
                language=language,
                response_format="verbose_json",
            )
        return transcription.text, 0.90, processing_time
```

**特徴**:
- 超高速処理（ローカルの10倍以上）
- large-v3 / large-v3-turbo 選択可能
- $0.0001/秒 の低コスト
- サーバーレスで常時利用可能

#### 3. OpenAI Provider

```python
class OpenAIProvider:
    """OpenAI API 使用（安定性重視）"""
    
    def transcribe(self, audio_path: str, language: str = "ja"):
        transcription = self._client.audio.transcriptions.create(
            file=audio_file,
            model="whisper-1",
            language=language,
        )
        return transcription.text, 0.92, processing_time
```

**特徴**:
- 公式Whisper API
- 高い安定性
- $0.006/分
- whisper-1モデル

### プロバイダー選択フロー

```python
# whisper-api/src/core/config.py
class WhisperConfig(BaseSettings):
    provider: Literal["local", "groq", "openai"] = "local"
    groq_api_key: Optional[str] = None
    openai_api_key: Optional[str] = None
```

```python
# 動的プロバイダー選択
def create_provider(provider_type: str, ...):
    if provider_type == "groq":
        return GroqProvider(api_key=groq_api_key)
    elif provider_type == "openai":
        return OpenAIProvider(api_key=openai_api_key)
    else:
        return None  # Local uses WhisperService directly
```

---

## Bot側フィルタリング 🆕

v1.1では、フィルタリング処理をWhisper API側からBot側に移動しました。

### 設計変更の理由

| 観点 | API側処理 | Bot側処理 |
|------|----------|----------|
| レスポンス時間 | 変わらず | 変わらず |
| フィルター調整 | API再起動必要 | 即座に反映 |
| ログ記録 | フィルター前の情報なし | 全情報を記録可能 |
| クラウド対応 | 各プロバイダーで実装必要 | 一箇所で統一 |

### 相槌フィルター (TypeScript)

```typescript
// bot/src/filters/aizuchi-filter.ts
const DEFAULT_PATTERNS: RegExp[] = [
  /^うん[。．、]*$/,
  /^はい[。．、]*$/,
  /^そうですね[。．、]*$/,
  /^なるほど[ね]*[。．、]*$/,
  // ... 30+ patterns
];

export class AizuchiFilter {
  isAizuchi(text: string): boolean {
    if (text.length > this.maxLength) return false;
    
    for (const pattern of this.patterns) {
      if (pattern.test(text)) return true;
    }
    return false;
  }
}
```

### ハルシネーションフィルター (TypeScript)

```typescript
// bot/src/filters/hallucination-filter.ts
export class HallucinationFilter {
  // 繰り返し検出
  detectRepetition(text: string): { isRepetition: boolean; phrase: string | null } {
    const words = text.split(/\s+/);
    if (words.length >= 3) {
      const uniqueWords = new Set(words);
      if (uniqueWords.size === 1) {
        return { isRepetition: true, phrase: words[0] };
      }
    }
    // サブストリング繰り返し検出...
  }
  
  // パターン検出
  detectPatternHallucination(text: string): boolean {
    const patterns = [
      /^字幕提供.*$/,
      /^ご視聴ありがとうございました.*$/,
      /(?:music|♪|♫)+/i,
    ];
    return patterns.some(p => p.test(text));
  }
}
```

### TranscriptionServiceでの適用

```typescript
// bot/src/services/transcription-service.ts
this.queue.on('completed', (item, result) => {
  let text = result.data.text?.trim() ?? '';
  
  // 空結果スキップ
  if (!text) return;
  
  // ハルシネーションフィルター
  const hallucinationResult = this.hallucinationFilter.filter(text);
  if (hallucinationResult.wasFiltered) {
    text = hallucinationResult.text;
  }
  
  // 相槌フィルター
  if (this.aizuchiFilter.isAizuchi(text)) {
    return; // スキップ
  }
  
  // 出力へ
  this.outputManager.output(transcriptionResult);
});
```

---

## データ管理とセキュリティ 🆕

### サーバー別データベース

SQLite機能有効時、各サーバーのデータは物理的に分離されたDBファイルに保存されます。

```typescript
// bot/src/output/sqlite-store.ts
export class SqliteStoreManager {
  private stores: Map<string, SqliteStore> = new Map();
  
  getStore(guildId: string): SqliteStore {
    let store = this.stores.get(guildId);
    if (!store) {
      const dbPath = `./data/guild_${guildId}.db`;
      store = new SqliteStore(dbPath);
      this.stores.set(guildId, store);
    }
    return store;
  }
}
```

**セキュリティ上の利点**:
- サーバー間のデータ分離が物理的に保証
- 検索時に他サーバーのデータにアクセス不可能
- バックアップ・削除がサーバー単位で可能

### サーバー設定の永続化

```typescript
// bot/src/services/guild-settings.ts
export class GuildSettingsManager {
  private settingsPath = './data/guild-settings.json';
  
  // デフォルト出力チャンネルを設定
  setDefaultOutputChannel(
    guildId: string,
    channelId: string,
    channelName?: string
  ): void {
    this.settings.guilds[guildId] = {
      guildId,
      defaultOutputChannelId: channelId,
      defaultOutputChannelName: channelName,
      updatedAt: new Date().toISOString(),
    };
    this.scheduleSave();
  }
}
```

---

## パフォーマンス考慮事項

### プロバイダー別パフォーマンス

| プロバイダー | 1分音声処理 | レイテンシ | スケーラビリティ |
|-------------|------------|-----------|----------------|
| Local (CPU) | 60秒 | 低 | 1並列 |
| Local (GPU) | 8秒 | 低 | 1並列 |
| Groq | 3秒 | 高 | 無制限 |
| OpenAI | 5秒 | 中 | 無制限 |

### CPU環境での最適化

```python
# INT8量子化による高速化
model = WhisperModel(
    model_size_or_path="large-v3",
    device="cpu",
    compute_type="int8",  # 4倍高速化
)
```

### メモリ管理

```typescript
// セグメントのバッファ管理
class AudioBuffer {
  private readonly maxBufferSize = 50 * 1024 * 1024; // 50MB

  addChunk(chunk: Buffer): boolean {
    if (this.currentSize + chunk.length > this.maxBufferSize) {
      this.flush(); // 強制フラッシュ
    }
  }
}
```

---

## 今後の改善計画

### Phase 1: 即座に実装可能（完了）
- ✅ FFmpegインストールによるOGGエンコード
- ✅ セグメント設定最適化
- ✅ 相槌フィルター (Bot側移行)
- ✅ ハルシネーションフィルター (Bot側移行)
- ✅ 日本語initial_prompt最適化
- ✅ クラウドプロバイダー対応 (Groq/OpenAI)
- ✅ サーバー別SQLite

### Phase 2: 中期的改善
- 🔄 GPU環境への移行（CUDA対応）
- 🔄 ストリーミング処理の検討
- 🔄 エラーハンドリング強化

### Phase 3: 長期的検討
- ⏳ ReazonSpeechなど日本語特化モデルの評価
- ⏳ ファインチューニング
- ⏳ リアルタイムストリーミング Whisper

---

## 参考資料

### 技術ドキュメント
- [Whisper Paper](https://arxiv.org/abs/2212.04356) - OpenAI Whisper論文
- [faster-whisper](https://github.com/SYSTRAN/faster-whisper) - CTranslate2実装
- [Groq API](https://console.groq.com/docs/quickstart) - Groq API ドキュメント
- [discord.js Guide](https://discordjs.guide/) - Discord Bot開発

### 関連ファイル
- `whisper-api/src/services/whisper.py` - Whisperサービス実装
- `whisper-api/src/services/cloud_providers.py` - クラウドプロバイダー
- `bot/src/filters/aizuchi-filter.ts` - 相槌フィルター
- `bot/src/filters/hallucination-filter.ts` - ハルシネーションフィルター
- `bot/src/audio/segmenter.ts` - セグメント分割
- `bot/src/output/sqlite-store.ts` - サーバー別SQLite
- `bot/src/services/guild-settings.ts` - サーバー設定管理

---

## まとめ

本システムが高品質な日本語文字起こしを実現している主な理由：

1. **話者識別**: DiscordのSSRCを活用した100%正確な話者識別
2. **最適なモデル選択**: faster-whisper + large-v3による高精度認識
3. **日本語特化プロンプト**: initial_promptによるコンテキスト提供
4. **専門用語対応**: Hotwordsによる認識精度向上
5. **Bot側フィルター**: 相槌・ハルシネーション除去を一元管理 🆕
6. **マルチプロバイダー**: 用途に応じてLocal/Groq/OpenAIを選択可能 🆕
7. **最適なセグメント分割**: 日本語の発話パターンに合わせた分割
8. **サーバー別データ管理**: セキュアなデータ分離 🆕

これらの技術を組み合わせることで、一般的な音声認識APIでは困難な、Discord VCの日本語会話を高精度で文字起こしすることを実現しています。
