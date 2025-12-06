import winston from 'winston';
import path from 'path';
import { botConfig } from '../config/index.js';

const { combine, timestamp, printf, colorize, errors } = winston.format;

/**
 * カスタムログフォーマット
 */
const customFormat = printf(({ level, message, timestamp, stack }) => {
  if (stack) {
    return `${timestamp} [${level}]: ${message}\n${stack}`;
  }
  return `${timestamp} [${level}]: ${message}`;
});

/**
 * Winston ロガー設定
 */
export const logger = winston.createLogger({
  level: botConfig.logLevel,
  format: combine(
    errors({ stack: true }),
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    customFormat
  ),
  transports: [
    // コンソール出力
    new winston.transports.Console({
      format: combine(
        colorize(),
        timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        customFormat
      ),
    }),
    // ファイル出力（エラー）
    new winston.transports.File({
      filename: path.join(botConfig.output.logDir, 'error.log'),
      level: 'error',
    }),
    // ファイル出力（全て）
    new winston.transports.File({
      filename: path.join(botConfig.output.logDir, 'combined.log'),
    }),
  ],
});

export default logger;

