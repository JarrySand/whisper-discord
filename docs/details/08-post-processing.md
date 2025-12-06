# 📘 後処理・拡張機能 詳細仕様書

> **関連**: [spec.md](../spec.md) - 全体概要 | [03-whisper-api.md](./03-whisper-api.md) - Whisper API
> 
> **フェーズ**: Phase 4 完了後のアドオン機能

---

## 1. 概要

Phase 4 までの基本実装完了後に追加可能な拡張機能群。
既存アーキテクチャを変更せず、追加モジュールとして実装する。

### 対象機能

| 機能 | 説明 | 優先度 |
|------|------|--------|
| 相槌フィルター | 「うん」「はい」等の相槌を除去 | 🔴 高 |
| hotwords | 専門用語・固有名詞の認識精度向上 | 🟡 中 |
| 検索機能 | SQLite保存 + `/search` コマンド | 🟡 中 |

---

## 2. 相槌フィルター

### 2.1 目的

VC会話では「うん」「はい」「なるほど」などの相槌が大量に発生する。
これらは議事録としてはノイズとなるため、文字起こし結果から除去する。

### 2.2 フィルタリング対象

```python
# 相槌パターン定義
AIZUCHI_PATTERNS = [
    # 基本的な相槌
    r"^うん[。．、]*$",
    r"^ん[ー〜]*[。．、]*$",
    r"^はい[。．、]*$",
    r"^ええ[。．、]*$",
    r"^へー[。．、]*$",
    
    # フィラー（言い淀み）
    r"^えー[っと]*[。．、]*$",
    r"^あー[。．、]*$",
    r"^まあ[。．、]*$",
    r"^えっと[。．、]*$",
    r"^あのー*[。．、]*$",
    
    # 同意・理解
    r"^そうですね[。．、]*$",
    r"^なるほど[。．、]*$",
    r"^確かに[。．、]*$",
    r"^そうそう[。．、]*$",
    r"^そっか[ー]*[。．、]*$",
    
    # 感嘆
    r"^おー[。．、]*$",
    r"^わー[。．、]*$",
    r"^すごい[。．、]*$",
]
```

### 2.3 フィルタリングルール

```python
def should_filter(text: str) -> bool:
    """
    フィルタリング対象かどうか判定
    
    条件:
    1. 文字数が短い（15文字以下）
    2. 相槌パターンにマッチする
    """
    t = text.strip()
    
    # 長い文章は相槌ではない
    if len(t) > 15:
        return False
    
    # パターンマッチ
    for pattern in AIZUCHI_PATTERNS:
        if re.match(pattern, t):
            return True
    
    return False
```

### 2.4 実装: Whisper API側

```python
# whisper-api/src/services/aizuchi_filter.py
import re
from typing import List, Tuple

class AizuchiFilter:
    """相槌フィルター"""
    
    DEFAULT_PATTERNS = [
        r"^うん[。．、]*$",
        r"^ん[ー〜]*[。．、]*$",
        r"^はい[。．、]*$",
        r"^ええ[。．、]*$",
        r"^へー[。．、]*$",
        r"^えー[っと]*[。．、]*$",
        r"^あー[。．、]*$",
        r"^まあ[。．、]*$",
        r"^えっと[。．、]*$",
        r"^あのー*[。．、]*$",
        r"^そうですね[。．、]*$",
        r"^なるほど[。．、]*$",
        r"^確かに[。．、]*$",
        r"^そうそう[。．、]*$",
        r"^そっか[ー]*[。．、]*$",
        r"^おー[。．、]*$",
        r"^わー[。．、]*$",
    ]
    
    def __init__(
        self,
        patterns: List[str] | None = None,
        max_length: int = 15,
        enabled: bool = True,
    ):
        self.patterns = patterns or self.DEFAULT_PATTERNS
        self.max_length = max_length
        self.enabled = enabled
        self._compiled = [re.compile(p) for p in self.patterns]
    
    def is_aizuchi(self, text: str) -> bool:
        """相槌かどうか判定"""
        if not self.enabled:
            return False
        
        t = text.strip()
        
        if len(t) > self.max_length:
            return False
        
        for pattern in self._compiled:
            if pattern.match(t):
                return True
        
        return False
    
    def filter_text(self, text: str) -> str | None:
        """
        相槌なら None を返し、そうでなければテキストをそのまま返す
        """
        if self.is_aizuchi(text):
            return None
        return text
    
    def filter_segments(
        self,
        segments: List[Tuple[float, float, str]],
    ) -> List[Tuple[float, float, str]]:
        """
        セグメントリストから相槌を除去
        
        Args:
            segments: [(start_time, end_time, text), ...]
        
        Returns:
            相槌を除去したセグメントリスト
        """
        return [
            (start, end, text)
            for start, end, text in segments
            if not self.is_aizuchi(text)
        ]
```

### 2.5 Whisper サービスへの統合

```python
# whisper-api/src/services/whisper.py への追加

from .aizuchi_filter import AizuchiFilter

class WhisperService:
    def __init__(self, config: 'WhisperConfig'):
        self.config = config
        self.model: Optional[WhisperModel] = None
        self.aizuchi_filter = AizuchiFilter(
            enabled=config.aizuchi_filter_enabled,
            patterns=config.aizuchi_patterns,
        )
    
    def transcribe(
        self,
        audio_path: str,
        language: str = "ja",
        filter_aizuchi: bool = True,  # ← 追加パラメータ
    ) -> Tuple[str, float]:
        # ... 既存の文字起こし処理 ...
        
        segments, info = self.model.transcribe(...)
        
        text_parts = []
        for segment in segments:
            text = segment.text.strip()
            
            # 相槌フィルタリング
            if filter_aizuchi and self.aizuchi_filter.is_aizuchi(text):
                continue  # スキップ
            
            text_parts.append(text)
        
        return " ".join(text_parts).strip(), avg_confidence
```

### 2.6 設定

```python
# core/config.py への追加

class WhisperConfig(BaseSettings):
    # ... 既存設定 ...
    
    # 相槌フィルター
    aizuchi_filter_enabled: bool = True
    aizuchi_max_length: int = 15
    aizuchi_patterns: List[str] | None = None  # None = デフォルトパターン使用
    
    class Config:
        env_prefix = "WHISPER_"
```

### 2.7 環境変数

```bash
# .env
WHISPER_AIZUCHI_FILTER_ENABLED=true
WHISPER_AIZUCHI_MAX_LENGTH=15
```

---

## 3. hotwords（専門用語対応）

### 3.1 目的

DAO、NFT、プロジェクト名などの専門用語・固有名詞は、
Whisperが誤認識しやすい。`initial_prompt` を使用して認識精度を向上させる。

### 3.2 仕組み

`faster-whisper` は `initial_prompt` パラメータをサポート。
ここに専門用語を含む文を渡すことで、モデルにコンテキストを与える。

```python
segments, info = model.transcribe(
    audio_path,
    language="ja",
    initial_prompt="DAO, NFT, KIBOTCHA, OpenSea, Ethereum, スマートコントラクト",
)
```

### 3.3 実装

```python
# whisper-api/src/services/hotwords.py
from typing import List
import os
import json

class HotwordsManager:
    """専門用語管理"""
    
    def __init__(self, config_path: str | None = None):
        self.hotwords: List[str] = []
        
        if config_path and os.path.exists(config_path):
            self.load_from_file(config_path)
    
    def load_from_file(self, path: str) -> None:
        """設定ファイルから読み込み"""
        with open(path, 'r', encoding='utf-8') as f:
            data = json.load(f)
            self.hotwords = data.get('hotwords', [])
    
    def load_from_env(self, env_var: str = "WHISPER_HOTWORDS") -> None:
        """環境変数から読み込み（カンマ区切り）"""
        value = os.getenv(env_var, "")
        if value:
            self.hotwords = [w.strip() for w in value.split(",")]
    
    def add(self, word: str) -> None:
        """用語を追加"""
        if word not in self.hotwords:
            self.hotwords.append(word)
    
    def remove(self, word: str) -> None:
        """用語を削除"""
        if word in self.hotwords:
            self.hotwords.remove(word)
    
    def get_prompt(self) -> str:
        """initial_prompt 用の文字列を生成"""
        if not self.hotwords:
            return ""
        
        # カンマ区切りの用語リストとして返す
        return ", ".join(self.hotwords)
    
    def get_prompt_with_context(self) -> str:
        """
        より効果的なプロンプト形式
        用語を自然な文に埋め込む
        """
        if not self.hotwords:
            return ""
        
        terms = ", ".join(self.hotwords[:20])  # 最初の20個まで
        return f"この会話では以下の用語が登場します: {terms}。"
```

### 3.4 設定ファイル形式

```json
// hotwords.json
{
  "hotwords": [
    "DAO",
    "NFT",
    "KIBOTCHA",
    "OpenSea",
    "Ethereum",
    "スマートコントラクト",
    "ガバナンストークン",
    "マルチシグ",
    "メタバース",
    "Web3"
  ],
  "description": "DAO関連の専門用語リスト"
}
```

### 3.5 Whisper サービスへの統合

```python
# whisper-api/src/services/whisper.py への追加

from .hotwords import HotwordsManager

class WhisperService:
    def __init__(self, config: 'WhisperConfig'):
        self.config = config
        self.model: Optional[WhisperModel] = None
        self.hotwords = HotwordsManager(config.hotwords_file)
        
        # 環境変数からも読み込み（マージ）
        self.hotwords.load_from_env()
    
    def transcribe(
        self,
        audio_path: str,
        language: str = "ja",
        additional_hotwords: List[str] | None = None,
    ) -> Tuple[str, float]:
        
        # initial_prompt を構築
        prompt = self.hotwords.get_prompt()
        if additional_hotwords:
            prompt += ", " + ", ".join(additional_hotwords)
        
        segments, info = self.model.transcribe(
            audio_path,
            language=language,
            initial_prompt=prompt if prompt else None,
            # ... その他のパラメータ ...
        )
        
        # ... 後続処理 ...
```

### 3.6 API パラメータ拡張

```python
# api/schemas.py への追加

class TranscribeRequest(BaseModel):
    # ... 既存フィールド ...
    
    # hotwords（リクエスト単位で追加可能）
    hotwords: List[str] | None = Field(
        None,
        description="追加の専門用語リスト（サーバー設定にマージ）"
    )
```

### 3.7 環境変数

```bash
# .env
WHISPER_HOTWORDS=DAO,NFT,KIBOTCHA,OpenSea
WHISPER_HOTWORDS_FILE=./config/hotwords.json
```

---

## 4. 検索機能

### 4.1 概要

文字起こし結果をSQLiteに保存し、Discord `/search` コマンドで検索可能にする。

### 4.2 アーキテクチャ

```
TranscriptionResult
       ↓
   OutputManager
       ↓
  ┌────┴────┬────────┬──────────┬──────────┐
  ↓         ↓        ↓          ↓          ↓
.log      JSON    Markdown   Discord    SQLite
                              投稿         ↓
                                      /search
```

### 4.3 データベーススキーマ

```sql
-- sessions テーブル（録音セッション）
CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    guild_id TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    channel_name TEXT,
    started_at DATETIME NOT NULL,
    ended_at DATETIME,
    participant_count INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- utterances テーブル（発話）
CREATE TABLE utterances (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    username TEXT NOT NULL,
    display_name TEXT,
    text TEXT NOT NULL,
    start_ts REAL NOT NULL,      -- セッション開始からの秒数
    end_ts REAL NOT NULL,
    confidence REAL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (session_id) REFERENCES sessions(id)
);

-- インデックス
CREATE INDEX idx_utterances_session ON utterances(session_id);
CREATE INDEX idx_utterances_user ON utterances(user_id);
CREATE INDEX idx_utterances_text ON utterances(text);  -- 全文検索用
```

### 4.4 SQLite ストレージ実装 (TypeScript)

```typescript
// bot/src/output/sqlite-store.ts
import Database from 'better-sqlite3';
import * as path from 'path';

interface SessionData {
  id: string;
  guildId: string;
  channelId: string;
  channelName?: string;
  startedAt: Date;
}

interface UtteranceData {
  sessionId: string;
  userId: string;
  username: string;
  displayName?: string;
  text: string;
  startTs: number;
  endTs: number;
  confidence?: number;
}

interface SearchOptions {
  keyword: string;
  userId?: string;
  sessionId?: string;
  limit?: number;
}

interface SearchResult {
  sessionId: string;
  userId: string;
  username: string;
  displayName: string | null;
  text: string;
  startTs: number;
  channelName: string | null;
  sessionStartedAt: string;
}

class SqliteStore {
  private db: Database.Database;

  constructor(dbPath: string = './data/transcripts.db') {
    // ディレクトリ作成
    const dir = path.dirname(dbPath);
    require('fs').mkdirSync(dir, { recursive: true });
    
    this.db = new Database(dbPath);
    this.initialize();
  }

  private initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        guild_id TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        channel_name TEXT,
        started_at DATETIME NOT NULL,
        ended_at DATETIME,
        participant_count INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS utterances (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        username TEXT NOT NULL,
        display_name TEXT,
        text TEXT NOT NULL,
        start_ts REAL NOT NULL,
        end_ts REAL NOT NULL,
        confidence REAL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (session_id) REFERENCES sessions(id)
      );

      CREATE INDEX IF NOT EXISTS idx_utterances_session ON utterances(session_id);
      CREATE INDEX IF NOT EXISTS idx_utterances_user ON utterances(user_id);
    `);
  }

  // セッション開始
  startSession(session: SessionData): void {
    const stmt = this.db.prepare(`
      INSERT INTO sessions (id, guild_id, channel_id, channel_name, started_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    
    stmt.run(
      session.id,
      session.guildId,
      session.channelId,
      session.channelName || null,
      session.startedAt.toISOString(),
    );
  }

  // セッション終了
  endSession(sessionId: string, participantCount: number): void {
    const stmt = this.db.prepare(`
      UPDATE sessions 
      SET ended_at = ?, participant_count = ?
      WHERE id = ?
    `);
    
    stmt.run(new Date().toISOString(), participantCount, sessionId);
  }

  // 発話を保存
  saveUtterance(utterance: UtteranceData): void {
    const stmt = this.db.prepare(`
      INSERT INTO utterances 
        (session_id, user_id, username, display_name, text, start_ts, end_ts, confidence)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    stmt.run(
      utterance.sessionId,
      utterance.userId,
      utterance.username,
      utterance.displayName || null,
      utterance.text,
      utterance.startTs,
      utterance.endTs,
      utterance.confidence || null,
    );
  }

  // 検索
  search(options: SearchOptions): SearchResult[] {
    let sql = `
      SELECT 
        u.session_id,
        u.user_id,
        u.username,
        u.display_name,
        u.text,
        u.start_ts,
        s.channel_name,
        s.started_at as session_started_at
      FROM utterances u
      JOIN sessions s ON u.session_id = s.id
      WHERE u.text LIKE ?
    `;
    
    const params: any[] = [`%${options.keyword}%`];
    
    if (options.userId) {
      sql += ` AND u.user_id = ?`;
      params.push(options.userId);
    }
    
    if (options.sessionId) {
      sql += ` AND u.session_id = ?`;
      params.push(options.sessionId);
    }
    
    sql += ` ORDER BY s.started_at DESC, u.start_ts ASC`;
    sql += ` LIMIT ?`;
    params.push(options.limit || 20);
    
    const stmt = this.db.prepare(sql);
    return stmt.all(...params) as SearchResult[];
  }

  // セッション一覧
  listSessions(guildId: string, limit: number = 10): any[] {
    const stmt = this.db.prepare(`
      SELECT 
        s.*,
        COUNT(u.id) as utterance_count
      FROM sessions s
      LEFT JOIN utterances u ON s.id = u.session_id
      WHERE s.guild_id = ?
      GROUP BY s.id
      ORDER BY s.started_at DESC
      LIMIT ?
    `);
    
    return stmt.all(guildId, limit);
  }

  close(): void {
    this.db.close();
  }
}

export { SqliteStore, SessionData, UtteranceData, SearchOptions, SearchResult };
```

### 4.5 OutputManager への統合

```typescript
// bot/src/output/index.ts への追加

import { SqliteStore } from './sqlite-store';

class OutputManager {
  private sqliteStore?: SqliteStore;
  private currentSessionId?: string;

  constructor(config: OutputConfig) {
    // ... 既存の初期化 ...
    
    // SQLite有効時のみ初期化
    if (config.enableSqlite) {
      this.sqliteStore = new SqliteStore(config.sqliteDbPath);
    }
  }

  async startSession(context: SessionContext): Promise<void> {
    // ... 既存処理 ...
    
    // SQLite: セッション開始
    if (this.sqliteStore) {
      this.sqliteStore.startSession({
        id: context.sessionId,
        guildId: context.guildId,
        channelId: context.channelId,
        channelName: context.channelName,
        startedAt: new Date(),
      });
      this.currentSessionId = context.sessionId;
    }
  }

  async output(result: TranscriptionResult): Promise<void> {
    // ... 既存の出力処理 ...
    
    // SQLite: 発話保存
    if (this.sqliteStore && this.currentSessionId) {
      this.sqliteStore.saveUtterance({
        sessionId: this.currentSessionId,
        userId: result.user_id,
        username: result.username,
        displayName: result.display_name || undefined,
        text: result.text,
        startTs: result.start_ts,
        endTs: result.end_ts,
        confidence: result.confidence,
      });
    }
  }

  async endSession(): Promise<void> {
    // ... 既存処理 ...
    
    // SQLite: セッション終了
    if (this.sqliteStore && this.currentSessionId) {
      this.sqliteStore.endSession(this.currentSessionId, participantCount);
    }
  }
}
```

### 4.6 /search コマンド

```typescript
// bot/src/commands/search.ts
import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
} from 'discord.js';
import { SqliteStore } from '../output/sqlite-store';

const sqliteStore = new SqliteStore();

export const data = new SlashCommandBuilder()
  .setName('search')
  .setDescription('過去の会話ログを検索します')
  .addStringOption(option =>
    option
      .setName('keyword')
      .setDescription('検索キーワード')
      .setRequired(true)
  )
  .addUserOption(option =>
    option
      .setName('user')
      .setDescription('特定のユーザーに絞り込む')
      .setRequired(false)
  )
  .addIntegerOption(option =>
    option
      .setName('limit')
      .setDescription('結果の最大件数（デフォルト: 10）')
      .setRequired(false)
      .setMinValue(1)
      .setMaxValue(50)
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  const keyword = interaction.options.getString('keyword', true);
  const user = interaction.options.getUser('user');
  const limit = interaction.options.getInteger('limit') || 10;

  await interaction.deferReply();

  try {
    const results = sqliteStore.search({
      keyword,
      userId: user?.id,
      limit,
    });

    if (results.length === 0) {
      await interaction.editReply({
        content: `🔍 「${keyword}」に一致する結果はありませんでした。`,
      });
      return;
    }

    // 結果をEmbed形式で表示
    const embed = new EmbedBuilder()
      .setTitle(`🔍 検索結果: "${keyword}"`)
      .setColor(0x5865F2)
      .setDescription(`${results.length}件の結果が見つかりました`)
      .setTimestamp();

    // 結果を追加（最大10件表示）
    const displayResults = results.slice(0, 10);
    
    for (const result of displayResults) {
      const timestamp = formatTimestamp(result.startTs);
      const date = new Date(result.sessionStartedAt).toLocaleDateString('ja-JP');
      const displayName = result.displayName || result.username;
      
      // テキストを短縮
      const text = result.text.length > 100 
        ? result.text.substring(0, 100) + '...'
        : result.text;
      
      embed.addFields({
        name: `${displayName} - ${date} ${timestamp}`,
        value: text,
        inline: false,
      });
    }

    if (results.length > 10) {
      embed.setFooter({
        text: `他 ${results.length - 10} 件の結果があります`,
      });
    }

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error('Search error:', error);
    await interaction.editReply({
      content: '❌ 検索中にエラーが発生しました。',
    });
  }
}

function formatTimestamp(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}
```

### 4.7 設定

```typescript
// config/index.ts への追加

export const outputConfig = {
  // ... 既存設定 ...
  
  // SQLite
  enableSqlite: process.env.ENABLE_SQLITE === 'true',
  sqliteDbPath: process.env.SQLITE_DB_PATH || './data/transcripts.db',
};
```

### 4.8 環境変数

```bash
# .env
ENABLE_SQLITE=true
SQLITE_DB_PATH=./data/transcripts.db
```

### 4.9 依存パッケージ

```json
// bot/package.json への追加
{
  "dependencies": {
    "better-sqlite3": "^9.2.2"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.8"
  }
}
```

---

## 5. 設定まとめ

### 5.1 環境変数一覧

```bash
# .env

# === 相槌フィルター ===
WHISPER_AIZUCHI_FILTER_ENABLED=true
WHISPER_AIZUCHI_MAX_LENGTH=15

# === hotwords ===
WHISPER_HOTWORDS=DAO,NFT,KIBOTCHA,OpenSea,Ethereum
WHISPER_HOTWORDS_FILE=./config/hotwords.json

# === 検索機能 ===
ENABLE_SQLITE=true
SQLITE_DB_PATH=./data/transcripts.db
```

### 5.2 設定ファイル

```
whisper-discord/
├── config/
│   └── hotwords.json        # 専門用語リスト
├── data/
│   └── transcripts.db       # SQLiteデータベース
```

---

## 6. 実装タスク一覧

### Phase 5: 後処理・拡張機能

#### 5-1: 相槌フィルター
- [ ] `AizuchiFilter` クラス実装
- [ ] `WhisperService` への統合
- [ ] 設定パラメータ追加
- [ ] テスト

#### 5-2: hotwords
- [ ] `HotwordsManager` クラス実装
- [ ] hotwords.json 作成
- [ ] `WhisperService` への統合
- [ ] API パラメータ拡張
- [ ] テスト

#### 5-3: 検索機能
- [ ] `SqliteStore` クラス実装
- [ ] `OutputManager` への統合
- [ ] `/search` コマンド実装
- [ ] コマンド登録
- [ ] テスト

---

## 7. 注意事項

### 7.1 相槌フィルターの調整

実際の会話データでテストし、以下を調整：
- パターンの追加/削除
- `max_length` の調整
- 過剰にフィルタリングされていないか確認

### 7.2 hotwords の効果

`initial_prompt` の効果は限定的な場合がある：
- 長すぎるプロンプトは逆効果
- 20語程度までが推奨
- 効果がない場合は fine-tuning を検討

### 7.3 SQLite のパフォーマンス

大量データ時の対応：
- 定期的な古いデータの削除
- インデックスの最適化
- 将来的にはPostgreSQLへの移行も検討

---

## 8. 次のドキュメント

Phase 4 完了後、本ドキュメントに従って拡張機能を実装する。

- [01-discord-bot.md](./01-discord-bot.md) に戻る
- [spec.md](../spec.md) - 全体概要


