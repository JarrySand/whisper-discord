# 📘 音声処理・セグメント化 詳細仕様書

> **関連**: [spec.md](../spec.md) - 全体概要 | [01-discord-bot.md](./01-discord-bot.md) - Bot仕様

---

## 1. 概要

Discord から受信した音声データを、Whisper が処理可能な形式にセグメント化・エンコードする処理の詳細仕様。

### 処理フロー概要

```
Opus Stream → PCM Decode → Buffer → Silence Detection → Segment → OGG Encode → File
```

---

## 2. 音声フォーマット仕様

### 2.1 入力フォーマット（Discord）

| 項目 | 値 |
|------|-----|
| コーデック | Opus |
| サンプルレート | 48,000 Hz |
| チャンネル | 2 (Stereo) |
| ビット深度 | 16-bit |
| フレームサイズ | 960 samples (20ms) |

### 2.2 中間フォーマット（PCM）

| 項目 | 値 |
|------|-----|
| フォーマット | PCM (リニア) |
| サンプルレート | 48,000 Hz → 16,000 Hz (リサンプリング) |
| チャンネル | 2 → 1 (モノラル変換) |
| ビット深度 | 16-bit signed |

### 2.3 出力フォーマット（Whisper用）

| 項目 | 値 |
|------|-----|
| コンテナ | OGG |
| コーデック | Opus |
| サンプルレート | 16,000 Hz |
| チャンネル | 1 (Mono) |
| ビットレート | 32 kbps |

---

## 3. 音声デコード処理

### 3.1 Opus → PCM デコード

```typescript
import Prism from 'prism-media';

class AudioDecoder {
  private decoder: Prism.opus.Decoder;

  constructor() {
    this.decoder = new Prism.opus.Decoder({
      rate: 48000,
      channels: 2,
      frameSize: 960,
    });
  }

  decode(opusData: Buffer): Buffer {
    return this.decoder.decode(opusData);
  }

  createStream(): Transform {
    return new Prism.opus.Decoder({
      rate: 48000,
      channels: 2,
      frameSize: 960,
    });
  }
}
```

### 3.2 リサンプリング（48kHz → 16kHz）

```typescript
import { Readable, Transform } from 'stream';

class Resampler extends Transform {
  private readonly inputRate = 48000;
  private readonly outputRate = 16000;
  private readonly ratio = this.inputRate / this.outputRate; // 3
  private buffer = Buffer.alloc(0);

  _transform(chunk: Buffer, encoding: string, callback: Function): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    
    const bytesPerSample = 2; // 16-bit
    const inputChannels = 2;
    const inputFrameSize = bytesPerSample * inputChannels;
    const outputFrameSize = bytesPerSample; // mono
    
    const inputSamples = Math.floor(this.buffer.length / inputFrameSize);
    const outputSamples = Math.floor(inputSamples / this.ratio);
    
    if (outputSamples === 0) {
      callback();
      return;
    }
    
    const outputBuffer = Buffer.alloc(outputSamples * outputFrameSize);
    
    for (let i = 0; i < outputSamples; i++) {
      const inputIndex = Math.floor(i * this.ratio);
      const inputOffset = inputIndex * inputFrameSize;
      
      // ステレオ → モノラル（左右平均）
      const left = this.buffer.readInt16LE(inputOffset);
      const right = this.buffer.readInt16LE(inputOffset + 2);
      const mono = Math.floor((left + right) / 2);
      
      outputBuffer.writeInt16LE(mono, i * outputFrameSize);
    }
    
    // 使用済みデータを削除
    const usedBytes = Math.floor(outputSamples * this.ratio) * inputFrameSize;
    this.buffer = this.buffer.slice(usedBytes);
    
    this.push(outputBuffer);
    callback();
  }
}
```

---

## 4. 無音検知アルゴリズム

### 4.1 無音判定パラメータ

```typescript
interface SilenceDetectionConfig {
  // 無音とみなす振幅閾値（16-bit PCM の絶対値）
  amplitudeThreshold: number;  // デフォルト: 500
  
  // 無音と判定する連続時間 (ms)
  silenceDuration: number;     // デフォルト: 600
  
  // 判定に使用するサンプル数
  windowSize: number;          // デフォルト: 160 (10ms @ 16kHz)
  
  // 無音判定の割合閾値（window内でこの割合が無音なら無音判定）
  silenceRatio: number;        // デフォルト: 0.9
}

const defaultConfig: SilenceDetectionConfig = {
  amplitudeThreshold: 500,
  silenceDuration: 600,
  windowSize: 160,
  silenceRatio: 0.9,
};
```

### 4.2 無音検知クラス

```typescript
class SilenceDetector {
  private config: SilenceDetectionConfig;
  private silenceStartTime: number | null = null;
  private readonly sampleRate = 16000;
  private readonly bytesPerSample = 2;

  constructor(config: Partial<SilenceDetectionConfig> = {}) {
    this.config = { ...defaultConfig, ...config };
  }

  /**
   * PCMデータを分析し、無音かどうかを判定
   * @returns 無音継続時間 (ms)、無音でなければ 0
   */
  analyze(pcmData: Buffer): number {
    const samples = pcmData.length / this.bytesPerSample;
    const windowSamples = Math.min(this.config.windowSize, samples);
    
    let silentSamples = 0;
    
    // 末尾のwindowを分析
    const startOffset = pcmData.length - (windowSamples * this.bytesPerSample);
    for (let i = 0; i < windowSamples; i++) {
      const offset = startOffset + (i * this.bytesPerSample);
      const amplitude = Math.abs(pcmData.readInt16LE(offset));
      
      if (amplitude < this.config.amplitudeThreshold) {
        silentSamples++;
      }
    }
    
    const silenceRatio = silentSamples / windowSamples;
    const isSilent = silenceRatio >= this.config.silenceRatio;
    
    const now = Date.now();
    
    if (isSilent) {
      if (this.silenceStartTime === null) {
        this.silenceStartTime = now;
      }
      return now - this.silenceStartTime;
    } else {
      this.silenceStartTime = null;
      return 0;
    }
  }

  /**
   * セグメント区切りが必要か判定
   */
  shouldSegment(): boolean {
    if (this.silenceStartTime === null) return false;
    return (Date.now() - this.silenceStartTime) >= this.config.silenceDuration;
  }

  reset(): void {
    this.silenceStartTime = null;
  }
}
```

### 4.3 RMS（二乗平均平方根）による高度な検知

```typescript
class RMSSilenceDetector {
  private config: SilenceDetectionConfig;
  private silenceStartTime: number | null = null;
  
  // RMS閾値（デシベル換算の参考値）
  // -40dB ≈ 0.01 (静寂)
  // -30dB ≈ 0.03 (囁き)
  // -20dB ≈ 0.1  (普通の会話)
  private readonly rmsThreshold = 0.02;

  analyzeRMS(pcmData: Buffer): number {
    const samples = pcmData.length / 2;
    let sumSquares = 0;
    
    for (let i = 0; i < samples; i++) {
      const sample = pcmData.readInt16LE(i * 2) / 32768; // 正規化
      sumSquares += sample * sample;
    }
    
    const rms = Math.sqrt(sumSquares / samples);
    const isSilent = rms < this.rmsThreshold;
    
    // ... 以降は同様の処理
  }
}
```

---

## 5. セグメント化処理

### 5.1 セグメント仕様

```typescript
interface AudioSegment {
  // 識別情報
  id: string;                    // UUID
  userId: string;                // Discord User ID
  username: string;              // Discord Username
  displayName: string;           // サーバーでの表示名
  
  // タイムスタンプ
  startTimestamp: number;        // Unix timestamp (ms)
  endTimestamp: number;          // Unix timestamp (ms)
  duration: number;              // 長さ (ms)
  
  // 音声データ
  audioData: Buffer;             // エンコード済み音声
  audioFormat: 'ogg' | 'wav';    // フォーマット
  audioPath?: string;            // ファイルパス（保存時）
  
  // メタデータ
  sampleRate: number;            // 16000
  channels: number;              // 1
  bitrate: number;               // 32000
}
```

### 5.2 セグメンター実装

```typescript
import { v4 as uuidv4 } from 'uuid';

class AudioSegmenter {
  private readonly minDuration = 500;   // 最小 500ms
  private readonly maxDuration = 10000; // 最大 10秒

  constructor(
    private encoder: AudioEncoder,
    private config: SegmenterConfig,
  ) {}

  /**
   * バッファからセグメントを作成
   */
  async createSegment(buffer: UserAudioBuffer): Promise<AudioSegment | null> {
    const duration = this.calculateDuration(buffer);
    
    // 最小長未満は破棄
    if (duration < this.minDuration) {
      return null;
    }
    
    // PCMデータを結合
    const pcmData = Buffer.concat(buffer.chunks.map(c => c.data));
    
    // OGGにエンコード
    const oggData = await this.encoder.encodeToOgg(pcmData);
    
    const segment: AudioSegment = {
      id: uuidv4(),
      userId: buffer.userId,
      username: buffer.username,
      displayName: buffer.displayName,
      startTimestamp: buffer.startTimestamp!,
      endTimestamp: buffer.lastActivityTimestamp,
      duration,
      audioData: oggData,
      audioFormat: 'ogg',
      sampleRate: 16000,
      channels: 1,
      bitrate: 32000,
    };
    
    // ファイル保存（オプション）
    if (this.config.saveToFile) {
      segment.audioPath = await this.saveSegment(segment);
    }
    
    return segment;
  }

  private calculateDuration(buffer: UserAudioBuffer): number {
    if (!buffer.startTimestamp) return 0;
    return buffer.lastActivityTimestamp - buffer.startTimestamp;
  }

  private async saveSegment(segment: AudioSegment): Promise<string> {
    const date = new Date(segment.startTimestamp);
    const dateStr = date.toISOString().split('T')[0];
    const timeStr = date.toTimeString().split(' ')[0].replace(/:/g, '-');
    
    const dir = `./segments/${dateStr}`;
    await fs.mkdir(dir, { recursive: true });
    
    const filename = `${segment.userId}_${timeStr}_${segment.id.slice(0, 8)}.ogg`;
    const filepath = `${dir}/${filename}`;
    
    await fs.writeFile(filepath, segment.audioData);
    
    return filepath;
  }
}
```

---

## 6. 音声エンコード

### 6.1 OGG/Opus エンコード

```typescript
import { spawn } from 'child_process';
import { Readable } from 'stream';

class AudioEncoder {
  /**
   * PCM → OGG/Opus エンコード (FFmpeg使用)
   */
  async encodeToOgg(pcmData: Buffer): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const ffmpeg = spawn('ffmpeg', [
        '-f', 's16le',           // 入力: signed 16-bit little-endian
        '-ar', '16000',          // サンプルレート: 16kHz
        '-ac', '1',              // チャンネル: mono
        '-i', 'pipe:0',          // 入力: stdin
        '-c:a', 'libopus',       // コーデック: Opus
        '-b:a', '32k',           // ビットレート: 32kbps
        '-vbr', 'on',            // 可変ビットレート
        '-compression_level', '10', // 最高圧縮
        '-f', 'ogg',             // 出力形式: OGG
        'pipe:1',                // 出力: stdout
      ]);
      
      const chunks: Buffer[] = [];
      
      ffmpeg.stdout.on('data', (chunk) => chunks.push(chunk));
      ffmpeg.stderr.on('data', () => {}); // エラー出力を無視
      
      ffmpeg.on('close', (code) => {
        if (code === 0) {
          resolve(Buffer.concat(chunks));
        } else {
          reject(new Error(`FFmpeg exited with code ${code}`));
        }
      });
      
      ffmpeg.on('error', reject);
      
      // PCMデータを送信
      const input = Readable.from(pcmData);
      input.pipe(ffmpeg.stdin);
    });
  }

  /**
   * PCM → WAV エンコード (ヘッダー付与のみ)
   * FFmpegが使えない環境用のフォールバック
   */
  encodeToWav(pcmData: Buffer): Buffer {
    const sampleRate = 16000;
    const channels = 1;
    const bitsPerSample = 16;
    const byteRate = sampleRate * channels * (bitsPerSample / 8);
    const blockAlign = channels * (bitsPerSample / 8);
    const dataSize = pcmData.length;
    const fileSize = 36 + dataSize;
    
    const header = Buffer.alloc(44);
    
    // RIFF header
    header.write('RIFF', 0);
    header.writeUInt32LE(fileSize, 4);
    header.write('WAVE', 8);
    
    // fmt subchunk
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16);           // Subchunk1Size
    header.writeUInt16LE(1, 20);            // AudioFormat (PCM)
    header.writeUInt16LE(channels, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(byteRate, 28);
    header.writeUInt16LE(blockAlign, 32);
    header.writeUInt16LE(bitsPerSample, 34);
    
    // data subchunk
    header.write('data', 36);
    header.writeUInt32LE(dataSize, 40);
    
    return Buffer.concat([header, pcmData]);
  }
}
```

### 6.2 FFmpeg なしでの Opus エンコード（オプション）

```typescript
import { OpusEncoder } from '@discordjs/opus';

class PureOpusEncoder {
  private encoder: OpusEncoder;

  constructor() {
    this.encoder = new OpusEncoder(16000, 1);
    this.encoder.setBitrate(32000);
  }

  /**
   * PCM → Opus フレームにエンコード
   * Note: OGGコンテナには別途ラッピングが必要
   */
  encodeFrames(pcmData: Buffer): Buffer[] {
    const frameSize = 320; // 20ms @ 16kHz, mono
    const bytesPerFrame = frameSize * 2; // 16-bit
    const frames: Buffer[] = [];
    
    for (let offset = 0; offset < pcmData.length; offset += bytesPerFrame) {
      const frame = pcmData.slice(offset, offset + bytesPerFrame);
      if (frame.length === bytesPerFrame) {
        frames.push(this.encoder.encode(frame));
      }
    }
    
    return frames;
  }
}
```

---

## 7. ファイルサイズ最適化

### 7.1 目標

- **1分あたり1MB以内**（spec.md NF-4 準拠）

### 7.2 計算

```
16kHz × 1ch × 16bit = 256 kbps (非圧縮PCM)
→ 1分 = 1.92 MB

Opus 32kbps 圧縮後:
→ 1分 = 0.24 MB ✅ 目標達成
```

### 7.3 ビットレート選択ガイド

| 用途 | ビットレート | 1分あたり | 品質 |
|------|------------|----------|------|
| 高品質 | 64 kbps | 0.48 MB | 音声認識最適 |
| 標準 | 32 kbps | 0.24 MB | 十分な品質 |
| 軽量 | 16 kbps | 0.12 MB | やや劣化 |

**推奨**: 32 kbps（品質とサイズのバランス）

---

## 8. エッジケース処理

### 8.1 語尾切れ防止

```typescript
class AntiClippingBuffer {
  private readonly paddingDuration = 200; // 200ms の余白
  private readonly paddingSamples: number;
  private silenceBuffer: Buffer;

  constructor(sampleRate = 16000) {
    this.paddingSamples = Math.floor(sampleRate * this.paddingDuration / 1000);
    this.silenceBuffer = Buffer.alloc(this.paddingSamples * 2); // 16-bit
  }

  /**
   * セグメント末尾に無音パディングを追加
   */
  addPadding(pcmData: Buffer): Buffer {
    return Buffer.concat([pcmData, this.silenceBuffer]);
  }
}
```

### 8.2 同時発話の処理

```typescript
class ConcurrentSpeechHandler {
  private activeBuffers = new Map<string, UserAudioBuffer>();

  /**
   * 複数ユーザーの同時発話は個別にバッファリング
   * → 各ユーザーのセグメントは独立して処理
   */
  handleAudio(userId: string, data: Buffer): void {
    let buffer = this.activeBuffers.get(userId);
    if (!buffer) {
      buffer = this.createNewBuffer(userId);
      this.activeBuffers.set(userId, buffer);
    }
    buffer.chunks.push({ data, timestamp: Date.now() });
  }
}
```

### 8.3 極短セグメントの処理

```typescript
class ShortSegmentHandler {
  private readonly minDuration = 500; // 500ms未満は破棄
  
  /**
   * 短すぎるセグメントは次のセグメントと結合
   */
  shouldMerge(segment: AudioSegment): boolean {
    return segment.duration < this.minDuration;
  }

  merge(prev: AudioSegment, next: AudioSegment): AudioSegment {
    return {
      ...prev,
      endTimestamp: next.endTimestamp,
      duration: prev.duration + next.duration,
      audioData: Buffer.concat([prev.audioData, next.audioData]),
    };
  }
}
```

---

## 9. パフォーマンス考慮事項

### 9.1 メモリ管理

```typescript
class MemoryManager {
  private readonly maxBufferSize = 50 * 1024 * 1024; // 50MB
  private currentUsage = 0;

  canAllocate(size: number): boolean {
    return this.currentUsage + size <= this.maxBufferSize;
  }

  allocate(size: number): void {
    this.currentUsage += size;
  }

  free(size: number): void {
    this.currentUsage = Math.max(0, this.currentUsage - size);
  }

  forceCleanup(): void {
    // 古いセグメントファイルを削除
    // 未使用バッファを解放
    global.gc?.(); // --expose-gc フラグが必要
  }
}
```

### 9.2 CPU使用率制限

```typescript
class CPUThrottler {
  private lastProcessTime = 0;
  private readonly minInterval = 10; // 10ms

  async throttle(): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.lastProcessTime;
    
    if (elapsed < this.minInterval) {
      await new Promise(r => setTimeout(r, this.minInterval - elapsed));
    }
    
    this.lastProcessTime = Date.now();
  }
}
```

---

## 10. 依存関係

```json
{
  "dependencies": {
    "prism-media": "^1.3.5",
    "@discordjs/opus": "^0.9.0",
    "uuid": "^9.0.0"
  },
  "optionalDependencies": {
    "ffmpeg-static": "^5.2.0"
  }
}
```

### システム要件

- **FFmpeg**: OGGエンコードに必要
  - Windows: `choco install ffmpeg` または 公式バイナリ
  - Linux: `apt install ffmpeg`
  - macOS: `brew install ffmpeg`

---

## 11. 次のドキュメント

- [03-whisper-api.md](./03-whisper-api.md) - Whisper API仕様
- [05-integration.md](./05-integration.md) - Bot⇔API連携

