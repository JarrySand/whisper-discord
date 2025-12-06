/**
 * Whisper API ヘルスチェックスクリプト
 */
import { WhisperClient } from '../api/whisper-client.js';

async function main() {
  console.log('🔍 Whisper API ヘルスチェック開始...\n');

  const client = new WhisperClient({
    baseUrl: process.env.WHISPER_API_URL || 'http://localhost:8000',
    timeout: 10000,
  });

  try {
    const health = await client.healthCheck();

    console.log('✅ ヘルスチェック成功!\n');
    console.log('📊 API ステータス:');
    console.log(`   Status: ${health.status}`);
    console.log(`   Model Loaded: ${health.model_loaded}`);
    console.log(`   Model Name: ${health.model_name}`);
    console.log(`   Device: ${health.device}`);
    console.log(`   Compute Type: ${health.compute_type}`);
    console.log(`   Uptime: ${health.uptime_seconds}秒`);
    console.log(`   Requests Processed: ${health.requests_processed}`);
    console.log(`   Avg Processing Time: ${health.avg_processing_time_ms.toFixed(2)}ms`);

    process.exit(0);
  } catch (error) {
    console.error('❌ ヘルスチェック失敗!');
    console.error(`   Error: ${(error as Error).message}`);
    process.exit(1);
  }
}

main();



