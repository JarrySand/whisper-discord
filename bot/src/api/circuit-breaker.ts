/**
 * サーキットブレーカー
 * - API障害時の自動遮断
 * - 段階的復旧
 */
import { EventEmitter } from 'events';
import { logger } from '../utils/logger.js';
import type { CircuitBreakerConfig } from '../types/index.js';

/**
 * サーキットブレーカーの状態
 */
export enum CircuitState {
  CLOSED = 'CLOSED', // 正常稼働
  OPEN = 'OPEN', // 遮断中
  HALF_OPEN = 'HALF_OPEN', // 試験中
}

/**
 * サーキットブレーカーOpenエラー
 */
export class CircuitBreakerOpenError extends Error {
  constructor(message = 'Circuit breaker is open') {
    super(message);
    this.name = 'CircuitBreakerOpenError';
  }
}

/**
 * サーキットブレーカー
 */
export class CircuitBreaker extends EventEmitter {
  private state: CircuitState = CircuitState.CLOSED;
  private failures = 0;
  private successes = 0;
  private lastFailureTime = 0;
  private lastStateChange = Date.now();
  private config: CircuitBreakerConfig;

  constructor(config: Partial<CircuitBreakerConfig> = {}) {
    super();
    this.config = {
      failureThreshold: config.failureThreshold ?? 5,
      successThreshold: config.successThreshold ?? 3,
      timeout: config.timeout ?? 30000,
      monitoringPeriod: config.monitoringPeriod ?? 60000,
    };

    logger.debug('CircuitBreaker initialized', { config: this.config });
  }

  /**
   * 操作を実行（サーキットブレーカー経由）
   */
  async execute<T>(operation: () => Promise<T>): Promise<T> {
    // OPEN状態のチェック
    if (this.state === CircuitState.OPEN) {
      if (this.shouldAttemptReset()) {
        this.transitionTo(CircuitState.HALF_OPEN);
      } else {
        throw new CircuitBreakerOpenError();
      }
    }

    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  /**
   * 成功時の処理
   */
  private onSuccess(): void {
    this.failures = 0;

    if (this.state === CircuitState.HALF_OPEN) {
      this.successes++;
      logger.debug(
        `Circuit breaker: success in HALF_OPEN (${this.successes}/${this.config.successThreshold})`
      );

      if (this.successes >= this.config.successThreshold) {
        this.transitionTo(CircuitState.CLOSED);
        this.successes = 0;
      }
    }
  }

  /**
   * 失敗時の処理
   */
  private onFailure(): void {
    this.failures++;
    this.lastFailureTime = Date.now();
    this.successes = 0;

    if (
      this.state === CircuitState.CLOSED &&
      this.failures >= this.config.failureThreshold
    ) {
      this.transitionTo(CircuitState.OPEN);
    } else if (this.state === CircuitState.HALF_OPEN) {
      this.transitionTo(CircuitState.OPEN);
    }

    logger.debug(`Circuit breaker: failure (${this.failures}/${this.config.failureThreshold})`);
  }

  /**
   * リセット試行すべきかチェック
   */
  private shouldAttemptReset(): boolean {
    return Date.now() - this.lastFailureTime >= this.config.timeout;
  }

  /**
   * 状態遷移
   */
  private transitionTo(newState: CircuitState): void {
    const oldState = this.state;
    this.state = newState;
    this.lastStateChange = Date.now();

    logger.info(`Circuit breaker state change: ${oldState} -> ${newState}`);
    this.emit('stateChange', { oldState, newState });

    if (newState === CircuitState.OPEN) {
      this.emit('open');
    } else if (newState === CircuitState.CLOSED) {
      this.emit('close');
    } else if (newState === CircuitState.HALF_OPEN) {
      this.emit('halfOpen');
    }
  }

  /**
   * 現在の状態を取得
   */
  getState(): CircuitState {
    return this.state;
  }

  /**
   * OPENかどうか
   */
  isOpen(): boolean {
    return this.state === CircuitState.OPEN;
  }

  /**
   * CLOSEDかどうか
   */
  isClosed(): boolean {
    return this.state === CircuitState.CLOSED;
  }

  /**
   * 状態をリセット
   */
  reset(): void {
    this.state = CircuitState.CLOSED;
    this.failures = 0;
    this.successes = 0;
    this.lastFailureTime = 0;
    this.lastStateChange = Date.now();
    logger.info('Circuit breaker reset');
    this.emit('reset');
  }

  /**
   * ステータス情報を取得
   */
  getStatus(): {
    state: CircuitState;
    failures: number;
    successes: number;
    lastFailureTime: number;
    lastStateChange: number;
  } {
    return {
      state: this.state,
      failures: this.failures,
      successes: this.successes,
      lastFailureTime: this.lastFailureTime,
      lastStateChange: this.lastStateChange,
    };
  }
}

export default CircuitBreaker;





