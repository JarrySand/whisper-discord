/**
 * T-1: 話者識別テスト - SSRCMapper
 * 
 * 目的: 複数ユーザー同時発話時の正しい割り当て
 * 
 * テスト項目:
 * - 複数ユーザーを同時に管理できる
 * - 同一ユーザーのSSRC変更を処理できる
 * - ユーザー削除が正しく動作する
 */
import { SSRCMapper } from '../../voice/ssrc-mapper.js';
import type { GuildMember, User } from 'discord.js';

// モックのGuildMemberを作成するヘルパー
function createMockMember(userId: string, username: string, displayName: string): GuildMember {
  return {
    user: {
      username,
      id: userId,
    } as User,
    displayName,
    id: userId,
  } as GuildMember;
}

describe('SSRCMapper', () => {
  let mapper: SSRCMapper;

  beforeEach(() => {
    mapper = new SSRCMapper();
  });

  describe('T-1: 話者識別テスト', () => {
    test('複数ユーザーを同時に管理できる', () => {
      const mockMember1 = createMockMember('user-1', 'alice', 'Alice');
      const mockMember2 = createMockMember('user-2', 'bob', 'Bob');
      const mockMember3 = createMockMember('user-3', 'charlie', 'Charlie');

      mapper.register(11111, 'user-1', mockMember1);
      mapper.register(22222, 'user-2', mockMember2);
      mapper.register(33333, 'user-3', mockMember3);

      expect(mapper.get(11111)?.userId).toBe('user-1');
      expect(mapper.get(22222)?.userId).toBe('user-2');
      expect(mapper.get(33333)?.userId).toBe('user-3');
      expect(mapper.size).toBe(3);
    });

    test('ユーザー名と表示名が正しく保存される', () => {
      const mockMember = createMockMember('user-1', 'alice_user', 'Alice (表示名)');
      mapper.register(11111, 'user-1', mockMember);

      const info = mapper.get(11111);
      expect(info).toBeDefined();
      expect(info?.username).toBe('alice_user');
      expect(info?.displayName).toBe('Alice (表示名)');
    });

    test('SSRCからユーザー情報を取得できる', () => {
      const mockMember = createMockMember('user-1', 'alice', 'Alice');
      mapper.register(12345, 'user-1', mockMember);

      const info = mapper.get(12345);
      expect(info).toBeDefined();
      expect(info?.userId).toBe('user-1');
      expect(info?.username).toBe('alice');
      expect(info?.displayName).toBe('Alice');
      expect(info?.joinedAt).toBeInstanceOf(Date);
    });

    test('存在しないSSRCはundefinedを返す', () => {
      const info = mapper.get(99999);
      expect(info).toBeUndefined();
    });
  });

  describe('SSRC変更処理', () => {
    test('同一ユーザーのSSRC変更を処理できる（新規SSRCで再登録）', () => {
      const mockMember = createMockMember('user-1', 'alice', 'Alice');

      // 最初のSSRC
      mapper.register(11111, 'user-1', mockMember);
      expect(mapper.get(11111)?.userId).toBe('user-1');

      // SSRCが変更された場合（新しいSSRCで登録）
      mapper.register(99999, 'user-1', mockMember);

      // 新しいSSRCでユーザー情報が取得できる
      expect(mapper.get(99999)?.userId).toBe('user-1');
      expect(mapper.getByUserId('user-1')).toBeDefined();
    });

    test('UserIDからSSRCを取得できる', () => {
      const mockMember = createMockMember('user-1', 'alice', 'Alice');
      mapper.register(12345, 'user-1', mockMember);

      const ssrc = mapper.getSSRCByUserId('user-1');
      expect(ssrc).toBe(12345);
    });

    test('存在しないUserIDからSSRC取得はundefined', () => {
      const ssrc = mapper.getSSRCByUserId('non-existent');
      expect(ssrc).toBeUndefined();
    });
  });

  describe('ユーザー削除', () => {
    test('SSRCでユーザーを削除できる', () => {
      const mockMember = createMockMember('user-1', 'alice', 'Alice');
      mapper.register(11111, 'user-1', mockMember);

      expect(mapper.get(11111)).toBeDefined();

      const result = mapper.remove(11111);
      expect(result).toBe(true);
      expect(mapper.get(11111)).toBeUndefined();
      expect(mapper.size).toBe(0);
    });

    test('存在しないSSRC削除はfalseを返す', () => {
      const result = mapper.remove(99999);
      expect(result).toBe(false);
    });

    test('UserIDでユーザーを削除できる', () => {
      const mockMember = createMockMember('user-1', 'alice', 'Alice');
      mapper.register(11111, 'user-1', mockMember);

      const result = mapper.removeByUserId('user-1');
      expect(result).toBe(true);
      expect(mapper.get(11111)).toBeUndefined();
      expect(mapper.getByUserId('user-1')).toBeUndefined();
    });

    test('存在しないUserID削除はfalseを返す', () => {
      const result = mapper.removeByUserId('non-existent');
      expect(result).toBe(false);
    });
  });

  describe('全体操作', () => {
    test('クリアですべて削除される', () => {
      const mockMember1 = createMockMember('user-1', 'alice', 'Alice');
      const mockMember2 = createMockMember('user-2', 'bob', 'Bob');

      mapper.register(11111, 'user-1', mockMember1);
      mapper.register(22222, 'user-2', mockMember2);

      expect(mapper.size).toBe(2);

      mapper.clear();

      expect(mapper.size).toBe(0);
      expect(mapper.get(11111)).toBeUndefined();
      expect(mapper.get(22222)).toBeUndefined();
    });

    test('すべてのユーザー情報を取得できる', () => {
      const mockMember1 = createMockMember('user-1', 'alice', 'Alice');
      const mockMember2 = createMockMember('user-2', 'bob', 'Bob');
      const mockMember3 = createMockMember('user-3', 'charlie', 'Charlie');

      mapper.register(11111, 'user-1', mockMember1);
      mapper.register(22222, 'user-2', mockMember2);
      mapper.register(33333, 'user-3', mockMember3);

      const allUsers = mapper.getAllUsers();

      expect(allUsers).toHaveLength(3);
      expect(allUsers.map((u) => u.userId)).toContain('user-1');
      expect(allUsers.map((u) => u.userId)).toContain('user-2');
      expect(allUsers.map((u) => u.userId)).toContain('user-3');
    });
  });

  describe('同時発話シナリオ', () => {
    test('5人のユーザーが同時にVCにいる状態を管理できる', () => {
      const users = [
        { id: 'user-1', name: 'alice', display: 'Alice', ssrc: 11111 },
        { id: 'user-2', name: 'bob', display: 'Bob', ssrc: 22222 },
        { id: 'user-3', name: 'charlie', display: 'Charlie', ssrc: 33333 },
        { id: 'user-4', name: 'dave', display: 'Dave', ssrc: 44444 },
        { id: 'user-5', name: 'eve', display: 'Eve', ssrc: 55555 },
      ];

      // 全員登録
      for (const user of users) {
        const mockMember = createMockMember(user.id, user.name, user.display);
        mapper.register(user.ssrc, user.id, mockMember);
      }

      expect(mapper.size).toBe(5);

      // 各ユーザーのSSRCを確認
      for (const user of users) {
        const info = mapper.get(user.ssrc);
        expect(info?.userId).toBe(user.id);
        expect(info?.displayName).toBe(user.display);
      }

      // 一人離脱
      mapper.removeByUserId('user-3');
      expect(mapper.size).toBe(4);
      expect(mapper.get(33333)).toBeUndefined();

      // 新しいユーザー参加
      const newMember = createMockMember('user-6', 'frank', 'Frank');
      mapper.register(66666, 'user-6', newMember);
      expect(mapper.size).toBe(5);
      expect(mapper.get(66666)?.displayName).toBe('Frank');
    });
  });
});

