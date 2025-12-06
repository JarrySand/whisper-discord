/**
 * 音声リサンプラー
 * 48kHz Stereo → 16kHz Mono
 */
export class Resampler {
  private readonly inputRate = 48000;
  private readonly outputRate = 16000;
  private readonly ratio = this.inputRate / this.outputRate; // 3

  /**
   * PCMデータをリサンプリング
   * 入力: 48kHz, 2ch, 16-bit
   * 出力: 16kHz, 1ch, 16-bit
   */
  resample(inputBuffer: Buffer): Buffer {
    const bytesPerSample = 2; // 16-bit
    const inputChannels = 2;
    const inputFrameSize = bytesPerSample * inputChannels; // 4 bytes per frame
    const outputFrameSize = bytesPerSample; // 2 bytes per frame (mono)

    const inputSamples = Math.floor(inputBuffer.length / inputFrameSize);
    const outputSamples = Math.floor(inputSamples / this.ratio);

    if (outputSamples === 0) {
      return Buffer.alloc(0);
    }

    const outputBuffer = Buffer.alloc(outputSamples * outputFrameSize);

    for (let i = 0; i < outputSamples; i++) {
      const inputIndex = Math.floor(i * this.ratio);
      const inputOffset = inputIndex * inputFrameSize;

      // ステレオ → モノラル（左右平均）
      const left = inputBuffer.readInt16LE(inputOffset);
      const right = inputBuffer.readInt16LE(inputOffset + 2);
      const mono = Math.floor((left + right) / 2);

      outputBuffer.writeInt16LE(mono, i * outputFrameSize);
    }

    return outputBuffer;
  }

  /**
   * 入力レートを取得
   */
  getInputRate(): number {
    return this.inputRate;
  }

  /**
   * 出力レートを取得
   */
  getOutputRate(): number {
    return this.outputRate;
  }

  /**
   * 変換比率を取得
   */
  getRatio(): number {
    return this.ratio;
  }
}

