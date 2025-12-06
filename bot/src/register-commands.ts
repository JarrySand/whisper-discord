import { Bot } from './bot.js';
import { logger } from './utils/logger.js';

/**
 * スラッシュコマンド登録スクリプト
 * 
 * 使用方法: pnpm register
 */
async function main(): Promise<void> {
  logger.info('=== Discord Slash Commands Registration ===');

  const bot = new Bot();

  try {
    await bot.registerCommands();
    logger.info('✅ Command registration completed');
  } catch (error) {
    logger.error('❌ Command registration failed:', error);
    process.exit(1);
  }

  process.exit(0);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

