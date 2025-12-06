# 🎙️ Phase 2: Whisper API サーバー

> **目標**: 音声ファイルを受け取り、Whisper で文字起こしを行う HTTP API サーバーを構築
>
> **期間目安**: 2-3日
>
> **仕様書**: [03-whisper-api.md](../docs/details/03-whisper-api.md)

---

## 📋 タスク一覧

### 2.1 プロジェクト初期化 (Day 1)

#### タスク

- [x] **T-2.1.1**: whisper-api ディレクトリ作成
- [x] **T-2.1.2**: requirements.txt 作成
- [x] **T-2.1.3**: 環境変数設定 (.env.example, .env)
- [x] **T-2.1.4**: ディレクトリ構造作成
- [x] **T-2.1.5**: ログ設定

#### 成果物

```
whisper-api/
├── src/
│   ├── __init__.py
│   ├── main.py
│   ├── api/
│   │   ├── __init__.py
│   │   ├── routes.py
│   │   └── schemas.py
│   ├── core/
│   │   ├── __init__.py
│   │   ├── config.py
│   │   └── logging.py
│   ├── services/
│   │   ├── __init__.py
│   │   ├── whisper.py
│   │   └── audio.py
│   └── utils/
│       └── __init__.py
├── models/               # Whisperモデルキャッシュ
├── temp/                 # 一時ファイル
├── requirements.txt
├── .env.example
└── .env
```

#### 依存関係

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

```
# requirements-dev.txt (テスト用)
pytest==7.4.3
pytest-cov==4.1.0
pytest-asyncio==0.21.1
httpx==0.25.2
```

---

### 2.2 FastAPI 基盤 (Day 1)

#### タスク

- [x] **T-2.2.1**: FastAPI アプリケーション作成
- [x] **T-2.2.2**: 設定管理 (pydantic-settings)
- [x] **T-2.2.3**: CORS 設定
- [x] **T-2.2.4**: Lifespan イベント（起動/終了）
- [x] **T-2.2.5**: ヘルスチェックエンドポイント

#### 実装ポイント

```python
# main.py
@asynccontextmanager
async def lifespan(app: FastAPI):
    # 起動時: モデルロード
    whisper_service.load_model()
    yield
    # 終了時: クリーンアップ

app = FastAPI(lifespan=lifespan)
```

#### 検証項目

- [x] `uvicorn src.main:app --reload` で起動
- [x] `GET /health` が `200 OK` を返す
- [x] Swagger UI (`/docs`) にアクセス可能

---

### 2.3 Pydantic スキーマ (Day 1)

#### タスク

- [x] **T-2.3.1**: TranscribeRequest スキーマ
- [x] **T-2.3.2**: TranscriptionResult スキーマ
- [x] **T-2.3.3**: TranscribeResponse スキーマ
- [x] **T-2.3.4**: HealthResponse スキーマ
- [x] **T-2.3.5**: エラーレスポンススキーマ

#### スキーマ例

```python
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
```

---

### 2.4 Whisper サービス (Day 2)

#### タスク

- [x] **T-2.4.1**: WhisperService クラス作成
- [x] **T-2.4.2**: モデルロード処理
- [x] **T-2.4.3**: transcribe メソッド実装
- [x] **T-2.4.4**: 信頼度スコア計算
- [x] **T-2.4.5**: 統計情報収集

#### 実装ポイント

```python
class WhisperService:
    def __init__(self, config: WhisperConfig):
        self.model = WhisperModel(
            model_size_or_path=config.model_name,
            device=config.device,
            compute_type=config.compute_type,
        )

    def transcribe(self, audio_path: str, language: str = "ja"):
        segments, info = self.model.transcribe(
            audio_path,
            language=language,
            beam_size=5,
            vad_filter=True,
        )
        # セグメント結合 → テキスト返却
```

#### Whisper 設定オプション

| 設定 | CPU推奨 | GPU推奨 |
|------|---------|---------|
| model_name | large-v3 | large-v3 |
| device | cpu | cuda |
| compute_type | int8 | float16 |
| beam_size | 1 | 5 |

---

### 2.5 文字起こしエンドポイント (Day 2-3)

#### タスク

- [x] **T-2.5.1**: POST `/transcribe` 実装
- [x] **T-2.5.2**: ファイルアップロード処理
- [x] **T-2.5.3**: 一時ファイル管理
- [x] **T-2.5.4**: 入力バリデーション
- [x] **T-2.5.5**: エラーハンドリング

#### エンドポイント仕様

```
POST /transcribe
Content-Type: multipart/form-data

Parameters:
  - audio_file: File (required)
  - user_id: string (required)
  - username: string (required)
  - display_name: string (optional)
  - start_ts: int (required)
  - end_ts: int (required)
  - language: string (default: "ja")

Response:
{
  "success": true,
  "data": {
    "text": "文字起こし結果",
    "confidence": 0.95,
    ...
  }
}
```

#### 検証項目

- [x] OGG ファイルのアップロード成功
- [x] WAV ファイルのアップロード成功
- [x] 日本語の文字起こしが正確
- [x] エラー時に適切なレスポンス

---

### 2.6 バッチ処理エンドポイント (Day 3, オプション)

#### タスク

- [x] **T-2.6.1**: POST `/transcribe/batch` 実装
- [x] **T-2.6.2**: 複数ファイル受信処理
- [x] **T-2.6.3**: メタデータ配列解析
- [x] **T-2.6.4**: 並列/直列処理選択

#### バッチ仕様

```
POST /transcribe/batch
Content-Type: multipart/form-data

Parameters:
  - files: File[] (required)
  - metadata: JSON string (required)
```

---

### 2.7 デバイス検出・最適化 (Day 3)

#### タスク

- [x] **T-2.7.1**: GPU 検出ロジック
- [x] **T-2.7.2**: 計算精度自動選択
- [x] **T-2.7.3**: CPU 最適化設定

#### デバイス検出

```python
def detect_device() -> str:
    if torch.cuda.is_available():
        return "cuda"
    elif hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
        return "mps"  # Apple Silicon
    else:
        return "cpu"
```

---

## 🧪 Phase 2 完了テスト

### 単体テスト

```python
# tests/test_whisper_service.py
def test_transcribe_japanese():
    service = WhisperService(config)
    text, confidence = service.transcribe("sample.ogg", "ja")
    assert len(text) > 0
    assert confidence > 0.5
```

### API テスト

```python
# tests/test_routes.py
def test_transcribe_endpoint(client, sample_audio):
    response = client.post(
        "/transcribe",
        files={"audio_file": sample_audio},
        data={"user_id": "123", "username": "test", ...}
    )
    assert response.status_code == 200
    assert response.json()["success"] is True
```

### 手動テスト

```bash
# ヘルスチェック
curl http://localhost:8000/health

# 文字起こし
curl -X POST http://localhost:8000/transcribe \
  -F "audio_file=@sample.ogg" \
  -F "user_id=123" \
  -F "username=test" \
  -F "start_ts=1733389200000" \
  -F "end_ts=1733389205000"
```

---

## 📁 成果物ディレクトリ構造

```
whisper-api/
├── src/
│   ├── __init__.py
│   ├── main.py               # FastAPI アプリ
│   ├── api/
│   │   ├── __init__.py
│   │   ├── routes.py         # エンドポイント
│   │   └── schemas.py        # Pydantic モデル
│   ├── core/
│   │   ├── __init__.py
│   │   ├── config.py         # 設定管理
│   │   └── logging.py        # ログ設定
│   ├── services/
│   │   ├── __init__.py
│   │   ├── whisper.py        # Whisper推論
│   │   └── audio.py          # 音声前処理
│   └── utils/
│       └── __init__.py
├── models/                   # モデルキャッシュ
├── temp/                     # 一時ファイル
├── tests/
│   ├── conftest.py
│   ├── test_routes.py
│   └── test_whisper_service.py
├── requirements.txt
├── .env.example
└── .env
```

---

## ⚠️ 注意事項

### モデルダウンロード

初回起動時に Whisper モデル（約3GB）がダウンロードされます。

```bash
# 事前ダウンロード（オプション）
python -c "from faster_whisper import WhisperModel; WhisperModel('large-v3')"
```

### メモリ要件

| モデル | VRAM/RAM |
|--------|----------|
| tiny | 1GB |
| base | 1GB |
| small | 2GB |
| medium | 5GB |
| large-v3 | 10GB |

### GPU セットアップ（オプション）

```bash
# CUDA 11.x
pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu118

# CUDA 12.x
pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu121
```

### パフォーマンス目安

| 環境 | 1分音声の処理時間 |
|------|------------------|
| CPU (int8) | 30-60秒 |
| GPU (float16) | 5-10秒 |

---

## 🐳 Docker 対応（オプション）

```dockerfile
# Dockerfile
FROM python:3.10-slim

WORKDIR /app
RUN apt-get update && apt-get install -y ffmpeg

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY src/ ./src/
RUN mkdir -p /app/models /app/temp

EXPOSE 8000
CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

---

**次のステップ**: [Phase 3 - 結合](./PHASE_3.md)

