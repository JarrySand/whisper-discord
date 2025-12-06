/**
 * テスト用の音声データ生成ヘルパー
 */

/**
 * 無音PCMデータを生成（16-bit, 16kHz）
 */
export function createSilentPcm(durationMs: number): Buffer {
  const sampleRate = 16000;
  const bytesPerSample = 2;
  const samples = Math.floor((sampleRate * durationMs) / 1000);
  const buffer = Buffer.alloc(samples * bytesPerSample);
  // 0で初期化されているので無音
  return buffer;
}

/**
 * ノイズを含む無音PCMデータを生成（閾値以下のランダムノイズ）
 */
export function createLowNoisePcm(durationMs: number, maxAmplitude = 300): Buffer {
  const sampleRate = 16000;
  const bytesPerSample = 2;
  const samples = Math.floor((sampleRate * durationMs) / 1000);
  const buffer = Buffer.alloc(samples * bytesPerSample);

  for (let i = 0; i < samples; i++) {
    const value = Math.floor(Math.random() * maxAmplitude * 2) - maxAmplitude;
    buffer.writeInt16LE(value, i * bytesPerSample);
  }

  return buffer;
}

/**
 * 音声（非無音）PCMデータを生成
 */
export function createLoudPcm(durationMs: number, amplitude = 10000): Buffer {
  const sampleRate = 16000;
  const bytesPerSample = 2;
  const samples = Math.floor((sampleRate * durationMs) / 1000);
  const buffer = Buffer.alloc(samples * bytesPerSample);

  for (let i = 0; i < samples; i++) {
    // サイン波を生成（440Hz）
    const freq = 440;
    const value = Math.floor(amplitude * Math.sin((2 * Math.PI * freq * i) / sampleRate));
    buffer.writeInt16LE(value, i * bytesPerSample);
  }

  return buffer;
}

/**
 * 特定のパターンのPCMデータを生成
 */
export function createPatternPcm(
  pattern: 'silence' | 'tone' | 'noise' | 'speech-like',
  durationMs: number
): Buffer {
  switch (pattern) {
    case 'silence':
      return createSilentPcm(durationMs);
    case 'tone':
      return createLoudPcm(durationMs, 10000);
    case 'noise':
      return createLowNoisePcm(durationMs, 1000);
    case 'speech-like':
      return createSpeechLikePcm(durationMs);
  }
}

/**
 * 音声っぽいPCMデータを生成（振幅変化あり）
 */
function createSpeechLikePcm(durationMs: number): Buffer {
  const sampleRate = 16000;
  const bytesPerSample = 2;
  const samples = Math.floor((sampleRate * durationMs) / 1000);
  const buffer = Buffer.alloc(samples * bytesPerSample);

  for (let i = 0; i < samples; i++) {
    // 基本周波数を変化させる（人声っぽく）
    const baseFreq = 200 + 100 * Math.sin((2 * Math.PI * i) / (sampleRate * 0.5));
    // 振幅も変化
    const amplitude = 5000 + 3000 * Math.sin((2 * Math.PI * i) / (sampleRate * 0.3));
    const value = Math.floor(amplitude * Math.sin((2 * Math.PI * baseFreq * i) / sampleRate));
    buffer.writeInt16LE(value, i * bytesPerSample);
  }

  return buffer;
}

