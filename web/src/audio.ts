export const RATES = [44100, 48000, 88200, 96000, 176400, 192000] as const;
export const MAX_SECONDS = 180;
export type AudioData = { samples: Float32Array; rate: number; channels: number; duration: number };
export type Settings = {
  mode: 'local' | 'audiosr';
  preset: 'music' | 'voice';
  noise: number;
  detail: number;
  rate: number;
  bits: number;
  format: 'wav' | 'mp3' | 'flac';
  bitrate: number;
  steps: number;
  seed: number;
  mix: number;
  cutoff: number;
};
export const defaults: Settings = {
  mode: 'audiosr',
  preset: 'music',
  noise: 0.15,
  detail: 0.3,
  rate: 48000,
  bits: 24,
  format: 'wav',
  bitrate: 320,
  steps: 50,
  seed: 233,
  mix: 0.7,
  cutoff: 0,
};
export function estimateBytes(seconds: number, channels: number, settings: Settings) {
  return settings.format === 'mp3'
    ? (seconds * settings.bitrate * 1000) / 8
    : (seconds * channels * settings.rate * (settings.bits === 33 ? 32 : settings.bits)) / 8;
}
export function time(seconds: number) {
  return `${Math.floor(seconds / 60)
    .toString()
    .padStart(2, '0')}:${Math.floor(seconds % 60)
    .toString()
    .padStart(2, '0')}`;
}
export function peakBins(samples: Float32Array, channels: number, bins = 180): number[] {
  const frames = samples.length / channels;
  return Array.from({ length: bins }, (_, i) => {
    let peak = 0;
    const start = Math.floor((i * frames) / bins),
      end = Math.floor(((i + 1) * frames) / bins);
    const stride = Math.max(1, Math.floor((end - start) / 128));
    for (let frame = start; frame < end; frame += stride)
      for (let c = 0; c < channels; c++)
        peak = Math.max(peak, Math.abs(samples[frame * channels + c]));
    return peak;
  });
}
export function parsePcmWav(buffer: ArrayBuffer): AudioData | null {
  const view = new DataView(buffer);
  const text = (at: number, n: number) => String.fromCharCode(...new Uint8Array(buffer, at, n));
  if (buffer.byteLength < 44 || text(0, 4) !== 'RIFF' || text(8, 4) !== 'WAVE') return null;
  let format = 0,
    channels = 0,
    rate = 0,
    bits = 0,
    start = 0,
    bytes = 0;
  for (let at = 12; at + 8 <= buffer.byteLength; ) {
    const id = text(at, 4),
      size = view.getUint32(at + 4, true);
    if (at + 8 + size > buffer.byteLength) throw new Error('WAV 文件不完整。');
    if (id === 'fmt ' && size >= 16) {
      format = view.getUint16(at + 8, true);
      channels = view.getUint16(at + 10, true);
      rate = view.getUint32(at + 12, true);
      bits = view.getUint16(at + 22, true);
    }
    if (id === 'data') {
      start = at + 8;
      bytes = size;
    }
    at += 8 + size + (size % 2);
  }
  if (![1, 3].includes(format) || ![16, 24, 32].includes(bits)) return null;
  if (format === 3 && bits !== 32) return null;
  if (
    channels < 1 ||
    channels > 2 ||
    rate < 8000 ||
    rate > 192000 ||
    !bytes ||
    bytes % ((channels * bits) / 8)
  )
    throw new Error('请选择 8–192 kHz 的单声道或立体声文件。');
  const duration = bytes / (((channels * bits) / 8) * rate);
  if (duration > MAX_SECONDS) throw new Error(`网页单次支持 ${MAX_SECONDS} 秒以内的音频。`);
  const samples = new Float32Array(bytes / (bits / 8));
  for (let i = 0; i < samples.length; i++) {
    const at = start + (i * bits) / 8;
    if (format === 3) samples[i] = view.getFloat32(at, true);
    else if (bits === 16) samples[i] = view.getInt16(at, true) / 32768;
    else if (bits === 24)
      samples[i] =
        (((view.getUint8(at) | (view.getUint8(at + 1) << 8) | (view.getUint8(at + 2) << 16)) <<
          8) >>
          8) /
        8388608;
    else samples[i] = view.getInt32(at, true) / 2147483648;
    if (!Number.isFinite(samples[i])) throw new Error('音频包含无效采样值。');
  }
  return { samples, rate, channels, duration };
}
export async function decodeAudio(blob: Blob): Promise<AudioData> {
  if (blob.size > 80 * 1024 * 1024) throw new Error('文件超过 80 MB，请先裁剪音频。');
  const bytes = await blob.arrayBuffer();
  const wav = parsePcmWav(bytes);
  if (wav) return wav;
  const context = new AudioContext({ sampleRate: 48000 });
  try {
    const decoded = await context.decodeAudioData(bytes);
    if (decoded.duration > MAX_SECONDS || decoded.numberOfChannels > 2)
      throw new Error(`请选择 ${MAX_SECONDS} 秒以内的单声道或立体声音频。`);
    const samples = new Float32Array(decoded.length * decoded.numberOfChannels);
    for (let ch = 0; ch < decoded.numberOfChannels; ch++) {
      const data = decoded.getChannelData(ch);
      for (let i = 0; i < data.length; i++) samples[i * decoded.numberOfChannels + ch] = data[i];
    }
    return {
      samples,
      rate: decoded.sampleRate,
      channels: decoded.numberOfChannels,
      duration: decoded.duration,
    };
  } finally {
    await context.close();
  }
}
export function waveBlob(samples: Float32Array, rate: number, channels: number) {
  const buffer = new ArrayBuffer(44 + samples.length * 4),
    view = new DataView(buffer);
  const text = (at: number, value: string) => {
    for (let i = 0; i < value.length; i++) view.setUint8(at + i, value.charCodeAt(i));
  };
  text(0, 'RIFF');
  view.setUint32(4, buffer.byteLength - 8, true);
  text(8, 'WAVEfmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 3, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * channels * 4, true);
  view.setUint16(32, channels * 4, true);
  view.setUint16(34, 32, true);
  text(36, 'data');
  view.setUint32(40, samples.length * 4, true);
  for (let i = 0; i < samples.length; i++) view.setFloat32(44 + i * 4, samples[i], true);
  return new Blob([buffer], { type: 'audio/wav' });
}
