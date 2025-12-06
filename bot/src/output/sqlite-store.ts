/**
 * SQLite ストア
 * - 文字起こし結果をSQLiteに保存
 * - /search コマンドで検索可能
 */
import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../utils/logger.js';
import type { TranscriptionResult } from '../types/index.js';

/**
 * セッションデータ
 */
export interface SessionData {
  id: string;
  guildId: string;
  guildName: string;
  channelId: string;
  channelName: string;
  startedAt: Date;
}

/**
 * 発話データ
 */
export interface UtteranceData {
  sessionId: string;
  segmentId: string;
  userId: string;
  username: string;
  displayName?: string;
  text: string;
  startTs: number;
  endTs: number;
  confidence?: number;
}

/**
 * 検索オプション
 */
export interface SearchOptions {
  keyword: string;
  guildId?: string;
  userId?: string;
  sessionId?: string;
  limit?: number;
}

/**
 * 検索結果
 */
export interface SearchResult {
  sessionId: string;
  segmentId: string;
  userId: string;
  username: string;
  displayName: string | null;
  text: string;
  startTs: number;
  channelName: string | null;
  sessionStartedAt: string;
}

/**
 * セッションサマリー
 */
export interface SessionSummary {
  id: string;
  guildId: string;
  guildName: string;
  channelId: string;
  channelName: string;
  startedAt: string;
  endedAt: string | null;
  participantCount: number;
  utteranceCount: number;
}

/**
 * SQLite ストアサービス
 */
export class SqliteStore {
  private db: Database.Database;
  private currentSessionId: string | null = null;

  constructor(dbPath: string = './data/transcripts.db') {

    // Create directory if it doesn't exist
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Initialize database
    this.db = new Database(dbPath);
    this.initialize();

    logger.info('SqliteStore initialized', { dbPath });
  }

  /**
   * データベースを初期化
   */
  private initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        guild_id TEXT NOT NULL,
        guild_name TEXT NOT NULL,
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
        segment_id TEXT NOT NULL,
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
      CREATE INDEX IF NOT EXISTS idx_sessions_guild ON sessions(guild_id);
    `);

    logger.debug('SqliteStore tables initialized');
  }

  /**
   * セッションを開始
   */
  startSession(session: SessionData): void {
    const stmt = this.db.prepare(`
      INSERT INTO sessions (id, guild_id, guild_name, channel_id, channel_name, started_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      session.id,
      session.guildId,
      session.guildName,
      session.channelId,
      session.channelName || null,
      session.startedAt.toISOString()
    );

    this.currentSessionId = session.id;
    logger.debug('Session started in SQLite', { sessionId: session.id });
  }

  /**
   * セッションを終了
   */
  endSession(participantCount: number = 0): void {
    if (!this.currentSessionId) {
      logger.warn('No active session to end');
      return;
    }

    const stmt = this.db.prepare(`
      UPDATE sessions
      SET ended_at = ?, participant_count = ?
      WHERE id = ?
    `);

    stmt.run(new Date().toISOString(), participantCount, this.currentSessionId);
    logger.debug('Session ended in SQLite', { sessionId: this.currentSessionId });
    this.currentSessionId = null;
  }

  /**
   * 発話を保存
   */
  saveUtterance(utterance: UtteranceData): void {
    const stmt = this.db.prepare(`
      INSERT INTO utterances
        (session_id, segment_id, user_id, username, display_name, text, start_ts, end_ts, confidence)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      utterance.sessionId,
      utterance.segmentId,
      utterance.userId,
      utterance.username,
      utterance.displayName || null,
      utterance.text,
      utterance.startTs,
      utterance.endTs,
      utterance.confidence ?? null
    );

    logger.debug('Utterance saved', { segmentId: utterance.segmentId });
  }

  /**
   * TranscriptionResult から発話を保存
   */
  saveTranscriptionResult(result: TranscriptionResult): void {
    if (!this.currentSessionId) {
      logger.warn('No active session, cannot save transcription result');
      return;
    }

    this.saveUtterance({
      sessionId: this.currentSessionId,
      segmentId: result.segmentId,
      userId: result.userId,
      username: result.username,
      displayName: result.displayName,
      text: result.text,
      startTs: result.startTs,
      endTs: result.endTs,
      confidence: result.confidence,
    });
  }

  /**
   * テキスト検索
   */
  search(options: SearchOptions): SearchResult[] {
    let sql = `
      SELECT
        u.session_id AS sessionId,
        u.segment_id AS segmentId,
        u.user_id AS userId,
        u.username,
        u.display_name AS displayName,
        u.text,
        u.start_ts AS startTs,
        s.channel_name AS channelName,
        s.started_at AS sessionStartedAt
      FROM utterances u
      JOIN sessions s ON u.session_id = s.id
      WHERE u.text LIKE ?
    `;

    const params: (string | number)[] = [`%${options.keyword}%`];

    if (options.guildId) {
      sql += ` AND s.guild_id = ?`;
      params.push(options.guildId);
    }

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

  /**
   * セッション一覧を取得
   */
  listSessions(guildId: string, limit: number = 10): SessionSummary[] {
    const stmt = this.db.prepare(`
      SELECT
        s.id,
        s.guild_id AS guildId,
        s.guild_name AS guildName,
        s.channel_id AS channelId,
        s.channel_name AS channelName,
        s.started_at AS startedAt,
        s.ended_at AS endedAt,
        s.participant_count AS participantCount,
        COUNT(u.id) AS utteranceCount
      FROM sessions s
      LEFT JOIN utterances u ON s.id = u.session_id
      WHERE s.guild_id = ?
      GROUP BY s.id
      ORDER BY s.started_at DESC
      LIMIT ?
    `);

    return stmt.all(guildId, limit) as SessionSummary[];
  }

  /**
   * セッションの発話を取得
   */
  getSessionUtterances(sessionId: string): SearchResult[] {
    const stmt = this.db.prepare(`
      SELECT
        u.session_id AS sessionId,
        u.segment_id AS segmentId,
        u.user_id AS userId,
        u.username,
        u.display_name AS displayName,
        u.text,
        u.start_ts AS startTs,
        s.channel_name AS channelName,
        s.started_at AS sessionStartedAt
      FROM utterances u
      JOIN sessions s ON u.session_id = s.id
      WHERE u.session_id = ?
      ORDER BY u.start_ts ASC
    `);

    return stmt.all(sessionId) as SearchResult[];
  }

  /**
   * 統計情報を取得
   */
  getStats(guildId?: string): {
    totalSessions: number;
    totalUtterances: number;
    totalParticipants: number;
  } {
    let sessionSql = 'SELECT COUNT(*) as count FROM sessions';
    let utteranceSql = 'SELECT COUNT(*) as count FROM utterances';
    let participantSql =
      'SELECT SUM(participant_count) as count FROM sessions';

    const params: string[] = [];

    if (guildId) {
      sessionSql += ' WHERE guild_id = ?';
      utteranceSql += ' WHERE session_id IN (SELECT id FROM sessions WHERE guild_id = ?)';
      participantSql += ' WHERE guild_id = ?';
      params.push(guildId);
    }

    const sessions = this.db.prepare(sessionSql).get(...params) as { count: number };
    const utterances = this.db.prepare(utteranceSql).get(...params) as { count: number };
    const participants = this.db.prepare(participantSql).get(...params) as { count: number | null };

    return {
      totalSessions: sessions.count,
      totalUtterances: utterances.count,
      totalParticipants: participants.count || 0,
    };
  }

  /**
   * 古いセッションを削除
   */
  cleanupOldSessions(daysOld: number = 30): number {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);

    // Delete utterances first
    const deleteUtterances = this.db.prepare(`
      DELETE FROM utterances
      WHERE session_id IN (
        SELECT id FROM sessions WHERE started_at < ?
      )
    `);
    deleteUtterances.run(cutoffDate.toISOString());

    // Then delete sessions
    const deleteSessions = this.db.prepare(`
      DELETE FROM sessions WHERE started_at < ?
    `);
    const result = deleteSessions.run(cutoffDate.toISOString());

    if (result.changes > 0) {
      logger.info(`Cleaned up ${result.changes} old sessions`);
    }

    return result.changes;
  }

  /**
   * 現在のセッションIDを取得
   */
  getCurrentSessionId(): string | null {
    return this.currentSessionId;
  }

  /**
   * データベースを閉じる
   */
  close(): void {
    this.db.close();
    logger.debug('SqliteStore closed');
  }
}

/**
 * SQLite ストアマネージャー
 * - guildIdごとに個別のデータベースを管理
 * - セキュリティ: 他サーバーのデータに物理的にアクセス不可
 */
export class SqliteStoreManager {
  private stores: Map<string, SqliteStore> = new Map();
  private baseDir: string;
  private cleanupDays: number;

  constructor(baseDir: string = './data', cleanupDays: number = 30) {
    this.baseDir = baseDir;
    this.cleanupDays = cleanupDays;

    // Create base directory if it doesn't exist
    if (!fs.existsSync(baseDir)) {
      fs.mkdirSync(baseDir, { recursive: true });
    }

    logger.info('SqliteStoreManager initialized', { baseDir });
  }

  /**
   * guildIdに対応するDBパスを生成
   */
  private getDbPath(guildId: string): string {
    return path.join(this.baseDir, `guild_${guildId}.db`);
  }

  /**
   * guildIdに対応するSqliteStoreを取得（なければ作成）
   */
  getStore(guildId: string): SqliteStore {
    let store = this.stores.get(guildId);
    if (!store) {
      const dbPath = this.getDbPath(guildId);
      store = new SqliteStore(dbPath);
      this.stores.set(guildId, store);
      logger.debug('Created new SqliteStore for guild', { guildId, dbPath });
    }
    return store;
  }

  /**
   * guildIdに対応するSqliteStoreが存在するか確認
   */
  hasStore(guildId: string): boolean {
    // メモリ上に存在するか
    if (this.stores.has(guildId)) {
      return true;
    }
    // DBファイルが存在するか
    const dbPath = this.getDbPath(guildId);
    return fs.existsSync(dbPath);
  }

  /**
   * 全ストアを閉じる
   */
  closeAll(): void {
    for (const [guildId, store] of this.stores) {
      try {
        store.close();
        logger.debug('Closed SqliteStore for guild', { guildId });
      } catch (error) {
        logger.error('Failed to close SqliteStore', { guildId, error });
      }
    }
    this.stores.clear();
    logger.info('All SqliteStores closed');
  }

  /**
   * 全ストアの古いセッションをクリーンアップ
   */
  cleanupAllStores(): number {
    let totalCleaned = 0;
    for (const [guildId, store] of this.stores) {
      try {
        const cleaned = store.cleanupOldSessions(this.cleanupDays);
        totalCleaned += cleaned;
        if (cleaned > 0) {
          logger.debug('Cleaned up sessions', { guildId, cleaned });
        }
      } catch (error) {
        logger.error('Failed to cleanup store', { guildId, error });
      }
    }
    return totalCleaned;
  }

  /**
   * 既存のDBファイル一覧を取得
   */
  listGuildDatabases(): string[] {
    try {
      const files = fs.readdirSync(this.baseDir);
      return files
        .filter(f => f.startsWith('guild_') && f.endsWith('.db'))
        .map(f => f.replace('guild_', '').replace('.db', ''));
    } catch {
      return [];
    }
  }
}

export default SqliteStore;

