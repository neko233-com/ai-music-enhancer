import { describe, it, expect } from 'vitest';
import { estimateBytes, defaults, parsePcmWav, waveBlob, peakBins } from '../web/src/audio';
describe('audio input and export estimates', () => {
  it('retains original 192 kHz WAV rate and float samples', async () => {
    const samples = new Float32Array([-0.25, 0.125, 0.5, 0]);
    const decoded = parsePcmWav(await waveBlob(samples, 192000, 2).arrayBuffer());
    expect(decoded?.rate).toBe(192000);
    expect(decoded?.channels).toBe(2);
    expect(decoded?.samples).toEqual(samples);
  });
  it('rejects truncated and non-finite PCM', async () => {
    const bytes = await waveBlob(new Float32Array([NaN]), 48000, 1).arrayBuffer();
    expect(() => parsePcmWav(bytes)).toThrow('无效采样值');
    const truncated = await waveBlob(new Float32Array(100), 48000, 1).arrayBuffer();
    expect(() => parsePcmWav(truncated.slice(0, 100))).toThrow('不完整');
  });
  it('calculates output size using sample rate, channels and actual bit depth', () => {
    expect(estimateBytes(1, 2, { ...defaults, rate: 192000, bits: 33 })).toBe(1536000);
    expect(estimateBytes(1, 2, { ...defaults, format: 'mp3', bitrate: 320 })).toBe(40000);
  });
  it('plots both stereo channels', () => {
    expect(peakBins(new Float32Array([0, 0.5, 0, 0.9]), 2, 2)[1]).toBeCloseTo(0.9);
  });
});
