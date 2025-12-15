/**
 * ヘルスモニタリング
 * - 定期的なヘルスチェック
 * - healthy/unhealthy イベント発火
 */
import { EventEmitter } from 'events';
import { logger } from '../utils/logger.js';
import type { WhisperClient } from './whisper-client.js';
import type { HealthMonitorConfig } from '../types/index.js';

/**
 * ヘルスモニター
 */
export class HealthMonitor extends EventEmitter {
  private config: HealthMonitorConfig;
  private whisperClient: WhisperClient;
  private timer: NodeJS.Timeout | null = null;
  private consecutiveSuccesses = 0;
  private consecutiveFailures = 0;
  private isHealthy = false;
  private lastCheck = 0;
  private isRunning = false;

  constructor(whisperClient: WhisperClient, config: Partial<HealthMonitorConfig> = {}) {
    super();
    this.whisperClient = whisperClient;
    this.config = {
      checkInterval: config.checkInterval ?? 30000,
      healthyThreshold: config.healthyThreshold ?? 2,
      unhealthyThreshold: config.unhealthyThreshold ?? 3,
    };

    logger.debug('HealthMonitor initialized', { config: this.config });
  }

  /**
   * モニタリング開始
   */
  start(): void {
    if (this.isRunning) {
      logger.warn('HealthMonitor is already running');
      return;
    }

    this.isRunning = true;
    logger.info('HealthMonitor started');

    // 即座に最初のチェック
    this.check();

    // 定期チェック開始
    this.timer = setInterval(() => this.check(), this.config.checkInterval);
  }

  /**
   * モニタリング停止
   */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.isRunning = false;
    logger.info('HealthMonitor stopped');
  }

  /**
   * ヘルスチェック実行
   */
  private async check(): Promise<void> {
    this.lastCheck = Date.now();

    try {
      const health = await this.whisperClient.healthCheck();

      if (health.status === 'healthy') {
        this.consecutiveSuccesses++;
        this.consecutiveFailures = 0;

        if (!this.isHealthy && this.consecutiveSuccesses >= this.config.healthyThreshold) {
          this.isHealthy = true;
          logger.info('Whisper API is now healthy');
          this.emit('healthy', health);
        }

        logger.debug('Health check passed', {
          consecutiveSuccesses: this.consecutiveSuccesses,
        });
      } else {
        throw new Error(`Health check returned: ${health.status}`);
      }
    } catch (error) {
      this.consecutiveFailures++;
      this.consecutiveSuccesses = 0;

      if (this.isHealthy && this.consecutiveFailures >= this.config.unhealthyThreshold) {
        this.isHealthy = false;
        logger.warn('Whisper API is now unhealthy');
        this.emit('unhealthy', error);
      }

      logger.debug('Health check failed', {
        consecutiveFailures: this.consecutiveFailures,
        error: (error as Error).message,
      });
    }
  }

  /**
   * 手動でヘルスチェック実行
   */
  async forceCheck(): Promise<boolean> {
    await this.check();
    return this.isHealthy;
  }

  /**
   * ステータス取得
   */
  getStatus(): {
    isHealthy: boolean;
    lastCheck: number;
    consecutiveSuccesses: number;
    consecutiveFailures: number;
    isRunning: boolean;
  } {
    return {
      isHealthy: this.isHealthy,
      lastCheck: this.lastCheck,
      consecutiveSuccesses: this.consecutiveSuccesses,
      consecutiveFailures: this.consecutiveFailures,
      isRunning: this.isRunning,
    };
  }

  /**
   * 現在ヘルシーかどうか
   */
  getIsHealthy(): boolean {
    return this.isHealthy;
  }
}

export default HealthMonitor;





