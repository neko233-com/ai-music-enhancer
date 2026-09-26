"""Six original project demos. Music is synthesized; voices use OS speech synthesis.
No third-party songs or recordings are bundled. Re-run on Windows via the PS script.
"""

from pathlib import Path
import json
import numpy as np
import soundfile as sf
from scipy.signal import resample_poly, butter, sosfiltfilt

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "web/public/demos"
OUT.mkdir(parents=True, exist_ok=True)
SR = 24000
rng = np.random.default_rng(233)


def tune(variant, seconds=12):
    n = int(seconds * SR)
    data = np.zeros((n, 2), dtype=np.float64)
    notes = (
        [60, 64, 67, 71, 69, 67, 64, 62]
        if variant == 1
        else [57, 60, 64, 67, 64, 60, 59, 55]
    )
    step = 0.48 if variant == 1 else 0.67
    for beat, start in enumerate(np.arange(0, seconds, step)):
        freq = 440 * 2 ** ((notes[beat % len(notes)] - 69) / 12)
        t = np.arange(min(int(2 * SR), n - int(start * SR))) / SR
        envelope = (1 - np.exp(-t * 120)) * np.exp(-t * 3)
        tone = (
            sum(
                np.sin(2 * np.pi * freq * h * t) * np.exp(-t * h / 2) / h**1.8
                for h in range(1, 9)
            )
            * envelope
        )
        for channel in range(2):
            pan = 0.8 + 0.2 * np.cos(beat + channel * 2)
            a = int(start * SR)
            data[a : a + len(t), channel] += tone * 0.23 * pan
    t = np.arange(n) / SR
    pad = (
        np.sin(2 * np.pi * 130.81 * t)
        + np.sin(2 * np.pi * 164.81 * t)
        + np.sin(2 * np.pi * 196 * t)
    ) * 0.025
    data += (
        pad[:, None] * np.minimum(1, t[:, None]) * np.minimum(1, (seconds - t)[:, None])
    )
    return data.astype(np.float32)


manifest = []
voices = []
for i in [1, 2]:
    voice, rate = sf.read(
        ROOT / f".cache/demo-voices/voice-{i}.wav", dtype="float32", always_2d=True
    )
    from math import gcd

    d = gcd(rate, SR)
    voice = resample_poly(voice, SR // d, rate // d, axis=0)
    voice = voice[: SR * 16]
    voices.append(voice)
    # Deliberately bandwidth-limited demos make a useful reconstruction comparison.
    voice = sosfiltfilt(butter(6, 5500, fs=SR, output="sos"), voice, axis=0)
    voice += rng.normal(0, 0.0015, voice.shape)
    sf.write(OUT / f"voice-{i}.wav", voice, SR, subtype="PCM_16")
    manifest.append(
        dict(
            id=f"voice-{i}",
            name=["清晨的声音", "Every sound"][i - 1],
            category="纯人声",
            description=["中文旁白 · 合成语音", "英文朗读 · 合成语音"][i - 1],
            path=f"/demos/voice-{i}.wav",
        )
    )
for i in [1, 2]:
    music = tune(i)
    music = sosfiltfilt(butter(6, 6000, fs=SR, output="sos"), music, axis=0)
    sf.write(OUT / f"music-{i}.wav", music, SR, subtype="PCM_16")
    manifest.append(
        dict(
            id=f"music-{i}",
            name=["玻璃琴的午后", "月光慢拍"][i - 1],
            category="纯音乐",
            description="原创合成旋律 · 立体声",
            path=f"/demos/music-{i}.wav",
        )
    )
for i in [1, 2]:
    voice = voices[i - 1]
    music = tune(i, len(voice) / SR)
    mixed = music * 0.45 + voice * 0.85
    mixed = sosfiltfilt(butter(6, 6500, fs=SR, output="sos"), mixed, axis=0)
    sf.write(OUT / f"vocal-music-{i}.wav", mixed, SR, subtype="PCM_16")
    manifest.append(
        dict(
            id=f"vocal-music-{i}",
            name=["风与旋律", "A quieter rhythm"][i - 1],
            category="人声音乐",
            description="合成旁白 + 原创配乐",
            path=f"/demos/vocal-music-{i}.wav",
        )
    )
(OUT / "manifest.json").write_text(
    json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
)
print("Generated six self-contained demo recordings")
