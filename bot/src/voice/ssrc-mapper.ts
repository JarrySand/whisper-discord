import type { GuildMember } from 'discord.js';
import type { SSRCUserInfo } from '../types/index.js';
import { logger } from '../utils/logger.js';

/**
 * SSRC → UserID マッピング管理
 *
 * Discord の音声パケットには SSRC (Synchronization Source) という ID が含まれる。
 * @discordjs/voice はこのマッピングを自動で行うが、
 * ユーザー情報の管理を行うためにこのクラスを使用する。
 */
export class SSRCMapper {
  private map = new Map<number, SSRCUserInfo>();
  private userIdToSSRC = new Map<string, number>();

  /**
   * SSRC とユーザー情報を登録
   */
  register(ssrc: number, userId: string, member: GuildMember): void {
    const info: SSRCUserInfo = {
      userId,
      username: member.user.username,
      displayName: member.displayName,
      joinedAt: new Date(),
    };

    this.map.set(ssrc, info);
    this.userIdToSSRC.set(userId, ssrc);

    logger.debug(
      `Registered SSRC ${ssrc} for user ${info.displayName} (${userId})`
    );
  }

  /**
   * SSRC からユーザー情報を取得
   */
  get(ssrc: number): SSRCUserInfo | undefined {
    return this.map.get(ssrc);
  }

  /**
   * UserID からユーザー情報を取得
   */
  getByUserId(userId: string): SSRCUserInfo | undefined {
    for (const info of this.map.values()) {
      if (info.userId === userId) return info;
    }
    return undefined;
  }

  /**
   * UserID から SSRC を取得
   */
  getSSRCByUserId(userId: string): number | undefined {
    return this.userIdToSSRC.get(userId);
  }

  /**
   * SSRC を削除
   */
  remove(ssrc: number): boolean {
    const info = this.map.get(ssrc);
    if (info) {
      this.userIdToSSRC.delete(info.userId);
      this.map.delete(ssrc);
      logger.debug(`Removed SSRC ${ssrc}`);
      return true;
    }
    return false;
  }

  /**
   * UserID で削除
   */
  removeByUserId(userId: string): boolean {
    const ssrc = this.userIdToSSRC.get(userId);
    if (ssrc !== undefined) {
      this.map.delete(ssrc);
      this.userIdToSSRC.delete(userId);
      logger.debug(`Removed SSRC for user ${userId}`);
      return true;
    }
    return false;
  }

  /**
   * すべてクリア
   */
  clear(): void {
    this.map.clear();
    this.userIdToSSRC.clear();
    logger.debug('Cleared all SSRC mappings');
  }

  /**
   * 登録数を取得
   */
  get size(): number {
    return this.map.size;
  }

  /**
   * すべてのユーザー情報を取得
   */
  getAllUsers(): SSRCUserInfo[] {
    return Array.from(this.map.values());
  }
}

