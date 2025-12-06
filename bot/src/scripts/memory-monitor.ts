/**
 * メモリ監視スクリプト
 * Bot起動中のメモリ使用量を定期的に表示
 * 512MB制限でのデプロイを想定したテスト用
 */

const MEMORY_LIMIT_MB = 512;
const WARNING_THRESHOLD = 0.7; // 70%で警告
const CRITICAL_THRESHOLD = 0.85; // 85%で危険

interface MemorySnapshot {
  timestamp: Date;
  heapUsedMB: number;
  heapTotalMB: number;
  rssMB: number;
  externalMB: number;
  arrayBuffersMB: number;
}

const history: MemorySnapshot[] = [];
let peakRss = 0;
let peakHeap = 0;

function formatMemMB(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(2);
}

function getMemorySnapshot(): MemorySnapshot {
  const mem = process.memoryUsage();
  return {
    timestamp: new Date(),
    heapUsedMB: mem.heapUsed / 1024 / 1024,
    heapTotalMB: mem.heapTotal / 1024 / 1024,
    rssMB: mem.rss / 1024 / 1024,
    externalMB: mem.external / 1024 / 1024,
    arrayBuffersMB: mem.arrayBuffers / 1024 / 1024,
  };
}

function getUsageBar(usedMB: number, limitMB: number): string {
  const percentage = usedMB / limitMB;
  const barLength = 30;
  const filled = Math.min(Math.floor(percentage * barLength), barLength);
  const empty = barLength - filled;
  
  let color = '\x1b[32m'; // Green
  if (percentage >= CRITICAL_THRESHOLD) {
    color = '\x1b[31m'; // Red
  } else if (percentage >= WARNING_THRESHOLD) {
    color = '\x1b[33m'; // Yellow
  }
  
  return `${color}${'█'.repeat(filled)}\x1b[90m${'░'.repeat(empty)}\x1b[0m`;
}

function displayMemory(): void {
  const snapshot = getMemorySnapshot();
  history.push(snapshot);
  
  // Keep only last 60 snapshots (10 minutes at 10s interval)
  if (history.length > 60) {
    history.shift();
  }
  
  // Update peaks
  if (snapshot.rssMB > peakRss) peakRss = snapshot.rssMB;
  if (snapshot.heapUsedMB > peakHeap) peakHeap = snapshot.heapUsedMB;
  
  const timestamp = snapshot.timestamp.toISOString().slice(11, 19);
  const usagePercent = ((snapshot.rssMB / MEMORY_LIMIT_MB) * 100).toFixed(1);
  const bar = getUsageBar(snapshot.rssMB, MEMORY_LIMIT_MB);
  
  // Calculate delta from last snapshot
  const delta = history.length > 1 
    ? snapshot.rssMB - history[history.length - 2].rssMB 
    : 0;
  const deltaStr = delta >= 0 ? `+${delta.toFixed(2)}` : delta.toFixed(2);
  const deltaColor = delta > 5 ? '\x1b[31m' : delta > 0 ? '\x1b[33m' : '\x1b[32m';
  
  console.log(
    `[${timestamp}] ` +
    `RSS: ${snapshot.rssMB.toFixed(1).padStart(6)}MB/${MEMORY_LIMIT_MB}MB (${usagePercent.padStart(5)}%) ` +
    `${bar} ` +
    `Heap: ${snapshot.heapUsedMB.toFixed(1).padStart(5)}MB ` +
    `External: ${snapshot.externalMB.toFixed(1).padStart(4)}MB ` +
    `${deltaColor}Δ${deltaStr}MB\x1b[0m`
  );
  
  // Warning messages
  if (snapshot.rssMB / MEMORY_LIMIT_MB >= CRITICAL_THRESHOLD) {
    console.log('\x1b[31m⚠️  CRITICAL: メモリ使用量が危険レベルです！OOMの危険があります\x1b[0m');
  } else if (snapshot.rssMB / MEMORY_LIMIT_MB >= WARNING_THRESHOLD) {
    console.log('\x1b[33m⚠️  WARNING: メモリ使用量が高くなっています\x1b[0m');
  }
}

function displaySummary(): void {
  console.log('\n=== メモリ使用サマリー ===');
  console.log(`ピーク RSS: ${peakRss.toFixed(2)} MB`);
  console.log(`ピーク Heap: ${peakHeap.toFixed(2)} MB`);
  console.log(`制限: ${MEMORY_LIMIT_MB} MB`);
  console.log(`安全マージン: ${(MEMORY_LIMIT_MB - peakRss).toFixed(2)} MB`);
  
  if (peakRss > MEMORY_LIMIT_MB * CRITICAL_THRESHOLD) {
    console.log('\x1b[31m❌ 512MB環境では不安定になる可能性が高い\x1b[0m');
  } else if (peakRss > MEMORY_LIMIT_MB * WARNING_THRESHOLD) {
    console.log('\x1b[33m⚠️ 512MB環境ではギリギリ。追加最適化を推奨\x1b[0m');
  } else {
    console.log('\x1b[32m✓ 512MB環境で安定動作の可能性あり\x1b[0m');
  }
}

// Initial display
const initial = getMemorySnapshot();
console.log('╔══════════════════════════════════════════════════════════════════════════════╗');
console.log('║                    メモリ監視モード (512MB制限テスト)                        ║');
console.log('╠══════════════════════════════════════════════════════════════════════════════╣');
console.log(`║ 初期 RSS: ${formatMemMB(initial.rssMB * 1024 * 1024).padStart(8)} MB | Heap: ${formatMemMB(initial.heapUsedMB * 1024 * 1024).padStart(8)} MB              ║`);
console.log('║                                                                              ║');
console.log('║ テスト手順:                                                                  ║');
console.log('║   1. Discord で /join コマンドを実行                                         ║');
console.log('║   2. ボイスチャンネルで話しかける                                            ║');
console.log('║   3. メモリ変化を観察（5秒ごとに更新）                                       ║');
console.log('║   4. Ctrl+C で終了（サマリー表示）                                           ║');
console.log('╚══════════════════════════════════════════════════════════════════════════════╝');
console.log('');

// Display every 5 seconds
setInterval(displayMemory, 5000);

// Show summary on exit
process.on('SIGINT', () => {
  displaySummary();
  process.exit(0);
});

// Force GC if available (--expose-gc flag)
if (global.gc) {
  setInterval(() => {
    global.gc!();
  }, 30000); // Every 30 seconds
}

// Bot をインポートして起動
import('../index.js').catch(console.error);
