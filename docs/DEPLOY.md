# 🚀 デプロイガイド

このガイドでは、Discord文字起こしBotを無料サーバーにデプロイする手順を説明します。

---

## 📋 前提条件

- GitHub アカウント
- Discord Bot Token（[Discord Developer Portal](https://discord.com/developers/applications)で取得）
- Groq API Key（[console.groq.com](https://console.groq.com)で取得）

---

## 🎯 推奨構成

```
┌─────────────────────────────────────────────────────────┐
│  Railway / Render / Fly.io（無料枠）                     │
│                                                         │
│  ┌─────────────────┐     ┌─────────────────────────┐   │
│  │  Discord Bot    │ ──► │  Whisper API Server     │   │
│  │  ~150MB RAM     │     │  ~50MB RAM (Groqモード) │   │
│  └─────────────────┘     └───────────┬─────────────┘   │
│                                      │                  │
└──────────────────────────────────────┼──────────────────┘
                                       │
                                       ▼
                            ┌─────────────────────┐
                            │  Groq API (クラウド) │
                            │  $0.0001/秒         │
                            └─────────────────────┘
```

---

## 🚂 Railway へのデプロイ（推奨）

Railway は $5/月の無料クレジットがあり、簡単にデプロイできます。

### Step 1: GitHubにリポジトリをプッシュ

```bash
# リポジトリ初期化（まだの場合）
git init
git add .
git commit -m "Initial commit"

# GitHubにプッシュ
git remote add origin https://github.com/YOUR_USERNAME/whisper-discord.git
git push -u origin main
```

### Step 2: Railway アカウント作成

1. [railway.app](https://railway.app) にアクセス
2. GitHub アカウントでサインアップ

### Step 3: Whisper API サービスをデプロイ

1. Railway Dashboard で「New Project」→「Deploy from GitHub repo」
2. リポジトリを選択
3. 「Add Service」→「GitHub Repo」→ 同じリポジトリを選択
4. Settings で以下を設定:
   - **Root Directory**: `whisper-api`
   - **Builder**: Dockerfile

5. Variables タブで環境変数を設定:

```env
WHISPER_PROVIDER=groq
WHISPER_GROQ_API_KEY=gsk_xxxxxxxxxxxxx
WHISPER_GROQ_MODEL=whisper-large-v3
SERVER_HOST=0.0.0.0
SERVER_PORT=8000
LOG_LEVEL=INFO
```

6. 「Deploy」をクリック

### Step 4: Discord Bot サービスをデプロイ

1. 同じプロジェクト内で「Add Service」→「GitHub Repo」
2. Settings で以下を設定:
   - **Root Directory**: `bot`
   - **Builder**: Dockerfile

3. まず Bot をビルド:
```bash
cd bot
npm install
npm run build
git add dist/
git commit -m "Add build files"
git push
```

4. Variables タブで環境変数を設定:

```env
DISCORD_BOT_TOKEN=your_discord_bot_token
DISCORD_CLIENT_ID=your_discord_client_id
WHISPER_API_URL=http://whisper-api.railway.internal:8000
WHISPER_API_TIMEOUT=60000
AUDIO_SILENCE_THRESHOLD=800
AUDIO_MAX_SEGMENT_DURATION=8000
AUDIO_MIN_SEGMENT_DURATION=1000
AUDIO_MIN_RMS_THRESHOLD=0.005
OUTPUT_ENABLE_DISCORD_POST=true
OUTPUT_ENABLE_FILE_LOG=true
LOG_LEVEL=info
```

> **Note**: `WHISPER_API_URL` は Railway の内部ネットワークを使用します。
> サービス名が `whisper-api` の場合、`http://whisper-api.railway.internal:8000` になります。

5. 「Deploy」をクリック

### Step 5: 接続確認

1. Railway の Logs タブでログを確認
2. Discord で `/join` コマンドをテスト

---

## 🎨 Render へのデプロイ

Render は 750時間/月の無料枠があります。

### Step 1: render.yaml を作成

```yaml
# render.yaml
services:
  - type: web
    name: whisper-api
    runtime: docker
    dockerfilePath: ./whisper-api/Dockerfile
    dockerContext: ./whisper-api
    envVars:
      - key: WHISPER_PROVIDER
        value: groq
      - key: WHISPER_GROQ_API_KEY
        sync: false
      - key: WHISPER_GROQ_MODEL
        value: whisper-large-v3

  - type: worker
    name: discord-bot
    runtime: docker
    dockerfilePath: ./bot/Dockerfile
    dockerContext: ./bot
    envVars:
      - key: DISCORD_BOT_TOKEN
        sync: false
      - key: DISCORD_CLIENT_ID
        sync: false
      - key: WHISPER_API_URL
        fromService:
          name: whisper-api
          type: web
          property: host
```

### Step 2: Render にデプロイ

1. [render.com](https://render.com) でアカウント作成
2. 「New」→「Blueprint」→ リポジトリを選択
3. 環境変数を設定して Deploy

---

## 🪁 Fly.io へのデプロイ

Fly.io は 3 VM まで無料です。

### Step 1: Fly CLI インストール

```bash
# Windows (PowerShell)
powershell -Command "iwr https://fly.io/install.ps1 -useb | iex"

# Mac/Linux
curl -L https://fly.io/install.sh | sh
```

### Step 2: ログイン

```bash
fly auth login
```

### Step 3: Whisper API をデプロイ

```bash
cd whisper-api

# アプリ作成
fly launch --name whisper-api-yourname --no-deploy

# 環境変数設定
fly secrets set WHISPER_PROVIDER=groq
fly secrets set WHISPER_GROQ_API_KEY=gsk_xxxxx

# デプロイ
fly deploy
```

### Step 4: Discord Bot をデプロイ

```bash
cd ../bot

# ビルド
npm install
npm run build

# アプリ作成
fly launch --name discord-bot-yourname --no-deploy

# 環境変数設定
fly secrets set DISCORD_BOT_TOKEN=xxx
fly secrets set DISCORD_CLIENT_ID=xxx
fly secrets set WHISPER_API_URL=https://whisper-api-yourname.fly.dev

# デプロイ
fly deploy
```

---

## 🔧 トラブルシューティング

### Bot が起動しない

1. ログを確認:
```bash
# Railway
railway logs

# Fly.io
fly logs
```

2. 環境変数が正しく設定されているか確認

### Whisper API に接続できない

1. 内部ネットワーク URL が正しいか確認
2. ヘルスチェックエンドポイント (`/health`) にアクセス可能か確認

### メモリ不足

Groq モードなら 256MB で十分ですが、エラーが出る場合:
- Railway: 「Settings」→「Resource Limits」でメモリを増やす
- Fly.io: `fly scale memory 512`

---

## 💰 コスト試算

| 項目 | コスト |
|------|--------|
| Railway（$5クレジット内） | **$0** |
| Groq API（100時間/月） | **$36** |
| **合計** | **$36/月** |

---

## 📝 デプロイ後のチェックリスト

- [ ] Bot が Discord に接続している
- [ ] `/join` コマンドが動作する
- [ ] 音声が文字起こしされる
- [ ] ログが正常に出力されている

---

## 🔗 関連リンク

- [Railway Documentation](https://docs.railway.app)
- [Render Documentation](https://render.com/docs)
- [Fly.io Documentation](https://fly.io/docs)
- [Groq API Console](https://console.groq.com)

