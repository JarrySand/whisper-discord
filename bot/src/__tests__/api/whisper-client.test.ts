/**
 * WhisperClient テスト
 * 
 * テスト項目:
 * - 初期化
 * - 単一セグメント文字起こし
 * - バッチ処理
 * - リトライロジック
 * - エラーハンドリング
 * - ヘルスチェック
 */
import axios, { AxiosError } from 'axios';
import { WhisperClient } from '../../api/whisper-client.js';
import type { TranscribeRequest } from '../../types/index.js';

// axiosをモック化
jest.mock('axios', () => {
  const actualAxios = jest.requireActual('axios');
  return {
    ...actualAxios,
    default: {
      create: jest.fn(),
    },
    create: jest.fn(),
    isAxiosError: (error: any) => error?.isAxiosError === true,
  };
});
const mockedAxios = axios as jest.Mocked<typeof axios>;

/**
 * AxiosErrorをシミュレート
 */
function createAxiosError(status: number, message = 'Error'): AxiosError {
  const error = new Error(message) as AxiosError;
  error.isAxiosError = true;
  error.response = {
    status,
    statusText: message,
    headers: {},
    config: {} as any,
    data: {},
  };
  error.config = {} as any;
  error.toJSON = () => ({});
  return error;
}

/**
 * モックのリクエストを作成
 */
function createMockRequest(overrides: Partial<TranscribeRequest> = {}): TranscribeRequest {
  const now = Date.now();
  return {
    audioData: Buffer.from('mock-audio-data'),
    audioFormat: 'ogg',
    userId: 'user-1',
    username: 'testuser',
    displayName: 'Test User',
    startTs: now - 3000,
    endTs: now,
    language: 'ja',
    ...overrides,
  };
}

describe('WhisperClient', () => {
  let mockAxiosInstance: {
    post: jest.Mock;
    get: jest.Mock;
  };

  beforeEach(() => {
    mockAxiosInstance = {
      post: jest.fn(),
      get: jest.fn(),
    };
    mockedAxios.create.mockReturnValue(mockAxiosInstance as unknown as ReturnType<typeof axios.create>);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('初期化', () => {
    test('デフォルト設定で初期化される', () => {
      const client = new WhisperClient();
      const config = client.getConfig();

      expect(config.baseUrl).toBeDefined();
      expect(config.timeout).toBeDefined();
      expect(config.retryCount).toBeDefined();
    });

    test('カスタム設定で初期化される', () => {
      const client = new WhisperClient({
        baseUrl: 'http://custom-api:9000',
        timeout: 60000,
        retryCount: 5,
        retryDelay: 2000,
      });

      const config = client.getConfig();
      expect(config.baseUrl).toBe('http://custom-api:9000');
      expect(config.timeout).toBe(60000);
      expect(config.retryCount).toBe(5);
      expect(config.retryDelay).toBe(2000);
    });

    test('axios インスタンスが作成される', () => {
      new WhisperClient({ baseUrl: 'http://test:8000' });

      expect(mockedAxios.create).toHaveBeenCalledWith(
        expect.objectContaining({
          baseURL: 'http://test:8000',
        })
      );
    });
  });

  describe('transcribe', () => {
    test('単一セグメントを文字起こしできる', async () => {
      const mockResponse = {
        data: {
          success: true,
          data: {
            user_id: 'user-1',
            username: 'testuser',
            display_name: 'Test User',
            text: 'こんにちは',
            start_ts: Date.now() - 3000,
            end_ts: Date.now(),
            duration_ms: 3000,
            language: 'ja',
            confidence: 0.95,
            processing_time_ms: 500,
          },
        },
      };

      mockAxiosInstance.post.mockResolvedValueOnce(mockResponse);

      const client = new WhisperClient({ retryCount: 0 });
      const result = await client.transcribe(createMockRequest());

      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        '/transcribe',
        expect.any(Object),
        expect.objectContaining({
          headers: expect.any(Object),
        })
      );
      expect(result).toEqual(mockResponse.data);
    });

    test('displayNameがない場合もリクエストできる', async () => {
      mockAxiosInstance.post.mockResolvedValueOnce({
        data: { success: true, data: {} },
      });

      const client = new WhisperClient({ retryCount: 0 });
      await client.transcribe(createMockRequest({ displayName: undefined }));

      expect(mockAxiosInstance.post).toHaveBeenCalled();
    });
  });

  describe('transcribeBatch', () => {
    test('空の配列では空の結果を返す', async () => {
      const client = new WhisperClient();
      const result = await client.transcribeBatch([]);

      expect(result).toEqual([]);
      expect(mockAxiosInstance.post).not.toHaveBeenCalled();
    });

    test('複数セグメントをバッチ処理できる', async () => {
      const mockResponse = {
        data: {
          success: true,
          data: {
            results: [
              { success: true, data: { text: 'テスト1' } },
              { success: true, data: { text: 'テスト2' } },
            ],
          },
        },
      };

      mockAxiosInstance.post.mockResolvedValueOnce(mockResponse);

      const client = new WhisperClient({ retryCount: 0 });
      const result = await client.transcribeBatch([
        createMockRequest({ userId: 'user-1' }),
        createMockRequest({ userId: 'user-2' }),
      ]);

      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        '/transcribe/batch',
        expect.any(Object),
        expect.objectContaining({
          headers: expect.any(Object),
        })
      );
      expect(result).toEqual(mockResponse.data.data.results);
    });
  });

  describe('リトライロジック', () => {
    test('一時的なエラーでリトライする', async () => {
      // 最初は失敗、2回目で成功
      mockAxiosInstance.post
        .mockRejectedValueOnce(createAxiosError(500, 'Server error'))
        .mockResolvedValueOnce({
          data: { success: true, data: { text: 'OK' } },
        });

      const client = new WhisperClient({
        retryCount: 2,
        retryDelay: 10, // テスト用に短く
      });

      const result = await client.transcribe(createMockRequest());

      expect(mockAxiosInstance.post).toHaveBeenCalledTimes(2);
      expect(result.success).toBe(true);
    });

    test('リトライ回数を超えるとエラーを投げる', async () => {
      mockAxiosInstance.post.mockRejectedValue(createAxiosError(500, 'Server error'));

      const client = new WhisperClient({
        retryCount: 2,
        retryDelay: 10,
      });

      await expect(client.transcribe(createMockRequest())).rejects.toThrow();
      expect(mockAxiosInstance.post).toHaveBeenCalledTimes(3); // 初回 + 2リトライ
    });

    test('4xxエラー（400, 401, 403, 404）はリトライしない', async () => {
      mockAxiosInstance.post.mockRejectedValue(createAxiosError(400, 'Bad request'));

      const client = new WhisperClient({
        retryCount: 3,
        retryDelay: 10,
      });

      await expect(client.transcribe(createMockRequest())).rejects.toThrow();
      expect(mockAxiosInstance.post).toHaveBeenCalledTimes(1); // リトライしない
    });

    test('408 (Timeout) はリトライする', async () => {
      mockAxiosInstance.post
        .mockRejectedValueOnce(createAxiosError(408, 'Request Timeout'))
        .mockResolvedValueOnce({
          data: { success: true, data: {} },
        });

      const client = new WhisperClient({
        retryCount: 1,
        retryDelay: 10,
      });

      const result = await client.transcribe(createMockRequest());

      expect(mockAxiosInstance.post).toHaveBeenCalledTimes(2);
      expect(result.success).toBe(true);
    });

    test('429 (Too Many Requests) はリトライする', async () => {
      mockAxiosInstance.post
        .mockRejectedValueOnce(createAxiosError(429, 'Too Many Requests'))
        .mockResolvedValueOnce({
          data: { success: true, data: {} },
        });

      const client = new WhisperClient({
        retryCount: 1,
        retryDelay: 10,
      });

      const result = await client.transcribe(createMockRequest());

      expect(mockAxiosInstance.post).toHaveBeenCalledTimes(2);
      expect(result.success).toBe(true);
    });

    test('バックオフ係数でリトライ間隔が増加する', async () => {
      // 3回失敗
      mockAxiosInstance.post.mockRejectedValue(createAxiosError(500, 'Server error'));

      const client = new WhisperClient({
        retryCount: 2,
        retryDelay: 50,
        retryBackoffMultiplier: 2,
      });

      const startTime = Date.now();
      await expect(client.transcribe(createMockRequest())).rejects.toThrow();
      const elapsed = Date.now() - startTime;

      // 50 + 100 = 150ms 以上かかるはず
      expect(elapsed).toBeGreaterThanOrEqual(140);
    });
  });

  describe('healthCheck', () => {
    test('正常なヘルスチェック', async () => {
      const mockResponse = {
        data: {
          status: 'healthy',
          timestamp: Date.now(),
        },
      };

      mockAxiosInstance.get.mockResolvedValueOnce(mockResponse);

      const client = new WhisperClient();
      const result = await client.healthCheck();

      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/health', {
        timeout: 5000,
      });
      expect(result.status).toBe('healthy');
    });

    test('ヘルスチェック成功でisHealthyがtrueになる', async () => {
      mockAxiosInstance.get.mockResolvedValueOnce({
        data: { status: 'healthy' },
      });

      const client = new WhisperClient();
      await client.healthCheck();

      const status = client.getHealthStatus();
      expect(status.isHealthy).toBe(true);
      expect(status.lastCheck).toBeGreaterThan(0);
    });

    test('ヘルスチェック失敗でisHealthyがfalseになる', async () => {
      mockAxiosInstance.get.mockRejectedValueOnce(new Error('Connection refused'));

      const client = new WhisperClient();

      await expect(client.healthCheck()).rejects.toThrow();

      const status = client.getHealthStatus();
      expect(status.isHealthy).toBe(false);
    });

    test('unhealthyステータスでもisHealthyがfalseになる', async () => {
      mockAxiosInstance.get.mockResolvedValueOnce({
        data: { status: 'unhealthy' },
      });

      const client = new WhisperClient();
      await client.healthCheck();

      const status = client.getHealthStatus();
      expect(status.isHealthy).toBe(false);
    });
  });

  describe('getHealthStatus', () => {
    test('初期状態ではhealthyでlastCheckが0', () => {
      const client = new WhisperClient();
      const status = client.getHealthStatus();

      expect(status.isHealthy).toBe(true); // 初期値
      expect(status.lastCheck).toBe(0);
    });
  });
});

