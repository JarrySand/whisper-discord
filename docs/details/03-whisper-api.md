# 📘 Whisper API サーバー 詳細仕様書

> **関連**: [spec.md](../spec.md) - 全体概要 | [05-integration.md](./05-integration.md) - 連携仕様

---

## 1. 概要

音声ファイルを受け取り、Whisper モデルで文字起こしを行うHTTP APIサーバー。

### 技術スタック

| 項目 | 技術 |
|------|------|
| 言語 | Python 3.10+ |
| フレームワーク | FastAPI |
| Whisperライブラリ | faster-whisper (CTranslate2) |
| モデル | large-v3 |
| ASGIサーバー | Uvicorn |

### 設計思想

- **単一責任**: 音声 → テキスト変換のみ
- **ステートレス**: リクエストごとに独立
- **話者識別なし**: 話者情報は Bot 側の責務

---

## 2. ディレクトリ構造

```
whisper-api/
├── src/
│   ├── __init__.py
│   ├── main.py               # FastAPI アプリケーション
│   ├── api/
│   │   ├── __init__.py
│   │   ├── routes.py         # エンドポイント定義
│   │   └── schemas.py        # Pydantic モデル
│   ├── core/
│   │   ├── __init__.py
│   │   ├── config.py         # 設定管理
│   │   └── logging.py        # ログ設定
│   ├── services/
│   │   ├── __init__.py
│   │   ├── whisper.py        # Whisper推論サービス
│   │   └── audio.py          # 音声前処理
│   └── utils/
│       ├── __init__.py
│       └── file.py           # ファイル操作
├── models/                   # Whisperモデルキャッシュ
├── temp/                     # 一時ファイル
├── requirements.txt
├── Dockerfile
├── docker-compose.yml
└── .env.example
```

---

## 3. API エンドポイント仕様

### 3.1 POST `/transcribe`

**概要**: 音声ファイルを文字起こし

#### リクエスト

```http
POST /transcribe HTTP/1.1
Content-Type: multipart/form-data

--boundary
Content-Disposition: form-data; name="audio_file"; filename="segment.ogg"
Content-Type: audio/ogg

(binary audio data)
--boundary
Content-Disposition: form-data; name="user_id"

123456789012345678
--boundary
Content-Disposition: form-data; name="username"

Alice
--boundary
Content-Disposition: form-data; name="start_ts"

1733389200123
--boundary
Content-Disposition: form-data; name="end_ts"

1733389203954
--boundary--
```

#### リクエストパラメータ

| パラメータ | 型 | 必須 | 説明 |
|-----------|-----|------|------|
| `audio_file` | File | ✅ | 音声ファイル (OGG/WAV/MP3) |
| `user_id` | string | ✅ | Discord User ID |
| `username` | string | ✅ | Discord Username |
| `display_name` | string | ❌ | サーバー表示名 |
| `start_ts` | number | ✅ | 開始タイムスタンプ (Unix ms) |
| `end_ts` | number | ✅ | 終了タイムスタンプ (Unix ms) |
| `language` | string | ❌ | 言語ヒント (デフォルト: "ja") |

#### レスポンス (成功: 200)

```json
{
  "success": true,
  "data": {
    "user_id": "123456789012345678",
    "username": "Alice",
    "display_name": "アリス",
    "text": "こんにちは、今日はよろしくお願いします。",
    "start_ts": 1733389200123,
    "end_ts": 1733389203954,
    "duration_ms": 3831,
    "language": "ja",
    "confidence": 0.95,
    "processing_time_ms": 1250
  }
}
```

#### レスポンス (エラー: 4xx/5xx)

```json
{
  "success": false,
  "error": {
    "code": "AUDIO_TOO_SHORT",
    "message": "Audio duration is less than minimum required (500ms)",
    "details": {
      "duration_ms": 320,
      "min_duration_ms": 500
    }
  }
}
```

---

### 3.2 POST `/transcribe/batch`

**概要**: 複数の音声ファイルを一括処理

#### リクエスト

```http
POST /transcribe/batch HTTP/1.1
Content-Type: multipart/form-data

--boundary
Content-Disposition: form-data; name="files"; filename="segment1.ogg"
(binary)
--boundary
Content-Disposition: form-data; name="files"; filename="segment2.ogg"
(binary)
--boundary
Content-Disposition: form-data; name="metadata"

[
  {"user_id": "123", "username": "Alice", "start_ts": 1000, "end_ts": 2000},
  {"user_id": "456", "username": "Bob", "start_ts": 1500, "end_ts": 2500}
]
--boundary--
```

#### レスポンス

```json
{
  "success": true,
  "data": {
    "results": [
      {
        "index": 0,
        "success": true,
        "text": "こんにちは",
        "user_id": "123",
        ...
      },
      {
        "index": 1,
        "success": true,
        "text": "はい、よろしく",
        "user_id": "456",
        ...
      }
    ],
    "total_processing_time_ms": 2100
  }
}
```

---

### 3.3 GET `/health`

**概要**: ヘルスチェック

#### レスポンス

```json
{
  "status": "healthy",
  "model_loaded": true,
  "model_name": "large-v3",
  "device": "cuda",
  "compute_type": "float16",
  "uptime_seconds": 3600,
  "requests_processed": 150,
  "avg_processing_time_ms": 1100
}
```

---

### 3.4 GET `/status`

**概要**: 詳細ステータス

#### レスポンス

```json
{
  "server": {
    "version": "1.0.0",
    "uptime": "1:00:00",
    "python_version": "3.10.12"
  },
  "model": {
    "name": "large-v3",
    "loaded": true,
    "device": "cuda",
    "compute_type": "float16",
    "vram_used_mb": 3200
  },
  "stats": {
    "total_requests": 150,
    "successful_requests": 148,
    "failed_requests": 2,
    "avg_processing_time_ms": 1100,
    "total_audio_processed_seconds": 450
  },
  "queue": {
    "pending": 0,
    "processing": 1,
    "max_concurrent": 4
  }
}
```

---

## 4. Pydantic スキーマ

```python
# api/schemas.py
from pydantic import BaseModel, Field
from typing import Optional, List

class TranscribeRequest(BaseModel):
    user_id: str = Field(..., description="Discord User ID")
    username: str = Field(..., description="Discord Username")
    display_name: Optional[str] = Field(None, description="Server display name")
    start_ts: int = Field(..., description="Start timestamp (Unix ms)")
    end_ts: int = Field(..., description="End timestamp (Unix ms)")
    language: str = Field("ja", description="Language hint")

class TranscriptionResult(BaseModel):
    user_id: str
    username: str
    display_name: Optional[str]
    text: str
    start_ts: int
    end_ts: int
    duration_ms: int
    language: str
    confidence: float
    processing_time_ms: int

class TranscribeResponse(BaseModel):
    success: bool
    data: Optional[TranscriptionResult] = None
    error: Optional[dict] = None

class HealthResponse(BaseModel):
    status: str
    model_loaded: bool
    model_name: str
    device: str
    compute_type: str
    uptime_seconds: int
    requests_processed: int
    avg_processing_time_ms: float

class BatchMetadata(BaseModel):
    user_id: str
    username: str
    display_name: Optional[str] = None
    start_ts: int
    end_ts: int
    language: str = "ja"
```

---

## 5. Whisper サービス実装

```python
# services/whisper.py
from faster_whisper import WhisperModel
from typing import Optional, Tuple
import time
import os

class WhisperService:
    def __init__(self, config: 'WhisperConfig'):
        self.config = config
        self.model: Optional[WhisperModel] = None
        self.load_time: Optional[float] = None
        self.stats = TranscriptionStats()
    
    def load_model(self) -> None:
        """モデルをロード（起動時に1回のみ）"""
        start = time.time()
        
        self.model = WhisperModel(
            model_size_or_path=self.config.model_name,
            device=self.config.device,
            compute_type=self.config.compute_type,
            download_root=self.config.model_cache_dir,
            local_files_only=self.config.local_files_only,
        )
        
        self.load_time = time.time() - start
        print(f"Model loaded in {self.load_time:.2f}s")
    
    def transcribe(
        self,
        audio_path: str,
        language: str = "ja",
    ) -> Tuple[str, float]:
        """
        音声ファイルを文字起こし
        
        Returns:
            Tuple[str, float]: (文字起こしテキスト, 信頼度)
        """
        if self.model is None:
            raise RuntimeError("Model not loaded")
        
        start = time.time()
        
        segments, info = self.model.transcribe(
            audio_path,
            language=language,
            task="transcribe",
            beam_size=self.config.beam_size,
            best_of=self.config.best_of,
            temperature=self.config.temperature,
            vad_filter=self.config.vad_filter,
            vad_parameters=self.config.vad_parameters,
        )
        
        # セグメントを結合
        text_parts = []
        total_confidence = 0.0
        segment_count = 0
        
        for segment in segments:
            text_parts.append(segment.text.strip())
            total_confidence += segment.avg_logprob
            segment_count += 1
        
        text = " ".join(text_parts).strip()
        
        # 平均信頼度を計算（log probから変換）
        avg_confidence = 0.0
        if segment_count > 0:
            avg_logprob = total_confidence / segment_count
            # logprobを0-1の信頼度に変換
            avg_confidence = min(1.0, max(0.0, 1.0 + avg_logprob / 3))
        
        processing_time = time.time() - start
        self.stats.record(processing_time, len(text) > 0)
        
        return text, avg_confidence
    
    def is_ready(self) -> bool:
        return self.model is not None


class TranscriptionStats:
    def __init__(self):
        self.total_requests = 0
        self.successful_requests = 0
        self.total_processing_time = 0.0
    
    def record(self, processing_time: float, success: bool):
        self.total_requests += 1
        self.total_processing_time += processing_time
        if success:
            self.successful_requests += 1
    
    @property
    def avg_processing_time(self) -> float:
        if self.total_requests == 0:
            return 0.0
        return self.total_processing_time / self.total_requests
```

---

## 6. 設定管理

```python
# core/config.py
from pydantic_settings import BaseSettings
from typing import Optional, Dict, Any

class WhisperConfig(BaseSettings):
    # モデル設定
    model_name: str = "large-v3"
    device: str = "auto"  # "auto", "cuda", "cpu"
    compute_type: str = "auto"  # "auto", "float16", "int8", "float32"
    model_cache_dir: str = "./models"
    local_files_only: bool = False
    
    # 推論パラメータ
    beam_size: int = 5
    best_of: int = 5
    temperature: float = 0.0
    
    # VAD (Voice Activity Detection)
    vad_filter: bool = True
    vad_parameters: Dict[str, Any] = {
        "threshold": 0.5,
        "min_speech_duration_ms": 250,
        "min_silence_duration_ms": 100,
        "speech_pad_ms": 30,
    }
    
    class Config:
        env_prefix = "WHISPER_"


class ServerConfig(BaseSettings):
    # サーバー設定
    host: str = "0.0.0.0"
    port: int = 8000
    workers: int = 1  # Whisperは単一プロセス推奨
    
    # 制限
    max_file_size_mb: int = 25
    max_audio_duration_seconds: int = 300  # 5分
    min_audio_duration_ms: int = 500
    request_timeout_seconds: int = 120
    
    # 一時ファイル
    temp_dir: str = "./temp"
    cleanup_interval_seconds: int = 300
    
    class Config:
        env_prefix = "SERVER_"


class Config(BaseSettings):
    whisper: WhisperConfig = WhisperConfig()
    server: ServerConfig = ServerConfig()
    
    # ログ
    log_level: str = "INFO"
    log_format: str = "json"  # "json" or "text"
    
    class Config:
        env_file = ".env"
```

---

## 7. FastAPI アプリケーション

```python
# main.py
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
import tempfile
import os
import time

from core.config import Config
from services.whisper import WhisperService
from api.schemas import TranscribeResponse, TranscriptionResult, HealthResponse

config = Config()
whisper_service = WhisperService(config.whisper)

@asynccontextmanager
async def lifespan(app: FastAPI):
    # 起動時: モデルロード
    print("Loading Whisper model...")
    whisper_service.load_model()
    print("Model loaded successfully")
    
    yield
    
    # 終了時: クリーンアップ
    print("Shutting down...")

app = FastAPI(
    title="Whisper Transcription API",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.post("/transcribe", response_model=TranscribeResponse)
async def transcribe(
    audio_file: UploadFile = File(...),
    user_id: str = Form(...),
    username: str = Form(...),
    display_name: str = Form(None),
    start_ts: int = Form(...),
    end_ts: int = Form(...),
    language: str = Form("ja"),
):
    start_time = time.time()
    
    # ファイルサイズチェック
    content = await audio_file.read()
    file_size_mb = len(content) / (1024 * 1024)
    
    if file_size_mb > config.server.max_file_size_mb:
        raise HTTPException(400, f"File too large: {file_size_mb:.2f}MB")
    
    # 一時ファイルに保存
    suffix = os.path.splitext(audio_file.filename or ".ogg")[1]
    with tempfile.NamedTemporaryFile(
        delete=False,
        suffix=suffix,
        dir=config.server.temp_dir,
    ) as tmp:
        tmp.write(content)
        tmp_path = tmp.name
    
    try:
        # 文字起こし
        text, confidence = whisper_service.transcribe(tmp_path, language)
        
        processing_time_ms = int((time.time() - start_time) * 1000)
        
        return TranscribeResponse(
            success=True,
            data=TranscriptionResult(
                user_id=user_id,
                username=username,
                display_name=display_name,
                text=text,
                start_ts=start_ts,
                end_ts=end_ts,
                duration_ms=end_ts - start_ts,
                language=language,
                confidence=confidence,
                processing_time_ms=processing_time_ms,
            )
        )
    finally:
        # 一時ファイル削除
        os.unlink(tmp_path)


@app.get("/health", response_model=HealthResponse)
async def health():
    return HealthResponse(
        status="healthy" if whisper_service.is_ready() else "loading",
        model_loaded=whisper_service.is_ready(),
        model_name=config.whisper.model_name,
        device=config.whisper.device,
        compute_type=config.whisper.compute_type,
        uptime_seconds=int(time.time() - app.state.start_time) if hasattr(app.state, 'start_time') else 0,
        requests_processed=whisper_service.stats.total_requests,
        avg_processing_time_ms=whisper_service.stats.avg_processing_time * 1000,
    )
```

---

## 8. デバイス選択ロジック

```python
# services/device.py
import torch

def detect_device() -> str:
    """利用可能な最適なデバイスを検出"""
    if torch.cuda.is_available():
        return "cuda"
    elif hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
        return "mps"  # Apple Silicon
    else:
        return "cpu"

def detect_compute_type(device: str) -> str:
    """デバイスに適した計算精度を選択"""
    if device == "cuda":
        # CUDAの場合、GPUの能力に応じて選択
        capability = torch.cuda.get_device_capability()
        if capability[0] >= 7:  # Volta以降
            return "float16"
        else:
            return "int8"
    elif device == "mps":
        return "float16"
    else:
        return "int8"  # CPUはint8が効率的
```

---

## 9. エラーコード一覧

| コード | HTTP Status | 説明 |
|--------|-------------|------|
| `AUDIO_TOO_SHORT` | 400 | 音声が短すぎる（< 500ms） |
| `AUDIO_TOO_LONG` | 400 | 音声が長すぎる（> 5分） |
| `FILE_TOO_LARGE` | 400 | ファイルサイズ超過 |
| `INVALID_FORMAT` | 400 | 非対応の音声形式 |
| `MISSING_PARAMETER` | 400 | 必須パラメータ不足 |
| `MODEL_NOT_LOADED` | 503 | モデル未ロード |
| `TRANSCRIPTION_FAILED` | 500 | 文字起こし失敗 |
| `TIMEOUT` | 504 | 処理タイムアウト |

---

## 10. パフォーマンスガイド

### 10.1 モデル別性能比較

| モデル | VRAM | CPU処理時間 (1分音声) | GPU処理時間 | 精度 |
|--------|------|---------------------|-------------|------|
| tiny | 1GB | 5秒 | 1秒 | ★★☆☆☆ |
| base | 1GB | 10秒 | 2秒 | ★★★☆☆ |
| small | 2GB | 20秒 | 3秒 | ★★★★☆ |
| medium | 5GB | 40秒 | 5秒 | ★★★★☆ |
| large-v3 | 10GB | 60秒 | 8秒 | ★★★★★ |

### 10.2 CPU最適化

```python
# CPU使用時の最適設定
config = WhisperConfig(
    device="cpu",
    compute_type="int8",  # int8量子化で高速化
    beam_size=1,          # ビームサーチ無効化
    best_of=1,            # 候補を1つに
)
```

### 10.3 GPU最適化

```python
# GPU使用時の最適設定
config = WhisperConfig(
    device="cuda",
    compute_type="float16",
    beam_size=5,
    best_of=5,
)
```

---

## 11. 依存パッケージ

```
# requirements.txt
fastapi==0.109.0
uvicorn[standard]==0.25.0
python-multipart==0.0.6
pydantic==2.5.3
pydantic-settings==2.1.0

# Whisper
faster-whisper==1.0.0
torch>=2.0.0
torchaudio>=2.0.0

# ユーティリティ
python-dotenv==1.0.0
```

### GPU版インストール

```bash
# CUDA 11.x
pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu118

# CUDA 12.x
pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu121
```

---

## 12. Docker 構成

```dockerfile
# Dockerfile
FROM python:3.10-slim

WORKDIR /app

# FFmpeg インストール
RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*

# 依存関係インストール
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# アプリケーションコピー
COPY src/ ./src/

# モデルキャッシュディレクトリ
RUN mkdir -p /app/models /app/temp

ENV WHISPER_MODEL_CACHE_DIR=/app/models
ENV SERVER_TEMP_DIR=/app/temp

EXPOSE 8000

CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

```yaml
# docker-compose.yml
version: '3.8'

services:
  whisper-api:
    build: .
    ports:
      - "8000:8000"
    volumes:
      - ./models:/app/models
      - ./temp:/app/temp
    environment:
      - WHISPER_MODEL_NAME=large-v3
      - WHISPER_DEVICE=cpu
      - WHISPER_COMPUTE_TYPE=int8
    deploy:
      resources:
        limits:
          memory: 8G
```

---

## 13. 次のドキュメント

- [04-output-logging.md](./04-output-logging.md) - 出力仕様
- [05-integration.md](./05-integration.md) - Bot⇔API連携

