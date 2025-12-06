import { spawn } from 'child_process';
import { Readable } from 'stream';
import { logger } from '../utils/logger.js';

/**
 * 音声エンコーダー
 */
export class AudioEncoder {
  private ffmpegAvailable: boolean | null = null;

  /**
   * FFmpeg が利用可能かチェック
   */
  async checkFFmpeg(): Promise<boolean> {
    if (this.ffmpegAvailable !== null) {
      return this.ffmpegAvailable;
    }

    return new Promise((resolve) => {
      const ffmpeg = spawn('ffmpeg', ['-version']);

      ffmpeg.on('close', (code) => {
        this.ffmpegAvailable = code === 0;
        if (this.ffmpegAvailable) {
          logger.info('FFmpeg is available');
        } else {
          logger.warn('FFmpeg is not available, will use WAV fallback');
        }
        resolve(this.ffmpegAvailable);
      });

      ffmpeg.on('error', () => {
        this.ffmpegAvailable = false;
        logger.warn('FFmpeg is not available, will use WAV fallback');
        resolve(false);
      });
    });
  }

  /**
   * PCM → OGG/Opus エンコード (FFmpeg使用)
   */
  async encodeToOgg(pcmData: Buffer): Promise<Buffer> {
    // FFmpeg が利用可能かチェック
    const isAvailable = await this.checkFFmpeg();
    if (!isAvailable) {
      throw new Error('FFmpeg is not available');
    }

    return new Promise((resolve, reject) => {
      const ffmpeg = spawn('ffmpeg', [
        '-f', 's16le', // 入力: signed 16-bit little-endian
        '-ar', '16000', // サンプルレート: 16kHz
        '-ac', '1', // チャンネル: mono
        '-i', 'pipe:0', // 入力: stdin
        '-c:a', 'libopus', // コーデック: Opus
        '-b:a', '32k', // ビットレート: 32kbps
        '-vbr', 'on', // 可変ビットレート
        '-compression_level', '10', // 最高圧縮
        '-f', 'ogg', // 出力形式: OGG
        'pipe:1', // 出力: stdout
      ]);

      const chunks: Buffer[] = [];

      ffmpeg.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));

      ffmpeg.stderr.on('data', (data: Buffer) => {
        // FFmpegの進捗情報はstderrに出力されるため、通常は無視
        logger.debug(`FFmpeg stderr: ${data.toString()}`);
      });

      ffmpeg.on('close', (code) => {
        if (code === 0) {
          resolve(Buffer.concat(chunks));
        } else {
          reject(new Error(`FFmpeg exited with code ${code}`));
        }
      });

      ffmpeg.on('error', (error) => {
        reject(error);
      });

      // PCMデータを送信
      const input = Readable.from(pcmData);
      input.pipe(ffmpeg.stdin);
    });
  }

  /**
   * PCM → WAV エンコード (ヘッダー付与のみ)
   * FFmpegが使えない環境用のフォールバック
   */
  encodeToWav(pcmData: Buffer): Buffer {
    const sampleRate = 16000;
    const channels = 1;
    const bitsPerSample = 16;
    const byteRate = sampleRate * channels * (bitsPerSample / 8);
    const blockAlign = channels * (bitsPerSample / 8);
    const dataSize = pcmData.length;
    const fileSize = 36 + dataSize;

    const header = Buffer.alloc(44);

    // RIFF header
    header.write('RIFF', 0);
    header.writeUInt32LE(fileSize, 4);
    header.write('WAVE', 8);

    // fmt subchunk
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16); // Subchunk1Size
    header.writeUInt16LE(1, 20); // AudioFormat (PCM)
    header.writeUInt16LE(channels, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(byteRate, 28);
    header.writeUInt16LE(blockAlign, 32);
    header.writeUInt16LE(bitsPerSample, 34);

    // data subchunk
    header.write('data', 36);
    header.writeUInt32LE(dataSize, 40);

    return Buffer.concat([header, pcmData]);
  }

  /**
   * フォーマットに応じてエンコード
   */
  async encode(
    pcmData: Buffer,
    preferOgg = true
  ): Promise<{ data: Buffer; format: 'ogg' | 'wav' }> {
    if (preferOgg) {
      try {
        const data = await this.encodeToOgg(pcmData);
        return { data, format: 'ogg' };
      } catch {
        logger.warn('OGG encoding failed, falling back to WAV');
      }
    }

    const data = this.encodeToWav(pcmData);
    return { data, format: 'wav' };
  }
}

