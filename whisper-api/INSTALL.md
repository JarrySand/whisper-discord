# Whisper API インストール手順

## Windows での手順

```powershell
# 1. whisper-api ディレクトリに移動
cd C:\Users\zukas\whisper-discord\whisper-api

# 2. 仮想環境作成（初回のみ）
python -m venv venv

# 3. 仮想環境を有効化
.\venv\Scripts\Activate.ps1

# 4. pip を最新版に更新
python -m pip install --upgrade pip

# 5. 基本パッケージをインストール
pip install -r requirements.txt

# 6. PyTorch をインストール（CPU版）
pip install torch torchaudio --index-url https://download.pytorch.org/whl/cpu

# または GPU版（CUDA 11.8）
# pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu118

# または GPU版（CUDA 12.1）
# pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu121

# 7. faster-whisper をインストール
pip install faster-whisper==1.0.0

# 8. 開発用パッケージ（テスト用）
pip install pytest pytest-cov pytest-asyncio httpx

# 9. .env ファイル作成
Copy-Item env.example .env

# 10. サーバー起動
uvicorn src.main:app --reload --port 8000
```

## トラブルシューティング

### Rust/Cargo エラーが出る場合

ターミナルを**完全に閉じて**新しいターミナルを開いてください。
Rust のインストール後、PATH の更新にはターミナルの再起動が必要です。

### GPU が認識されない場合

```powershell
python -c "import torch; print(torch.cuda.is_available())"
```

False が表示される場合は、NVIDIA ドライバと CUDA のバージョンを確認してください。

