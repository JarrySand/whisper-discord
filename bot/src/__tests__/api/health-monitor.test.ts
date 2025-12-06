/**
 * HealthMonitor テスト
 * 
 * テスト項目:
 * - モニタリングの開始と停止
 * - ヘルスチェックの実行
 * - healthy/unhealthy イベントの発火
 * - 連続成功/失敗のカウント
 */
import { HealthMonitor } from '../../api/health-monitor.js';
import type { WhisperClient } from '../../api/whisper-client.js';

/**
 * モックのWhisperClientを作成
 */
function createMockWhisperClient(healthStatus: 'healthy' | 'unhealthy' = 'healthy'): WhisperClient {
  return {
    healthCheck: jest.fn().mockResolvedValue({
      status: healthStatus,
      timestamp: Date.now(),
    }),
  } as unknown as WhisperClient;
}

describe('HealthMonitor', () => {
  let monitor: HealthMonitor;
  let mockClient: WhisperClient;

  beforeEach(() => {
    mockClient = createMockWhisperClient();
    monitor = new HealthMonitor(mockClient, {
      checkInterval: 100, // テスト用に短く
      healthyThreshold: 2,
      unhealthyThreshold: 2,
    });
  });

  afterEach(() => {
    monitor.stop();
  });

  describe('初期化', () => {
    test('デフォルト設定で初期化される', () => {
      const defaultMonitor = new HealthMonitor(mockClient);
      const status = defaultMonitor.getStatus();

      expect(status.isHealthy).toBe(false);
      expect(status.isRunning).toBe(false);
      expect(status.consecutiveSuccesses).toBe(0);
      expect(status.consecutiveFailures).toBe(0);

      defaultMonitor.stop();
    });

    test('カスタム設定で初期化される', () => {
      const customMonitor = new HealthMonitor(mockClient, {
        checkInterval: 5000,
        healthyThreshold: 5,
        unhealthyThreshold: 3,
      });

      expect(customMonitor.getStatus().isRunning).toBe(false);

      customMonitor.stop();
    });
  });

  describe('モニタリング開始/停止', () => {
    test('start()でモニタリングが開始される', () => {
      monitor.start();

      expect(monitor.getStatus().isRunning).toBe(true);
    });

    test('stop()でモニタリングが停止される', () => {
      monitor.start();
      monitor.stop();

      expect(monitor.getStatus().isRunning).toBe(false);
    });

    test('重複したstart()は無視される', () => {
      monitor.start();
      monitor.start(); // 2回目

      expect(monitor.getStatus().isRunning).toBe(true);
    });
  });

  describe('ヘルスチェック', () => {
    test('start()で即座にチェックが実行される', async () => {
      monitor.start();

      // チェックが実行されるまで待つ
      await new Promise((r) => setTimeout(r, 50));

      expect(mockClient.healthCheck).toHaveBeenCalled();
    });

    test('forceCheck()で手動チェックできる', async () => {
      const result = await monitor.forceCheck();

      expect(mockClient.healthCheck).toHaveBeenCalled();
      expect(typeof result).toBe('boolean');
    });

    test('チェック成功で連続成功カウントが増える', async () => {
      await monitor.forceCheck();
      await monitor.forceCheck();

      const status = monitor.getStatus();
      expect(status.consecutiveSuccesses).toBe(2);
      expect(status.consecutiveFailures).toBe(0);
    });

    test('チェック失敗で連続失敗カウントが増える', async () => {
      const failingClient = createMockWhisperClient('unhealthy');
      const failingMonitor = new HealthMonitor(failingClient, {
        healthyThreshold: 2,
        unhealthyThreshold: 2,
      });

      await failingMonitor.forceCheck();
      await failingMonitor.forceCheck();

      const status = failingMonitor.getStatus();
      expect(status.consecutiveFailures).toBe(2);
      expect(status.consecutiveSuccesses).toBe(0);

      failingMonitor.stop();
    });
  });

  describe('healthy イベント', () => {
    test('閾値到達でhealthyイベントが発火する', async () => {
      const healthyHandler = jest.fn();
      monitor.on('healthy', healthyHandler);

      // 2回成功が必要
      await monitor.forceCheck();
      expect(healthyHandler).not.toHaveBeenCalled();

      await monitor.forceCheck();
      expect(healthyHandler).toHaveBeenCalled();
    });

    test('既にhealthyな場合はイベントは発火しない', async () => {
      const healthyHandler = jest.fn();
      monitor.on('healthy', healthyHandler);

      await monitor.forceCheck();
      await monitor.forceCheck(); // ここでhealthy
      await monitor.forceCheck(); // 追加のチェック

      expect(healthyHandler).toHaveBeenCalledTimes(1);
    });
  });

  describe('unhealthy イベント', () => {
    test('閾値到達でunhealthyイベントが発火する', async () => {
      // まずhealthyにする
      await monitor.forceCheck();
      await monitor.forceCheck();

      // 失敗するクライアントに切り替え
      const failingClient = createMockWhisperClient('unhealthy');
      const failingMonitor = new HealthMonitor(failingClient, {
        healthyThreshold: 1,
        unhealthyThreshold: 2,
      });

      // まずhealthyにする
      (failingClient.healthCheck as jest.Mock).mockResolvedValueOnce({
        status: 'healthy',
        timestamp: Date.now(),
      });
      await failingMonitor.forceCheck();

      // 失敗させる
      (failingClient.healthCheck as jest.Mock).mockResolvedValue({
        status: 'unhealthy',
        timestamp: Date.now(),
      });

      const unhealthyHandler = jest.fn();
      failingMonitor.on('unhealthy', unhealthyHandler);

      await failingMonitor.forceCheck();
      expect(unhealthyHandler).not.toHaveBeenCalled();

      await failingMonitor.forceCheck();
      expect(unhealthyHandler).toHaveBeenCalled();

      failingMonitor.stop();
    });
  });

  describe('ステータス取得', () => {
    test('getStatus()で現在のステータスを取得できる', async () => {
      monitor.start();
      await new Promise((r) => setTimeout(r, 50));

      const status = monitor.getStatus();

      expect(typeof status.isHealthy).toBe('boolean');
      expect(typeof status.lastCheck).toBe('number');
      expect(typeof status.consecutiveSuccesses).toBe('number');
      expect(typeof status.consecutiveFailures).toBe('number');
      expect(typeof status.isRunning).toBe('boolean');
    });

    test('getIsHealthy()でヘルシー状態を取得できる', async () => {
      expect(monitor.getIsHealthy()).toBe(false);

      await monitor.forceCheck();
      await monitor.forceCheck();

      expect(monitor.getIsHealthy()).toBe(true);
    });
  });

  describe('lastCheck タイムスタンプ', () => {
    test('チェック実行でlastCheckが更新される', async () => {
      const before = monitor.getStatus().lastCheck;

      await new Promise((r) => setTimeout(r, 10));
      await monitor.forceCheck();

      const after = monitor.getStatus().lastCheck;
      expect(after).toBeGreaterThan(before);
    });
  });

  describe('カウンターリセット', () => {
    test('成功後の失敗で連続成功がリセットされる', async () => {
      // 成功
      await monitor.forceCheck();
      expect(monitor.getStatus().consecutiveSuccesses).toBe(1);

      // 失敗するクライアントに変更
      (mockClient.healthCheck as jest.Mock).mockResolvedValueOnce({
        status: 'unhealthy',
        timestamp: Date.now(),
      });

      await monitor.forceCheck();

      const status = monitor.getStatus();
      expect(status.consecutiveSuccesses).toBe(0);
      expect(status.consecutiveFailures).toBe(1);
    });

    test('失敗後の成功で連続失敗がリセットされる', async () => {
      // 失敗
      (mockClient.healthCheck as jest.Mock).mockResolvedValueOnce({
        status: 'unhealthy',
        timestamp: Date.now(),
      });
      await monitor.forceCheck();
      expect(monitor.getStatus().consecutiveFailures).toBe(1);

      // 成功に戻す
      (mockClient.healthCheck as jest.Mock).mockResolvedValue({
        status: 'healthy',
        timestamp: Date.now(),
      });
      await monitor.forceCheck();

      const status = monitor.getStatus();
      expect(status.consecutiveFailures).toBe(0);
      expect(status.consecutiveSuccesses).toBe(1);
    });
  });

  describe('エラーハンドリング', () => {
    test('healthCheck()が例外を投げても継続する', async () => {
      (mockClient.healthCheck as jest.Mock).mockRejectedValueOnce(
        new Error('Network error')
      );

      await expect(monitor.forceCheck()).resolves.not.toThrow();

      const status = monitor.getStatus();
      expect(status.consecutiveFailures).toBe(1);
    });
  });

  describe('定期チェック', () => {
    test('指定間隔でチェックが実行される', async () => {
      const fastMonitor = new HealthMonitor(mockClient, {
        checkInterval: 50,
        healthyThreshold: 1,
        unhealthyThreshold: 1,
      });

      fastMonitor.start();

      // 複数回のチェックを待つ
      await new Promise((r) => setTimeout(r, 150));

      // 少なくとも2回は呼ばれているはず
      expect((mockClient.healthCheck as jest.Mock).mock.calls.length).toBeGreaterThanOrEqual(2);

      fastMonitor.stop();
    });
  });
});

