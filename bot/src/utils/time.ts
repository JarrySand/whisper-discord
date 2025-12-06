/**
 * タイムスタンプ関連のユーティリティ
 */

/**
 * 現在のUnixタイムスタンプ（ミリ秒）を取得
 */
export function now(): number {
  return Date.now();
}

/**
 * 時間をフォーマット（HH:mm:ss）
 */
export function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  return [hours, minutes, secs]
    .map((v) => v.toString().padStart(2, '0'))
    .join(':');
}

/**
 * ISO形式の日付文字列を取得
 */
export function getISODateString(date: Date = new Date()): string {
  return date.toISOString().split('T')[0];
}

/**
 * ISO形式の時間文字列を取得（ファイル名用）
 */
export function getISOTimeString(date: Date = new Date()): string {
  return date.toTimeString().split(' ')[0].replace(/:/g, '-');
}

/**
 * ファイル名用のタイムスタンプを取得
 */
export function getTimestampForFilename(date: Date = new Date()): string {
  return `${getISODateString(date)}_${getISOTimeString(date)}`;
}

