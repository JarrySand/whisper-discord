/**
 * メモリストレステスト
 * 実際のDiscord接続なしで音声処理のメモリ使用量をシミュレート
 */

import { AudioSegmenter } from '../audio/segmenter.js';
import type { UserAudioBuffer } from '../types/index.js';

const MEMORY_LIMIT_MB = 512;

function formatMB(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(2);
}

function getMemory(): { heap: number; rss: number } {
  const mem = process.memoryUsage();
  return { heap: mem.heapUsed, rss: mem.rss };
}

function logMemory(label: string): void {
  const mem = getMemory();
  const usagePercent = ((mem.rss / 1024 / 1024) / MEMORY_LIMIT_MB * 100).toFixed(1);
  console.log(`[${label}] Heap: ${formatMB(mem.heap)} MB | RSS: ${formatMB(mem.rss)} MB (${usagePercent}% of ${MEMORY_LIMIT_MB}MB)`);
}

/**
 * PCMデータを生成（ノイズ）
 * 48kHz, 2ch, 16bit = 192KB/秒
 */
function generatePCMData(durationMs: number): Buffer {
  const bytesPerSecond = 48000 * 2 * 2; // 48kHz * 2ch * 16bit
  const bytes = Math.floor((durationMs / 1000) * bytesPerSecond);
  const buffer = Buffer.alloc(bytes);
  
  // ランダムノイズを生成
  for (let i = 0; i < bytes; i += 2) {
    const sample = Math.floor((Math.random() - 0.5) * 32768);
    buffer.writeInt16LE(sample, i);
  }
  
  return buffer;
}

/**
 * 単一ユーザーのセグメント処理をシミュレート
 */
async function simulateSingleUserSegment(segmenter: AudioSegmenter, userId: string, durationMs: number): Promise<void> {
  // PCMデータを生成（チャンクとして分割）
  const chunkDurationMs = 20; // 20ms per chunk (typical Opus frame)
  const chunkCount = Math.ceil(durationMs / chunkDurationMs);
  const chunks: { data: Buffer; timestamp: number }[] = [];
  
  const startTime = Date.now();
  for (let i = 0; i < chunkCount; i++) {
    chunks.push({
      data: generatePCMData(chunkDurationMs),
      timestamp: startTime + (i * chunkDurationMs),
    });
  }
  
  // バッファを作成
  const buffer: UserAudioBuffer = {
    userId,
    username: `user_${userId}`,
    displayName: `User ${userId}`,
    chunks,
    startTimestamp: startTime,
    lastActivityTimestamp: startTime + durationMs,
  };
  
  // セグメント化
  await segmenter.createSegment(buffer);
}

async function runTest() {
  console.log('╔══════════════════════════════════════════════════════════════════════════════╗');
  console.log('║                     メモリストレステスト (音声処理シミュレーション)          ║');
  console.log('╠══════════════════════════════════════════════════════════════════════════════╣');
  console.log('║ 設定:                                                                        ║');
  console.log('║   - maxSegmentDuration: 5000ms (5秒)                                         ║');
  console.log('║   - シミュレーション: 複数ユーザー同時音声処理                               ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════════╝');
  console.log('');
  
  logMemory('初期状態');
  
  const segmenter = new AudioSegmenter({ saveToFile: false });
  
  console.log('\n--- テスト1: 単一ユーザー 5秒セグメント ---');
  logMemory('処理前');
  await simulateSingleUserSegment(segmenter, 'user1', 5000);
  logMemory('処理後');
  
  // GC促進
  if (global.gc) global.gc();
  await new Promise(r => setTimeout(r, 100));
  logMemory('GC後');
  
  console.log('\n--- テスト2: 3ユーザー同時 5秒セグメント ---');
  logMemory('処理前');
  await Promise.all([
    simulateSingleUserSegment(segmenter, 'user1', 5000),
    simulateSingleUserSegment(segmenter, 'user2', 5000),
    simulateSingleUserSegment(segmenter, 'user3', 5000),
  ]);
  logMemory('処理後');
  
  if (global.gc) global.gc();
  await new Promise(r => setTimeout(r, 100));
  logMemory('GC後');
  
  console.log('\n--- テスト3: 5ユーザー同時 5秒セグメント ---');
  logMemory('処理前');
  await Promise.all([
    simulateSingleUserSegment(segmenter, 'user1', 5000),
    simulateSingleUserSegment(segmenter, 'user2', 5000),
    simulateSingleUserSegment(segmenter, 'user3', 5000),
    simulateSingleUserSegment(segmenter, 'user4', 5000),
    simulateSingleUserSegment(segmenter, 'user5', 5000),
  ]);
  logMemory('処理後');
  
  if (global.gc) global.gc();
  await new Promise(r => setTimeout(r, 100));
  logMemory('GC後');
  
  console.log('\n--- テスト4: 連続処理 (10セグメント) ---');
  logMemory('処理前');
  for (let i = 0; i < 10; i++) {
    await simulateSingleUserSegment(segmenter, `user_${i}`, 5000);
  }
  logMemory('処理後');
  
  if (global.gc) global.gc();
  await new Promise(r => setTimeout(r, 100));
  logMemory('GC後');
  
  console.log('\n--- テスト5: 負荷テスト (5ユーザー x 10回) ---');
  logMemory('処理前');
  for (let round = 0; round < 10; round++) {
    await Promise.all([
      simulateSingleUserSegment(segmenter, 'user1', 5000),
      simulateSingleUserSegment(segmenter, 'user2', 5000),
      simulateSingleUserSegment(segmenter, 'user3', 5000),
      simulateSingleUserSegment(segmenter, 'user4', 5000),
      simulateSingleUserSegment(segmenter, 'user5', 5000),
    ]);
    
    if (round % 3 === 2 && global.gc) global.gc();
  }
  logMemory('処理後');
  
  if (global.gc) global.gc();
  await new Promise(r => setTimeout(r, 100));
  logMemory('GC後');
  
  // サマリー
  const final = getMemory();
  const finalRssMB = final.rss / 1024 / 1024;
  
  console.log('\n╔══════════════════════════════════════════════════════════════════════════════╗');
  console.log('║                              テスト結果サマリー                              ║');
  console.log('╠══════════════════════════════════════════════════════════════════════════════╣');
  console.log(`║ 最終 RSS: ${formatMB(final.rss).padStart(8)} MB                                                  ║`);
  console.log(`║ 最終 Heap: ${formatMB(final.heap).padStart(7)} MB                                                  ║`);
  console.log(`║ 使用率: ${((finalRssMB / MEMORY_LIMIT_MB) * 100).toFixed(1).padStart(5)}% of ${MEMORY_LIMIT_MB}MB                                                ║`);
  
  if (finalRssMB < MEMORY_LIMIT_MB * 0.5) {
    console.log('║ \x1b[32m✓ 512MB環境で安定動作の可能性が高い\x1b[0m                                     ║');
  } else if (finalRssMB < MEMORY_LIMIT_MB * 0.7) {
    console.log('║ \x1b[33m⚠ 512MB環境で動作可能だが、余裕は少ない\x1b[0m                                 ║');
  } else {
    console.log('║ \x1b[31m❌ 512MB環境では不安定になる可能性\x1b[0m                                       ║');
  }
  console.log('╚══════════════════════════════════════════════════════════════════════════════╝');
}

runTest().catch(console.error);

