/**
 * メモリ使用量テストスクリプト
 * 各モジュールのインポート時のメモリ消費を測定
 */

function formatMB(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(2) + ' MB';
}

function getMemory(): { heap: number; rss: number } {
  const mem = process.memoryUsage();
  return { heap: mem.heapUsed, rss: mem.rss };
}

function logMemory(label: string, before: { heap: number; rss: number }): void {
  const after = getMemory();
  const heapDiff = after.heap - before.heap;
  const rssDiff = after.rss - before.rss;
  console.log(`[${label}]`);
  console.log(`  Heap: ${formatMB(after.heap)} (+${formatMB(heapDiff)})`);
  console.log(`  RSS:  ${formatMB(after.rss)} (+${formatMB(rssDiff)})`);
  console.log('');
}

async function main() {
  console.log('=== メモリ使用量テスト ===\n');
  
  // 初期状態
  let mem = getMemory();
  console.log('[初期状態]');
  console.log(`  Heap: ${formatMB(mem.heap)}`);
  console.log(`  RSS:  ${formatMB(mem.rss)}`);
  console.log('');

  // Discord.js
  mem = getMemory();
  await import('discord.js');
  logMemory('discord.js', mem);

  // @discordjs/voice
  mem = getMemory();
  await import('@discordjs/voice');
  logMemory('@discordjs/voice', mem);

  // prism-media
  mem = getMemory();
  await import('prism-media');
  logMemory('prism-media', mem);

  // better-sqlite3
  mem = getMemory();
  try {
    await import('better-sqlite3');
    logMemory('better-sqlite3', mem);
  } catch (e) {
    console.log('[better-sqlite3] インポート失敗\n');
  }

  // sodium-native
  mem = getMemory();
  try {
    // @ts-ignore
    await import('sodium-native');
    logMemory('sodium-native', mem);
  } catch (e) {
    console.log('[sodium-native] インポート失敗\n');
  }

  // axios
  mem = getMemory();
  await import('axios');
  logMemory('axios', mem);

  // 最終状態
  const final = getMemory();
  console.log('=== 最終状態 ===');
  console.log(`  Heap: ${formatMB(final.heap)}`);
  console.log(`  RSS:  ${formatMB(final.rss)}`);
}

main().catch(console.error);

