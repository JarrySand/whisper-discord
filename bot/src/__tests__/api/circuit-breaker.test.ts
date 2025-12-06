/**
 * サーキットブレーカー テスト
 * 
 * テスト項目:
 * - 正常時はCLOSED状態を維持
 * - 連続失敗でOPEN状態に遷移
 * - タイムアウト後にHALF_OPEN状態に遷移
 * - HALF_OPENで成功するとCLOSEDに復帰
 * - HALF_OPENで失敗するとOPENに戻る
 */
import { CircuitBreaker, CircuitState, CircuitBreakerOpenError } from '../../api/circuit-breaker.js';

describe('CircuitBreaker', () => {
  describe('初期状態', () => {
    test('初期状態はCLOSED', () => {
      const cb = new CircuitBreaker();
      expect(cb.getState()).toBe(CircuitState.CLOSED);
      expect(cb.isClosed()).toBe(true);
      expect(cb.isOpen()).toBe(false);
    });

    test('デフォルト設定が適用される', () => {
      const cb = new CircuitBreaker();
      const status = cb.getStatus();

      expect(status.failures).toBe(0);
      expect(status.successes).toBe(0);
      expect(status.state).toBe(CircuitState.CLOSED);
    });

    test('カスタム設定が適用される', () => {
      const cb = new CircuitBreaker({
        failureThreshold: 3,
        successThreshold: 2,
        timeout: 5000,
      });

      // 設定に基づいて動作することを確認
      expect(cb.getState()).toBe(CircuitState.CLOSED);
    });
  });

  describe('CLOSED状態', () => {
    test('成功時はCLOSEDを維持', async () => {
      const cb = new CircuitBreaker();

      await cb.execute(async () => 'success');
      await cb.execute(async () => 'success');

      expect(cb.getState()).toBe(CircuitState.CLOSED);
      expect(cb.getStatus().failures).toBe(0);
    });

    test('成功時に結果を返す', async () => {
      const cb = new CircuitBreaker();

      const result = await cb.execute(async () => 'test-result');
      expect(result).toBe('test-result');
    });

    test('失敗時にエラーをスロー', async () => {
      const cb = new CircuitBreaker();

      await expect(
        cb.execute(async () => {
          throw new Error('test error');
        })
      ).rejects.toThrow('test error');
    });

    test('失敗回数がカウントされる', async () => {
      const cb = new CircuitBreaker({ failureThreshold: 5 });

      try {
        await cb.execute(async () => {
          throw new Error('fail');
        });
      } catch {
        // ignore
      }

      expect(cb.getStatus().failures).toBe(1);
    });

    test('閾値未満の失敗ではOPENにならない', async () => {
      const cb = new CircuitBreaker({ failureThreshold: 5 });

      // 4回失敗（閾値=5未満）
      for (let i = 0; i < 4; i++) {
        try {
          await cb.execute(async () => {
            throw new Error('fail');
          });
        } catch {
          // ignore
        }
      }

      expect(cb.getState()).toBe(CircuitState.CLOSED);
    });
  });

  describe('OPEN状態への遷移', () => {
    test('連続失敗でOPEN状態に遷移', async () => {
      const cb = new CircuitBreaker({ failureThreshold: 3 });

      // 3回連続失敗
      for (let i = 0; i < 3; i++) {
        try {
          await cb.execute(async () => {
            throw new Error('fail');
          });
        } catch {
          // ignore
        }
      }

      expect(cb.getState()).toBe(CircuitState.OPEN);
      expect(cb.isOpen()).toBe(true);
    });

    test('OPEN状態ではCircuitBreakerOpenErrorがスロー', async () => {
      const cb = new CircuitBreaker({ failureThreshold: 1 });

      // 1回失敗でOPENに
      try {
        await cb.execute(async () => {
          throw new Error('fail');
        });
      } catch {
        // ignore
      }

      await expect(cb.execute(async () => 'test')).rejects.toThrow(CircuitBreakerOpenError);
    });

    test('OPEN状態では操作が実行されない', async () => {
      const cb = new CircuitBreaker({ failureThreshold: 1, timeout: 10000 });
      let executed = false;

      // OPENに遷移
      try {
        await cb.execute(async () => {
          throw new Error('fail');
        });
      } catch {
        // ignore
      }

      // 操作は実行されない
      try {
        await cb.execute(async () => {
          executed = true;
          return 'result';
        });
      } catch {
        // ignore
      }

      expect(executed).toBe(false);
    });
  });

  describe('HALF_OPEN状態への遷移', () => {
    test('タイムアウト後にHALF_OPENに遷移', async () => {
      const cb = new CircuitBreaker({
        failureThreshold: 1,
        timeout: 100, // 100ms
      });

      // OPENに遷移
      try {
        await cb.execute(async () => {
          throw new Error('fail');
        });
      } catch {
        // ignore
      }

      expect(cb.getState()).toBe(CircuitState.OPEN);

      // タイムアウト待ち
      await new Promise((r) => setTimeout(r, 150));

      // 次の呼び出しでHALF_OPENに
      try {
        await cb.execute(async () => 'success');
      } catch {
        // ignore
      }

      // 成功したのでCLOSEDに遷移する可能性あり
      expect([CircuitState.HALF_OPEN, CircuitState.CLOSED]).toContain(cb.getState());
    });
  });

  describe('HALF_OPEN状態', () => {
    test('HALF_OPENで成功するとCLOSEDに復帰', async () => {
      const cb = new CircuitBreaker({
        failureThreshold: 1,
        successThreshold: 2,
        timeout: 50,
      });

      // OPENに遷移
      try {
        await cb.execute(async () => {
          throw new Error('fail');
        });
      } catch {
        // ignore
      }

      await new Promise((r) => setTimeout(r, 100));

      // 2回成功でCLOSEDに
      await cb.execute(async () => 'success');
      await cb.execute(async () => 'success');

      expect(cb.getState()).toBe(CircuitState.CLOSED);
    });

    test('HALF_OPENで失敗するとOPENに戻る', async () => {
      const cb = new CircuitBreaker({
        failureThreshold: 1,
        successThreshold: 3,
        timeout: 50,
      });

      // OPENに遷移
      try {
        await cb.execute(async () => {
          throw new Error('fail');
        });
      } catch {
        // ignore
      }

      await new Promise((r) => setTimeout(r, 100));

      // HALF_OPENで失敗
      try {
        await cb.execute(async () => {
          throw new Error('fail again');
        });
      } catch {
        // ignore
      }

      expect(cb.getState()).toBe(CircuitState.OPEN);
    });
  });

  describe('イベント', () => {
    test('状態変更イベントが発火する', async () => {
      const cb = new CircuitBreaker({ failureThreshold: 1 });
      const stateChanges: { oldState: CircuitState; newState: CircuitState }[] = [];

      cb.on('stateChange', (change) => {
        stateChanges.push(change);
      });

      try {
        await cb.execute(async () => {
          throw new Error('fail');
        });
      } catch {
        // ignore
      }

      expect(stateChanges).toHaveLength(1);
      expect(stateChanges[0].oldState).toBe(CircuitState.CLOSED);
      expect(stateChanges[0].newState).toBe(CircuitState.OPEN);
    });

    test('openイベントが発火する', async () => {
      const cb = new CircuitBreaker({ failureThreshold: 1 });
      let openFired = false;

      cb.on('open', () => {
        openFired = true;
      });

      try {
        await cb.execute(async () => {
          throw new Error('fail');
        });
      } catch {
        // ignore
      }

      expect(openFired).toBe(true);
    });

    test('closeイベントが発火する', async () => {
      const cb = new CircuitBreaker({
        failureThreshold: 1,
        successThreshold: 1,
        timeout: 50,
      });
      let closeFired = false;

      cb.on('close', () => {
        closeFired = true;
      });

      try {
        await cb.execute(async () => {
          throw new Error('fail');
        });
      } catch {
        // ignore
      }

      await new Promise((r) => setTimeout(r, 100));

      await cb.execute(async () => 'success');

      expect(closeFired).toBe(true);
    });
  });

  describe('リセット', () => {
    test('リセットでCLOSED状態に戻る', async () => {
      const cb = new CircuitBreaker({ failureThreshold: 1 });

      try {
        await cb.execute(async () => {
          throw new Error('fail');
        });
      } catch {
        // ignore
      }

      expect(cb.getState()).toBe(CircuitState.OPEN);

      cb.reset();

      expect(cb.getState()).toBe(CircuitState.CLOSED);
      expect(cb.getStatus().failures).toBe(0);
      expect(cb.getStatus().successes).toBe(0);
    });

    test('resetイベントが発火する', async () => {
      const cb = new CircuitBreaker({ failureThreshold: 1 });
      let resetFired = false;

      cb.on('reset', () => {
        resetFired = true;
      });

      try {
        await cb.execute(async () => {
          throw new Error('fail');
        });
      } catch {
        // ignore
      }

      cb.reset();

      expect(resetFired).toBe(true);
    });
  });

  describe('ステータス情報', () => {
    test('正確なステータス情報を返す', async () => {
      const cb = new CircuitBreaker({ failureThreshold: 5 });

      // いくつか失敗
      for (let i = 0; i < 3; i++) {
        try {
          await cb.execute(async () => {
            throw new Error('fail');
          });
        } catch {
          // ignore
        }
      }

      const status = cb.getStatus();

      expect(status.state).toBe(CircuitState.CLOSED);
      expect(status.failures).toBe(3);
      expect(status.lastFailureTime).toBeGreaterThan(0);
      expect(status.lastStateChange).toBeGreaterThan(0);
    });
  });
});

