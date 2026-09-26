import init, { enhance, wav } from './wasm/neko_audio_engine';
import { Mp3Encoder } from '@breezystack/lamejs';
import type { Settings } from './audio';
const ready = init();
self.onmessage = async (
  event: MessageEvent<{
    action: 'enhance' | 'export';
    samples: Float32Array;
    rate: number;
    channels: number;
    settings: Settings;
  }>,
) => {
  try {
    await ready;
    const { action, samples, rate, channels, settings } = event.data;
    if (action === 'enhance') {
      const output = enhance(
        samples,
        rate,
        channels,
        settings.noise,
        settings.detail,
        settings.rate,
      );
      self.postMessage(
        { samples: output, rate: settings.rate, channels },
        { transfer: [output.buffer] },
      );
    } else {
      if (settings.format === 'mp3') {
        const target = [44100, 48000].includes(rate) ? rate : 48000;
        const pcm = target === rate ? samples : enhance(samples, rate, channels, 0, 0, target);
        const encoder = new Mp3Encoder(channels, target, settings.bitrate),
          chunks: Uint8Array<ArrayBuffer>[] = [];
        const count = pcm.length / channels;
        for (let offset = 0; offset < count; offset += 1152) {
          const size = Math.min(1152, count - offset),
            left = new Int16Array(size),
            right = channels === 2 ? new Int16Array(size) : undefined;
          for (let i = 0; i < size; i++) {
            left[i] = Math.max(-32768, Math.min(32767, pcm[(offset + i) * channels] * 32768));
            if (right)
              right[i] = Math.max(
                -32768,
                Math.min(32767, pcm[(offset + i) * channels + 1] * 32768),
              );
          }
          const chunk = encoder.encodeBuffer(left, right);
          if (chunk.length) chunks.push(new Uint8Array(chunk));
        }
        chunks.push(new Uint8Array(encoder.flush()));
        self.postMessage({ blob: new Blob(chunks, { type: 'audio/mpeg' }) });
      } else {
        const bytes = wav(samples, rate, channels, settings.bits);
        self.postMessage({ blob: new Blob([new Uint8Array(bytes)], { type: 'audio/wav' }) });
      }
    }
  } catch (error) {
    self.postMessage({ error: String(error) });
  }
};
