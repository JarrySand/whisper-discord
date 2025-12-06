# 📘 環境変数・設定 詳細仕様書

> **関連**: [spec.md](../spec.md) - 全体概要

---

## 1. 概要

システム全体の設定管理、環境変数、ディレクトリ構造の詳細仕様。

---

## 2. プロジェクト構造

### 2.1 全体構造

```
whisper-discord/
├── bot/                      # Discord Bot (TypeScript)
│   ├── src/
│   │   ├── index.ts
│   │   ├── bot.ts
│   │   ├── commands/
│   │   ├── voice/
│   │   ├── audio/
│   │   ├── api/
│   │   ├── output/
│   │   ├── config/
│   │   ├── utils/
│   │   └── types/
│   ├── package.json
│   ├── tsconfig.json
│   ├── .env
│   └── .env.example
│
├── whisper-api/              # Whisper API (Python)
│   ├── src/
│   │   ├── __init__.py
│   │   ├── main.py
│   │   ├── api/
│   │   ├── core/
│   │   ├── services/
│   │   └── utils/
│   ├── models/               # Whisperモデルキャッシュ
│   ├── temp/                 # 一時ファイル
│   ├── requirements.txt
│   ├── Dockerfile
│   ├── docker-compose.yml
│   ├── .env
│   └── .env.example
│
├── logs/                     # ログ出力
│   └── YYYY-MM-DD/
│       ├── session-xxx.log
│       └── session-xxx.json
│
├── segments/                 # 音声セグメント（オプション）
│   └── YYYY-MM-DD/
│       └── userid_time_uuid.ogg
│
├── config/                   # 共有設定
│   └── .env.shared
│
├── docs/
│   ├── spec.md
│   └── details/
│       ├── 01-discord-bot.md
│       ├── 02-audio-processing.md
│       ├── 03-whisper-api.md
│       ├── 04-output-logging.md
│       ├── 05-integration.md
│       └── 06-config-env.md
│
├── scripts/                  # ユーティリティスクリプト
│   ├── setup.sh
│   ├── start-all.sh
│   └── download-model.py
│
├── .gitignore
├── README.md
└── docker-compose.yml        # 全体オーケストレーション
```

---

## 3. 環境変数

### 3.1 Discord Bot (.env)

```bash
# ===== Discord Bot Configuration =====
# Location: bot/.env

# ----- Discord Credentials -----
# Required: Bot token from Discord Developer Portal
DISCORD_BOT_TOKEN=your_bot_token_here

# Required: Application ID from Discord Developer Portal
DISCORD_CLIENT_ID=your_client_id_here

# Optional: Guild ID for development (faster command sync)
DISCORD_GUILD_ID=

# ----- Whisper API -----
# Whisper API server URL
WHISPER_API_URL=http://localhost:8000

# Request timeout (ms)
WHISPER_TIMEOUT=60000

# Retry configuration
WHISPER_RETRY_COUNT=3
WHISPER_RETRY_DELAY=1000

# ----- Audio Processing -----
# Sample rate for processing (Hz)
AUDIO_SAMPLE_RATE=16000

# Silence detection threshold (amplitude)
AUDIO_SILENCE_THRESHOLD=500

# Silence duration to trigger segmentation (ms)
AUDIO_SILENCE_DURATION=600

# Maximum segment duration (ms)
AUDIO_MAX_SEGMENT_DURATION=10000

# Minimum segment duration (ms)
AUDIO_MIN_SEGMENT_DURATION=500

# ----- Output -----
# Enable Discord channel output
OUTPUT_DISCORD_ENABLED=true

# Discord message format: standard, compact, embed
OUTPUT_DISCORD_FORMAT=standard

# Enable file logging
OUTPUT_FILE_ENABLED=true

# Enable JSON storage
OUTPUT_JSON_ENABLED=true

# Enable Markdown output
OUTPUT_MARKDOWN_ENABLED=true

# Log directory
OUTPUT_LOG_DIR=./logs

# Segment save directory (optional)
OUTPUT_SEGMENT_DIR=./segments

# Save audio segments to disk
OUTPUT_SAVE_SEGMENTS=false

# ----- Queue -----
# Maximum queue size
QUEUE_MAX_SIZE=100

# Maximum retries per segment
QUEUE_MAX_RETRIES=3

# Concurrent processing
QUEUE_CONCURRENCY=2

# Processing timeout (ms)
QUEUE_PROCESSING_TIMEOUT=120000

# ----- Logging -----
# Log level: debug, info, warn, error
LOG_LEVEL=info

# Log format: json, text
LOG_FORMAT=text

# ----- Development -----
# Node environment
NODE_ENV=development
```

### 3.2 Whisper API (.env)

```bash
# ===== Whisper API Configuration =====
# Location: whisper-api/.env

# ----- Server -----
# Server host
SERVER_HOST=0.0.0.0

# Server port
SERVER_PORT=8000

# Number of workers (1 recommended for Whisper)
SERVER_WORKERS=1

# Request timeout (seconds)
SERVER_REQUEST_TIMEOUT=120

# ----- Whisper Model -----
# Model name: tiny, base, small, medium, large-v2, large-v3
WHISPER_MODEL_NAME=large-v3

# Device: auto, cuda, cpu
WHISPER_DEVICE=auto

# Compute type: auto, float16, int8, float32
WHISPER_COMPUTE_TYPE=auto

# Model cache directory
WHISPER_MODEL_CACHE_DIR=./models

# Use local files only (no download)
WHISPER_LOCAL_FILES_ONLY=false

# ----- Inference Parameters -----
# Beam size for decoding
WHISPER_BEAM_SIZE=5

# Number of candidates
WHISPER_BEST_OF=5

# Temperature for sampling
WHISPER_TEMPERATURE=0.0

# Enable Voice Activity Detection filter
WHISPER_VAD_FILTER=true

# Default language
WHISPER_DEFAULT_LANGUAGE=ja

# ----- Limits -----
# Maximum file size (MB)
SERVER_MAX_FILE_SIZE_MB=25

# Maximum audio duration (seconds)
SERVER_MAX_AUDIO_DURATION=300

# Minimum audio duration (ms)
SERVER_MIN_AUDIO_DURATION_MS=500

# ----- Temp Files -----
# Temporary file directory
SERVER_TEMP_DIR=./temp

# Cleanup interval (seconds)
SERVER_CLEANUP_INTERVAL=300

# ----- Logging -----
# Log level: DEBUG, INFO, WARNING, ERROR
LOG_LEVEL=INFO

# Log format: json, text
LOG_FORMAT=json
```

---

## 4. 設定クラス

### 4.1 Bot 設定 (TypeScript)

```typescript
// bot/src/config/index.ts
import { config as dotenv } from 'dotenv';
import { z } from 'zod';

dotenv();

const envSchema = z.object({
  // Discord
  DISCORD_BOT_TOKEN: z.string().min(1),
  DISCORD_CLIENT_ID: z.string().min(1),
  DISCORD_GUILD_ID: z.string().optional(),
  
  // Whisper API
  WHISPER_API_URL: z.string().url().default('http://localhost:8000'),
  WHISPER_TIMEOUT: z.coerce.number().default(60000),
  WHISPER_RETRY_COUNT: z.coerce.number().default(3),
  WHISPER_RETRY_DELAY: z.coerce.number().default(1000),
  
  // Audio
  AUDIO_SAMPLE_RATE: z.coerce.number().default(16000),
  AUDIO_SILENCE_THRESHOLD: z.coerce.number().default(500),
  AUDIO_SILENCE_DURATION: z.coerce.number().default(600),
  AUDIO_MAX_SEGMENT_DURATION: z.coerce.number().default(10000),
  AUDIO_MIN_SEGMENT_DURATION: z.coerce.number().default(500),
  
  // Output
  OUTPUT_DISCORD_ENABLED: z.coerce.boolean().default(true),
  OUTPUT_DISCORD_FORMAT: z.enum(['standard', 'compact', 'embed']).default('standard'),
  OUTPUT_FILE_ENABLED: z.coerce.boolean().default(true),
  OUTPUT_JSON_ENABLED: z.coerce.boolean().default(true),
  OUTPUT_MARKDOWN_ENABLED: z.coerce.boolean().default(true),
  OUTPUT_LOG_DIR: z.string().default('./logs'),
  OUTPUT_SEGMENT_DIR: z.string().default('./segments'),
  OUTPUT_SAVE_SEGMENTS: z.coerce.boolean().default(false),
  
  // Queue
  QUEUE_MAX_SIZE: z.coerce.number().default(100),
  QUEUE_MAX_RETRIES: z.coerce.number().default(3),
  QUEUE_CONCURRENCY: z.coerce.number().default(2),
  QUEUE_PROCESSING_TIMEOUT: z.coerce.number().default(120000),
  
  // Logging
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  LOG_FORMAT: z.enum(['json', 'text']).default('text'),
  
  // Environment
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
});

const env = envSchema.parse(process.env);

export const config = {
  discord: {
    token: env.DISCORD_BOT_TOKEN,
    clientId: env.DISCORD_CLIENT_ID,
    guildId: env.DISCORD_GUILD_ID,
  },
  
  whisper: {
    apiUrl: env.WHISPER_API_URL,
    timeout: env.WHISPER_TIMEOUT,
    retryCount: env.WHISPER_RETRY_COUNT,
    retryDelay: env.WHISPER_RETRY_DELAY,
  },
  
  audio: {
    sampleRate: env.AUDIO_SAMPLE_RATE,
    silenceThreshold: env.AUDIO_SILENCE_THRESHOLD,
    silenceDuration: env.AUDIO_SILENCE_DURATION,
    maxSegmentDuration: env.AUDIO_MAX_SEGMENT_DURATION,
    minSegmentDuration: env.AUDIO_MIN_SEGMENT_DURATION,
  },
  
  output: {
    discord: {
      enabled: env.OUTPUT_DISCORD_ENABLED,
      format: env.OUTPUT_DISCORD_FORMAT,
    },
    file: {
      enabled: env.OUTPUT_FILE_ENABLED,
      logDir: env.OUTPUT_LOG_DIR,
    },
    json: {
      enabled: env.OUTPUT_JSON_ENABLED,
      logDir: env.OUTPUT_LOG_DIR,
    },
    markdown: {
      enabled: env.OUTPUT_MARKDOWN_ENABLED,
      logDir: env.OUTPUT_LOG_DIR,
      includeStats: true,
      includeTimestamps: true,
    },
    segments: {
      save: env.OUTPUT_SAVE_SEGMENTS,
      dir: env.OUTPUT_SEGMENT_DIR,
    },
  },
  
  queue: {
    maxSize: env.QUEUE_MAX_SIZE,
    maxRetries: env.QUEUE_MAX_RETRIES,
    concurrency: env.QUEUE_CONCURRENCY,
    processingTimeout: env.QUEUE_PROCESSING_TIMEOUT,
  },
  
  logging: {
    level: env.LOG_LEVEL,
    format: env.LOG_FORMAT,
  },
  
  isDevelopment: env.NODE_ENV === 'development',
  isProduction: env.NODE_ENV === 'production',
} as const;

export type Config = typeof config;
```

### 4.2 API 設定 (Python)

```python
# whisper-api/src/core/config.py
from pydantic_settings import BaseSettings
from typing import Literal, Optional
from functools import lru_cache

class ServerSettings(BaseSettings):
    host: str = "0.0.0.0"
    port: int = 8000
    workers: int = 1
    request_timeout: int = 120
    max_file_size_mb: int = 25
    max_audio_duration: int = 300
    min_audio_duration_ms: int = 500
    temp_dir: str = "./temp"
    cleanup_interval: int = 300
    
    class Config:
        env_prefix = "SERVER_"


class WhisperSettings(BaseSettings):
    model_name: str = "large-v3"
    device: Literal["auto", "cuda", "cpu"] = "auto"
    compute_type: Literal["auto", "float16", "int8", "float32"] = "auto"
    model_cache_dir: str = "./models"
    local_files_only: bool = False
    beam_size: int = 5
    best_of: int = 5
    temperature: float = 0.0
    vad_filter: bool = True
    default_language: str = "ja"
    
    class Config:
        env_prefix = "WHISPER_"


class LoggingSettings(BaseSettings):
    level: Literal["DEBUG", "INFO", "WARNING", "ERROR"] = "INFO"
    format: Literal["json", "text"] = "json"
    
    class Config:
        env_prefix = "LOG_"


class Settings(BaseSettings):
    server: ServerSettings = ServerSettings()
    whisper: WhisperSettings = WhisperSettings()
    logging: LoggingSettings = LoggingSettings()
    
    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


@lru_cache
def get_settings() -> Settings:
    return Settings()
```

---

## 5. Docker 構成

### 5.1 ルート docker-compose.yml

```yaml
# whisper-discord/docker-compose.yml
version: '3.8'

services:
  bot:
    build:
      context: ./bot
      dockerfile: Dockerfile
    container_name: discord-bot
    restart: unless-stopped
    env_file:
      - ./bot/.env
    environment:
      - WHISPER_API_URL=http://whisper-api:8000
    volumes:
      - ./logs:/app/logs
      - ./segments:/app/segments
    depends_on:
      whisper-api:
        condition: service_healthy
    networks:
      - whisper-network

  whisper-api:
    build:
      context: ./whisper-api
      dockerfile: Dockerfile
    container_name: whisper-api
    restart: unless-stopped
    env_file:
      - ./whisper-api/.env
    volumes:
      - ./whisper-api/models:/app/models
      - ./whisper-api/temp:/app/temp
    ports:
      - "8000:8000"
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 60s
    deploy:
      resources:
        limits:
          memory: 8G
        reservations:
          memory: 4G
    networks:
      - whisper-network

networks:
  whisper-network:
    driver: bridge
```

### 5.2 Bot Dockerfile

```dockerfile
# bot/Dockerfile
FROM node:20-slim

WORKDIR /app

# システム依存関係
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# 依存関係インストール
COPY package*.json ./
RUN npm ci --only=production

# ソースコード
COPY . .

# ビルド
RUN npm run build

# 実行
CMD ["node", "dist/index.js"]
```

### 5.3 Whisper API Dockerfile

```dockerfile
# whisper-api/Dockerfile
FROM python:3.10-slim

WORKDIR /app

# システム依存関係
RUN apt-get update && apt-get install -y \
    ffmpeg \
    curl \
    && rm -rf /var/lib/apt/lists/*

# 依存関係インストール
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# ソースコード
COPY src/ ./src/

# ディレクトリ作成
RUN mkdir -p /app/models /app/temp

# 非rootユーザー
RUN useradd -m appuser && chown -R appuser:appuser /app
USER appuser

EXPOSE 8000

CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

---

## 6. GPU サポート

### 6.1 GPU版 docker-compose

```yaml
# docker-compose.gpu.yml
version: '3.8'

services:
  whisper-api:
    build:
      context: ./whisper-api
      dockerfile: Dockerfile.gpu
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: 1
              capabilities: [gpu]
    environment:
      - WHISPER_DEVICE=cuda
      - WHISPER_COMPUTE_TYPE=float16
```

### 6.2 GPU版 Dockerfile

```dockerfile
# whisper-api/Dockerfile.gpu
FROM nvidia/cuda:11.8-cudnn8-runtime-ubuntu22.04

# Python インストール
RUN apt-get update && apt-get install -y \
    python3.10 \
    python3-pip \
    ffmpeg \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# PyTorch (CUDA)
RUN pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu118

# 依存関係
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY src/ ./src/

RUN mkdir -p /app/models /app/temp

EXPOSE 8000

CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

---

## 7. セットアップスクリプト

### 7.1 初期セットアップ

```bash
#!/bin/bash
# scripts/setup.sh

set -e

echo "🚀 Discord Whisper Bot Setup"
echo "============================"

# Node.js チェック
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed"
    exit 1
fi

# Python チェック
if ! command -v python3 &> /dev/null; then
    echo "❌ Python 3 is not installed"
    exit 1
fi

# FFmpeg チェック
if ! command -v ffmpeg &> /dev/null; then
    echo "⚠️ FFmpeg is not installed. Audio encoding may fail."
fi

# Bot セットアップ
echo ""
echo "📦 Setting up Discord Bot..."
cd bot
cp .env.example .env
npm install
npm run build
cd ..

# Whisper API セットアップ
echo ""
echo "🐍 Setting up Whisper API..."
cd whisper-api
cp .env.example .env
python3 -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt
cd ..

# ディレクトリ作成
echo ""
echo "📁 Creating directories..."
mkdir -p logs segments whisper-api/models whisper-api/temp

echo ""
echo "✅ Setup complete!"
echo ""
echo "Next steps:"
echo "1. Edit bot/.env with your Discord credentials"
echo "2. Edit whisper-api/.env with your preferences"
echo "3. Run: ./scripts/start-all.sh"
```

### 7.2 起動スクリプト

```bash
#!/bin/bash
# scripts/start-all.sh

set -e

# Whisper API 起動
echo "🚀 Starting Whisper API..."
cd whisper-api
source venv/bin/activate
uvicorn src.main:app --host 0.0.0.0 --port 8000 &
WHISPER_PID=$!
cd ..

# API 起動待機
echo "⏳ Waiting for Whisper API..."
sleep 10

# ヘルスチェック
if curl -s http://localhost:8000/health | grep -q "healthy"; then
    echo "✅ Whisper API is healthy"
else
    echo "❌ Whisper API health check failed"
    kill $WHISPER_PID 2>/dev/null
    exit 1
fi

# Bot 起動
echo "🤖 Starting Discord Bot..."
cd bot
npm start &
BOT_PID=$!
cd ..

echo ""
echo "✅ All services started!"
echo "   Whisper API PID: $WHISPER_PID"
echo "   Discord Bot PID: $BOT_PID"
echo ""
echo "Press Ctrl+C to stop all services"

# シグナルハンドラ
trap "kill $WHISPER_PID $BOT_PID 2>/dev/null; exit" SIGINT SIGTERM

# 待機
wait
```

---

## 8. .gitignore

```gitignore
# Dependencies
node_modules/
venv/
__pycache__/
*.py[cod]

# Build
dist/
build/
*.egg-info/

# Environment
.env
.env.local
*.local

# Logs
logs/
*.log

# Segments
segments/

# Models
whisper-api/models/
*.bin
*.pt

# Temp
temp/
*.tmp

# IDE
.idea/
.vscode/
*.swp
*.swo

# OS
.DS_Store
Thumbs.db

# Docker
.docker/

# Test
coverage/
.pytest_cache/
```

---

## 9. 次のステップ

このドキュメントシリーズで spec 駆動開発の準備が整いました：

1. **01-discord-bot.md** - Bot 実装の詳細仕様
2. **02-audio-processing.md** - 音声処理の実装詳細
3. **03-whisper-api.md** - API サーバーの実装詳細
4. **04-output-logging.md** - 出力機能の実装詳細
5. **05-integration.md** - 連携機能の実装詳細
6. **06-config-env.md** - 設定・環境の詳細（本ドキュメント）

実装開始時は、Phase 1 (Discord Bot 基盤) から順に進めることを推奨します。

