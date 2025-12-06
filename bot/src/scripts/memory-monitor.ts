/**
 * メモリ監視スクリプト
 * Bot起動中のメモリ使用量を定期的に表示
 */

function formatMemMB(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(2) + ' MB';
}

// 10秒ごとにメモリ使用量を表示
setInterval(() => {
  const mem = process.memoryUsage();
  const timestamp = new Date().toISOString().slice(11, 19);
  console.log(`[${timestamp}] Heap: ${formatMemMB(mem.heapUsed)} | RSS: ${formatMemMB(mem.rss)} | External: ${formatMemMB(mem.external)}`);
}, 10000);

// 初期メモリ
const initial = process.memoryUsage();
console.log('=== メモリ監視開始 ===');
console.log(`初期 Heap: ${formatMemMB(initial.heapUsed)} | RSS: ${formatMemMB(initial.rss)}`);
console.log('10秒ごとにメモリ使用量を表示します\n');
console.log('/join コマンドでボイスチャンネルに接続してテストしてください\n');

// Bot をインポートして起動
import('../index.js').catch(console.error);

