# 📘 テスト・型定義 詳細仕様書

> **関連**: [spec.md](../spec.md) - 全体概要（T-1〜T-4）

---

## 1. 概要

システム全体のテスト戦略、テスト実装仕様、および共通型定義の詳細。

### テスト方針

| レベル | 対象 | ツール |
|--------|------|--------|
| 単体テスト | 個別モジュール | Jest (Bot) / pytest (API) |
| 結合テスト | Bot⇔API連携 | Jest + MSW / pytest + httpx |
| E2Eテスト | 全体フロー | 手動 + 自動化スクリプト |

---

## 2. 共通型定義

### 2.1 概要

プロジェクト全体で使用する型定義を統一し、Bot/API間の整合性を保証する。

### 2.2 Bot側 共通型定義

```typescript
// bot/src/types/index.ts

// ==================== ユーザー情報 ====================

/**
 * Discord ユーザーの基本情報
 */
export interface UserInfo {
  userId: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
}

/**
 * SSRC マッピング用ユーザー情報
 */
export interface SSRCUserInfo extends UserInfo {
  joinedAt: Date;
}

// ==================== 音声セグメント ====================

/**
 * 音声チャンク（バッファリング中のデータ）
 */
export interface AudioChunk {
  data: Buffer;
  timestamp: number;
}

/**
 * ユーザー別音声バッファ
 */
export interface UserAudioBuffer {
  userId: string;
  username: string;
  displayName: string;
  chunks: AudioChunk[];
  startTimestamp: number | null;
  lastActivityTimestamp: number;
}

/**
 * 音声セグメント（Whisper APIへ送信するデータ）
 */
export interface AudioSegment {
  id: string;
  userId: string;
  username: string;
  displayName: string;
  startTimestamp: number;
  endTimestamp: number;
  duration: number;
  audioData: Buffer;
  audioFormat: 'ogg' | 'wav';
  audioPath?: string;
  sampleRate: number;
  channels: number;
  bitrate: number;
}

// ==================== 文字起こし結果 ====================

/**
 * Whisper APIからの文字起こし結果
 * Note: Bot/API間で共通の形式
 */
export interface TranscriptionResult {
  id?: string;
  user_id: string;
  username: string;
  display_name: string | null;
  text: string;
  start_ts: number;
  end_ts: number;
  duration_ms: number;
  language: string;
  confidence: number;
  processing_time_ms: number;
}

// ==================== セッション ====================

/**
 * 文字起こしセッション情報
 */
export interface SessionContext {
  sessionId: string;
  guildId: string;
  guildName: string;
  channelId: string;
  channelName: string;
  outputChannel?: TextChannel;
  startTime: Date;
}

/**
 * セッション統計
 */
export interface SessionStats {
  totalSegments: number;
  totalDurationMs: number;
  avgSegmentDurationMs: number;
  avgConfidence: number;
  wordsPerMinute: number;
  participantCount: number;
}

// ==================== API通信 ====================

/**
 * Whisper API リクエスト
 */
export interface TranscribeRequest {
  audioData: Buffer;
  audioFormat: string;
  userId: string;
  username: string;
  displayName?: string;
  startTs: number;
  endTs: number;
  language?: string;
}

/**
 * Whisper API レスポンス
 */
export interface TranscribeResponse {
  success: boolean;
  data?: TranscriptionResult;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
}

// ==================== キュー ====================

/**
 * 処理キューアイテム
 */
export interface QueueItem {
  id: string;
  segment: AudioSegment;
  addedAt: number;
  retryCount: number;
  priority: number;
}

/**
 * キューステータス
 */
export interface QueueStatus {
  queued: number;
  processing: number;
  isRunning: boolean;
}

// ==================== サービスステータス ====================

/**
 * サービス全体のステータス
 */
export interface ServiceStatus {
  queue: QueueStatus;
  circuitBreaker: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
  health: {
    isHealthy: boolean;
    lastCheck: number;
  };
}
```

### 2.3 API側 共通型定義

```python
# whisper-api/src/api/schemas.py
from pydantic import BaseModel, Field
from typing import Optional, List, Any
from datetime import datetime

# ==================== リクエスト ====================

class TranscribeRequest(BaseModel):
    """文字起こしリクエスト"""
    user_id: str = Field(..., description="Discord User ID")
    username: str = Field(..., description="Discord Username")
    display_name: Optional[str] = Field(None, description="Server display name")
    start_ts: int = Field(..., description="Start timestamp (Unix ms)")
    end_ts: int = Field(..., description="End timestamp (Unix ms)")
    language: str = Field("ja", description="Language hint")


class BatchMetadata(BaseModel):
    """バッチ処理用メタデータ"""
    user_id: str
    username: str
    display_name: Optional[str] = None
    start_ts: int
    end_ts: int
    language: str = "ja"


# ==================== レスポンス ====================

class TranscriptionResult(BaseModel):
    """文字起こし結果"""
    user_id: str
    username: str
    display_name: Optional[str]
    text: str
    start_ts: int
    end_ts: int
    duration_ms: int
    language: str
    confidence: float = Field(..., ge=0.0, le=1.0)
    processing_time_ms: int


class TranscribeResponse(BaseModel):
    """文字起こしAPIレスポンス"""
    success: bool
    data: Optional[TranscriptionResult] = None
    error: Optional[dict] = None


class BatchResult(BaseModel):
    """バッチ処理結果"""
    index: int
    success: bool
    text: Optional[str] = None
    user_id: str
    confidence: Optional[float] = None
    error: Optional[str] = None


class BatchResponse(BaseModel):
    """バッチ処理APIレスポンス"""
    success: bool
    data: Optional[dict] = None  # { results: BatchResult[], total_processing_time_ms: int }
    error: Optional[dict] = None


# ==================== ヘルスチェック ====================

class HealthResponse(BaseModel):
    """ヘルスチェックレスポンス"""
    status: str  # "healthy" | "loading" | "error"
    model_loaded: bool
    model_name: str
    device: str
    compute_type: str
    uptime_seconds: int
    requests_processed: int
    avg_processing_time_ms: float


class StatusResponse(BaseModel):
    """詳細ステータスレスポンス"""
    server: dict
    model: dict
    stats: dict
    queue: dict


# ==================== エラー ====================

class ErrorDetail(BaseModel):
    """エラー詳細"""
    code: str
    message: str
    details: Optional[Any] = None
```

### 2.4 型定義の同期

Bot と API 間で型定義の整合性を保つため：

1. **スキーマ駆動**: API の Pydantic モデルを正とする
2. **CI チェック**: 型定義の差分を検出するスクリプト
3. **コードレビュー**: 型変更時は両側を同時に更新

```bash
# 型定義同期チェックスクリプト（将来実装）
# scripts/check-types.sh
#!/bin/bash
# Bot と API の型定義を比較し、不整合を検出
```

---

## 3. テスト要件（spec.md T-1〜T-4 対応）

### 3.1 T-1: 話者識別テスト

**目的**: 複数ユーザーが同時に話したときに正しいユーザーに割り当てられるか

```typescript
// bot/src/__tests__/voice/ssrc-mapper.test.ts
import { SSRCMapper } from '../../voice/ssrc-mapper';

describe('SSRCMapper', () => {
  let mapper: SSRCMapper;

  beforeEach(() => {
    mapper = new SSRCMapper();
  });

  test('should register and retrieve user by SSRC', () => {
    const mockMember = {
      user: { username: 'alice' },
      displayName: 'Alice',
    } as GuildMember;

    mapper.register(12345, 'user-123', mockMember);
    
    const info = mapper.get(12345);
    expect(info).toBeDefined();
    expect(info?.userId).toBe('user-123');
    expect(info?.username).toBe('alice');
  });

  test('should handle multiple concurrent users', () => {
    mapper.register(11111, 'user-1', mockMember1);
    mapper.register(22222, 'user-2', mockMember2);
    mapper.register(33333, 'user-3', mockMember3);

    expect(mapper.get(11111)?.userId).toBe('user-1');
    expect(mapper.get(22222)?.userId).toBe('user-2');
    expect(mapper.get(33333)?.userId).toBe('user-3');
  });

  test('should find user by userId', () => {
    mapper.register(12345, 'user-123', mockMember);
    
    const info = mapper.getByUserId('user-123');
    expect(info).toBeDefined();
    expect(info?.userId).toBe('user-123');
  });
});
```

### 3.2 T-2: 無音検知テスト

**目的**: 会話が途切れやすい環境で誤分割が起きないか

```typescript
// bot/src/__tests__/audio/silence-detector.test.ts
import { SilenceDetector } from '../../audio/silence-detector';

describe('SilenceDetector', () => {
  test('should detect silence when amplitude is below threshold', () => {
    const detector = new SilenceDetector({ amplitudeThreshold: 500 });
    
    // 無音データ（振幅 < 500）
    const silentPcm = createPcmBuffer({ amplitude: 100, duration: 100 });
    const silenceDuration = detector.analyze(silentPcm);
    
    expect(silenceDuration).toBeGreaterThan(0);
  });

  test('should not detect silence when amplitude is above threshold', () => {
    const detector = new SilenceDetector({ amplitudeThreshold: 500 });
    
    // 音声データ（振幅 > 500）
    const loudPcm = createPcmBuffer({ amplitude: 5000, duration: 100 });
    const silenceDuration = detector.analyze(loudPcm);
    
    expect(silenceDuration).toBe(0);
  });

  test('should trigger segmentation after silence duration threshold', () => {
    const detector = new SilenceDetector({
      amplitudeThreshold: 500,
      silenceDuration: 600,
    });
    
    // 600ms以上の無音
    for (let i = 0; i < 10; i++) {
      const silentPcm = createPcmBuffer({ amplitude: 100, duration: 100 });
      detector.analyze(silentPcm);
    }
    
    expect(detector.shouldSegment()).toBe(true);
  });

  test('should reset on voice activity', () => {
    const detector = new SilenceDetector();
    
    // 無音 → 音声 の切り替え
    detector.analyze(createSilentPcm());
    detector.analyze(createLoudPcm());
    
    expect(detector.shouldSegment()).toBe(false);
  });
});

// ヘルパー関数
function createPcmBuffer(options: { amplitude: number; duration: number }): Buffer {
  const sampleRate = 16000;
  const samples = Math.floor((sampleRate * options.duration) / 1000);
  const buffer = Buffer.alloc(samples * 2);
  
  for (let i = 0; i < samples; i++) {
    buffer.writeInt16LE(options.amplitude, i * 2);
  }
  
  return buffer;
}
```

### 3.3 T-3: Whisper推論テスト

**目的**: 雑音・重複・聞き取りづらい音声での精度確認

```python
# whisper-api/tests/test_whisper_service.py
import pytest
from pathlib import Path
from src.services.whisper import WhisperService
from src.core.config import WhisperConfig

class TestWhisperService:
    @pytest.fixture
    def whisper_service(self):
        config = WhisperConfig(
            model_name="tiny",  # テスト用に軽量モデル
            device="cpu",
            compute_type="int8",
        )
        service = WhisperService(config)
        service.load_model()
        return service

    def test_transcribe_clear_japanese(self, whisper_service, sample_audio_path):
        """クリアな日本語音声の文字起こし"""
        text, confidence = whisper_service.transcribe(
            sample_audio_path / "clear_japanese.ogg",
            language="ja"
        )
        
        assert len(text) > 0
        assert confidence > 0.8
        assert "こんにちは" in text  # 期待されるフレーズ

    def test_transcribe_noisy_audio(self, whisper_service, sample_audio_path):
        """ノイズを含む音声の文字起こし"""
        text, confidence = whisper_service.transcribe(
            sample_audio_path / "noisy_audio.ogg",
            language="ja"
        )
        
        # ノイズがあっても何らかのテキストが返る
        assert isinstance(text, str)
        # 信頼度は低くなる可能性
        assert 0.0 <= confidence <= 1.0

    def test_transcribe_short_audio(self, whisper_service, sample_audio_path):
        """短い音声（500ms未満）の処理"""
        text, confidence = whisper_service.transcribe(
            sample_audio_path / "short_300ms.ogg",
            language="ja"
        )
        
        # 短すぎる音声は空文字列を返す可能性
        assert isinstance(text, str)

    def test_transcribe_multiple_speakers(self, whisper_service, sample_audio_path):
        """
        複数話者の音声
        Note: Whisperは話者識別しないため、連続したテキストとして返す
        """
        text, confidence = whisper_service.transcribe(
            sample_audio_path / "multiple_speakers.ogg",
            language="ja"
        )
        
        assert len(text) > 0

    def test_empty_audio_returns_empty_string(self, whisper_service, sample_audio_path):
        """無音の音声ファイル"""
        text, confidence = whisper_service.transcribe(
            sample_audio_path / "silence.ogg",
            language="ja"
        )
        
        # 無音は空文字列
        assert text == "" or len(text.strip()) == 0


# テストデータ fixtures
@pytest.fixture
def sample_audio_path():
    return Path(__file__).parent / "fixtures" / "audio"
```

### 3.4 T-4: 全体遅延テスト

**目的**: 3秒〜30秒遅延以内で安定的に結果が得られるか

```typescript
// bot/src/__tests__/integration/latency.test.ts
import { TranscriptionService } from '../../services/transcription-service';
import { createMockAudioSegment } from '../helpers/mock-audio';

describe('End-to-End Latency', () => {
  let service: TranscriptionService;

  beforeAll(async () => {
    service = new TranscriptionService(testConfig);
    await service.start(mockSessionContext);
  });

  afterAll(async () => {
    await service.stop();
  });

  test('should complete transcription within 30 seconds', async () => {
    const segment = createMockAudioSegment({ duration: 5000 }); // 5秒の音声
    
    const startTime = Date.now();
    
    const result = await new Promise<TranscriptionResult>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Timeout: 30 seconds exceeded'));
      }, 30000);

      service.once('transcribed', (result) => {
        clearTimeout(timeout);
        resolve(result);
      });

      service.transcribe(segment);
    });

    const elapsed = Date.now() - startTime;
    
    expect(result.text).toBeDefined();
    expect(elapsed).toBeLessThan(30000);
    
    console.log(`Latency: ${elapsed}ms`);
  });

  test('should maintain stable latency under load', async () => {
    const segments = Array.from({ length: 10 }, (_, i) => 
      createMockAudioSegment({ duration: 3000, id: `segment-${i}` })
    );

    const latencies: number[] = [];

    for (const segment of segments) {
      const startTime = Date.now();
      
      await new Promise<void>((resolve) => {
        service.once('transcribed', () => {
          latencies.push(Date.now() - startTime);
          resolve();
        });
        service.transcribe(segment);
      });
    }

    const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;
    const maxLatency = Math.max(...latencies);

    expect(avgLatency).toBeLessThan(15000); // 平均15秒以内
    expect(maxLatency).toBeLessThan(30000); // 最大30秒以内

    console.log(`Average latency: ${avgLatency}ms`);
    console.log(`Max latency: ${maxLatency}ms`);
  });
});
```

---

## 4. Bot 側テスト実装

### 4.1 ディレクトリ構造

```
bot/
├── src/
│   └── __tests__/
│       ├── commands/
│       │   ├── join.test.ts
│       │   └── leave.test.ts
│       ├── voice/
│       │   ├── connection.test.ts
│       │   ├── receiver.test.ts
│       │   └── ssrc-mapper.test.ts
│       ├── audio/
│       │   ├── buffer.test.ts
│       │   ├── segmenter.test.ts
│       │   ├── silence-detector.test.ts
│       │   └── encoder.test.ts
│       ├── api/
│       │   ├── whisper-client.test.ts
│       │   ├── queue.test.ts
│       │   └── circuit-breaker.test.ts
│       ├── output/
│       │   ├── discord.test.ts
│       │   ├── file-logger.test.ts
│       │   └── json-store.test.ts
│       ├── integration/
│       │   └── latency.test.ts
│       ├── helpers/
│       │   ├── mock-audio.ts
│       │   └── mock-discord.ts
│       └── fixtures/
│           └── audio/
│               ├── sample.ogg
│               └── silence.ogg
├── jest.config.js
└── package.json
```

### 4.2 Jest 設定

```javascript
// bot/jest.config.js
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/__tests__/**',
    '!src/types/**',
  ],
  coverageThreshold: {
    global: {
      branches: 70,
      functions: 80,
      lines: 80,
      statements: 80,
    },
  },
  setupFilesAfterEnv: ['<rootDir>/src/__tests__/setup.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
};
```

### 4.3 テストセットアップ

```typescript
// bot/src/__tests__/setup.ts
import { jest } from '@jest/globals';

// グローバルモック
jest.mock('discord.js', () => ({
  Client: jest.fn(),
  GatewayIntentBits: {
    Guilds: 1,
    GuildVoiceStates: 2,
    GuildMessages: 4,
  },
  // 他のモック
}));

// タイムアウト設定
jest.setTimeout(30000);

// 環境変数
process.env.DISCORD_BOT_TOKEN = 'test-token';
process.env.WHISPER_API_URL = 'http://localhost:8000';
```

---

## 5. API 側テスト実装

### 5.1 ディレクトリ構造

```
whisper-api/
├── tests/
│   ├── conftest.py
│   ├── test_main.py
│   ├── api/
│   │   ├── test_routes.py
│   │   └── test_schemas.py
│   ├── services/
│   │   ├── test_whisper.py
│   │   └── test_audio.py
│   ├── core/
│   │   └── test_config.py
│   ├── integration/
│   │   └── test_end_to_end.py
│   └── fixtures/
│       └── audio/
│           ├── sample.ogg
│           ├── noisy.ogg
│           └── silence.ogg
├── pytest.ini
└── requirements-dev.txt
```

### 5.2 pytest 設定

```ini
# whisper-api/pytest.ini
[pytest]
testpaths = tests
python_files = test_*.py
python_classes = Test*
python_functions = test_*
addopts = -v --cov=src --cov-report=html --cov-report=term-missing
markers =
    slow: marks tests as slow (deselect with '-m "not slow"')
    integration: marks tests as integration tests
```

### 5.3 テスト fixtures

```python
# whisper-api/tests/conftest.py
import pytest
from pathlib import Path
from fastapi.testclient import TestClient
from src.main import app
from src.services.whisper import WhisperService
from src.core.config import WhisperConfig, ServerConfig

@pytest.fixture
def client():
    """FastAPI テストクライアント"""
    return TestClient(app)

@pytest.fixture
def sample_audio_path():
    """テスト用音声ファイルパス"""
    return Path(__file__).parent / "fixtures" / "audio"

@pytest.fixture
def sample_ogg_file(sample_audio_path):
    """サンプル OGG ファイル"""
    path = sample_audio_path / "sample.ogg"
    with open(path, "rb") as f:
        return f.read()

@pytest.fixture
def whisper_config():
    """テスト用 Whisper 設定"""
    return WhisperConfig(
        model_name="tiny",  # テスト用に軽量モデル
        device="cpu",
        compute_type="int8",
    )

@pytest.fixture
def mock_whisper_service(mocker):
    """モック Whisper サービス"""
    service = mocker.MagicMock(spec=WhisperService)
    service.transcribe.return_value = ("テスト文字起こし結果", 0.95)
    service.is_ready.return_value = True
    return service
```

### 5.4 API エンドポイントテスト

```python
# whisper-api/tests/api/test_routes.py
import pytest
from fastapi.testclient import TestClient

class TestTranscribeEndpoint:
    def test_transcribe_success(self, client, sample_ogg_file):
        """正常な文字起こしリクエスト"""
        response = client.post(
            "/transcribe",
            files={"audio_file": ("test.ogg", sample_ogg_file, "audio/ogg")},
            data={
                "user_id": "123456789",
                "username": "testuser",
                "start_ts": "1733389200000",
                "end_ts": "1733389205000",
            },
        )
        
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert "text" in data["data"]

    def test_transcribe_missing_file(self, client):
        """音声ファイル欠落エラー"""
        response = client.post(
            "/transcribe",
            data={
                "user_id": "123456789",
                "username": "testuser",
                "start_ts": "1733389200000",
                "end_ts": "1733389205000",
            },
        )
        
        assert response.status_code == 422  # Validation error

    def test_transcribe_invalid_format(self, client):
        """非対応フォーマットエラー"""
        response = client.post(
            "/transcribe",
            files={"audio_file": ("test.txt", b"not audio", "text/plain")},
            data={
                "user_id": "123456789",
                "username": "testuser",
                "start_ts": "1733389200000",
                "end_ts": "1733389205000",
            },
        )
        
        assert response.status_code == 400


class TestHealthEndpoint:
    def test_health_check(self, client):
        """ヘルスチェックエンドポイント"""
        response = client.get("/health")
        
        assert response.status_code == 200
        data = response.json()
        assert "status" in data
        assert "model_loaded" in data


class TestBatchEndpoint:
    def test_batch_transcribe(self, client, sample_ogg_file):
        """バッチ文字起こしリクエスト"""
        metadata = [
            {"user_id": "123", "username": "user1", "start_ts": 1000, "end_ts": 2000},
            {"user_id": "456", "username": "user2", "start_ts": 1500, "end_ts": 2500},
        ]
        
        response = client.post(
            "/transcribe/batch",
            files=[
                ("files", ("seg1.ogg", sample_ogg_file, "audio/ogg")),
                ("files", ("seg2.ogg", sample_ogg_file, "audio/ogg")),
            ],
            data={"metadata": str(metadata)},
        )
        
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert len(data["data"]["results"]) == 2
```

---

## 6. モック・スタブ

### 6.1 Discord モック

```typescript
// bot/src/__tests__/helpers/mock-discord.ts
import { jest } from '@jest/globals';

export const createMockClient = () => ({
  user: { id: 'bot-user-id', username: 'TestBot' },
  login: jest.fn().mockResolvedValue('token'),
  on: jest.fn(),
  once: jest.fn(),
  destroy: jest.fn(),
});

export const createMockVoiceChannel = () => ({
  id: 'voice-channel-id',
  name: 'Test Voice Channel',
  guild: {
    id: 'guild-id',
    name: 'Test Guild',
    voiceAdapterCreator: jest.fn(),
  },
  members: new Map(),
});

export const createMockTextChannel = () => ({
  id: 'text-channel-id',
  name: 'Test Text Channel',
  send: jest.fn().mockResolvedValue({}),
});

export const createMockGuildMember = (userId: string, username: string) => ({
  id: userId,
  user: {
    id: userId,
    username,
    displayAvatarURL: () => 'https://example.com/avatar.png',
  },
  displayName: username,
});
```

### 6.2 音声データモック

```typescript
// bot/src/__tests__/helpers/mock-audio.ts
import { v4 as uuidv4 } from 'uuid';
import type { AudioSegment } from '../../types';

interface MockAudioOptions {
  duration?: number;
  id?: string;
  userId?: string;
  username?: string;
  amplitude?: number;
}

export function createMockAudioSegment(options: MockAudioOptions = {}): AudioSegment {
  const {
    duration = 3000,
    id = uuidv4(),
    userId = 'test-user-id',
    username = 'TestUser',
    amplitude = 5000,
  } = options;

  const sampleRate = 16000;
  const samples = Math.floor((sampleRate * duration) / 1000);
  const audioData = Buffer.alloc(samples * 2);

  // サイン波を生成
  for (let i = 0; i < samples; i++) {
    const value = Math.sin((2 * Math.PI * 440 * i) / sampleRate) * amplitude;
    audioData.writeInt16LE(Math.floor(value), i * 2);
  }

  const now = Date.now();

  return {
    id,
    userId,
    username,
    displayName: username,
    startTimestamp: now - duration,
    endTimestamp: now,
    duration,
    audioData,
    audioFormat: 'ogg',
    sampleRate: 16000,
    channels: 1,
    bitrate: 32000,
  };
}

export function createSilentPcm(durationMs = 100): Buffer {
  const samples = Math.floor((16000 * durationMs) / 1000);
  return Buffer.alloc(samples * 2); // 全てゼロ（無音）
}

export function createLoudPcm(durationMs = 100, amplitude = 10000): Buffer {
  const samples = Math.floor((16000 * durationMs) / 1000);
  const buffer = Buffer.alloc(samples * 2);
  
  for (let i = 0; i < samples; i++) {
    buffer.writeInt16LE(amplitude, i * 2);
  }
  
  return buffer;
}
```

---

## 7. CI/CD 設定

### 7.1 GitHub Actions

```yaml
# .github/workflows/test.yml
name: Test

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  test-bot:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: bot

    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
          cache-dependency-path: bot/package-lock.json

      - name: Install dependencies
        run: npm ci

      - name: Run linter
        run: npm run lint

      - name: Run tests
        run: npm test -- --coverage

      - name: Upload coverage
        uses: codecov/codecov-action@v3
        with:
          files: ./bot/coverage/lcov.info
          flags: bot

  test-api:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: whisper-api

    steps:
      - uses: actions/checkout@v4

      - name: Setup Python
        uses: actions/setup-python@v5
        with:
          python-version: '3.10'
          cache: 'pip'

      - name: Install dependencies
        run: |
          pip install -r requirements.txt
          pip install -r requirements-dev.txt

      - name: Run linter
        run: |
          flake8 src tests
          mypy src

      - name: Run tests
        run: pytest --cov=src --cov-report=xml

      - name: Upload coverage
        uses: codecov/codecov-action@v3
        with:
          files: ./whisper-api/coverage.xml
          flags: api

  integration-test:
    runs-on: ubuntu-latest
    needs: [test-bot, test-api]
    if: github.event_name == 'push' && github.ref == 'refs/heads/main'

    steps:
      - uses: actions/checkout@v4

      - name: Setup Docker Compose
        run: docker compose -f docker-compose.test.yml up -d

      - name: Wait for services
        run: sleep 30

      - name: Run integration tests
        run: |
          cd bot
          npm ci
          npm run test:integration

      - name: Cleanup
        run: docker compose -f docker-compose.test.yml down
```

### 7.2 テスト用 Docker Compose

```yaml
# docker-compose.test.yml
version: '3.8'

services:
  whisper-api-test:
    build:
      context: ./whisper-api
      dockerfile: Dockerfile
    environment:
      - WHISPER_MODEL_NAME=tiny
      - WHISPER_DEVICE=cpu
      - WHISPER_COMPUTE_TYPE=int8
    ports:
      - "8000:8000"
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8000/health"]
      interval: 10s
      timeout: 5s
      retries: 5
```

---

## 8. カバレッジ目標

| コンポーネント | 行カバレッジ | 分岐カバレッジ |
|---------------|-------------|---------------|
| Bot - commands | 90% | 85% |
| Bot - voice | 80% | 75% |
| Bot - audio | 85% | 80% |
| Bot - api | 90% | 85% |
| Bot - output | 85% | 80% |
| API - routes | 95% | 90% |
| API - services | 80% | 75% |
| **全体** | **85%** | **80%** |

---

## 9. 次のドキュメント

- [spec.md](../spec.md) - 全体概要に戻る
- [01-discord-bot.md](./01-discord-bot.md) - Bot実装仕様


