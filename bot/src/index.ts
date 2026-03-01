import { Bot } from "./bot.js";
import { logger } from "./utils/logger.js";

// @snazzah/davey は @discordjs/voice が動的にimportするため、明示的なimportは不要
// DAVE（E2EE）はDiscordにより全ユーザーに強制適用される（2026/3/2〜）

/**
 * メインエントリーポイント
 */
async function main(): Promise<void> {
  const bot = new Bot();

  // Graceful shutdown ハンドラ
  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}. Shutting down...`);
    await bot.stop();
    process.exit(0);
  };

  // シグナルハンドラを設定
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  // 未処理の例外をキャッチ
  process.on("uncaughtException", (error) => {
    logger.error("Uncaught exception:", error);
    process.exit(1);
  });

  process.on("unhandledRejection", (reason) => {
    logger.error("Unhandled rejection:", reason);
  });

  try {
    await bot.start();
  } catch (error) {
    logger.error("Failed to start bot:", error);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
