/**
 * Jest テストセットアップファイル
 * テスト実行前の共通設定を行う
 */

// Winston ロガーをモック化（テスト中のログ出力を抑制）
jest.mock('../utils/logger.js', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

// タイムアウト設定
jest.setTimeout(30000);

// グローバルなクリーンアップ
afterEach(() => {
  jest.clearAllMocks();
});

