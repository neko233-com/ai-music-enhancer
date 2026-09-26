"""Build offline vocal-music excerpts from public-domain historical recordings."""

import hashlib
import json
from pathlib import Path
import urllib.request
import numpy as np
import soundfile as sf
from scipy.signal import resample_poly
from math import gcd

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "web/public/demos"
CACHE = ROOT / ".cache/demo-sources"
CACHE.mkdir(parents=True, exist_ok=True)
sources = [
    (
        "Auld Lang Syne · 1910",
        "Frank C. Stanley · 演唱与伴奏",
        "https://upload.wikimedia.org/wikipedia/commons/e/e3/Auld_Lang_Syne.ogg",
        "https://commons.wikimedia.org/wiki/File:Auld_Lang_Syne.ogg",
        30,
    ),
    (
        "Daisy Bell · 1894",
        "Edward M. Favor · 演唱与伴奏",
        "https://upload.wikimedia.org/wikipedia/commons/6/65/Daisy_Bell_sung_by_Edward_M._Favor.ogg",
        "https://commons.wikimedia.org/wiki/File:Daisy_Bell_sung_by_Edward_M._Favor.ogg",
        20,
    ),
]
manifest = json.loads((OUT / "manifest.json").read_text(encoding="utf-8"))[:4]
for index, (name, description, url, page, start) in enumerate(sources, 1):
    path = CACHE / f"vocal-{index}.ogg"
    if not path.exists():
        request = urllib.request.Request(
            url,
            headers={
                "User-Agent": "NekoAudio/0.1 (https://github.com/neko233-com/ai-music-enhancer)"
            },
        )
        with urllib.request.urlopen(request) as response:
            path.write_bytes(response.read())
    with sf.SoundFile(path) as stream:
        rate = stream.samplerate
        stream.seek(start * rate)
        data = stream.read(12 * rate, dtype="float32", always_2d=True)
    common = gcd(rate, 24000)
    data = resample_poly(data, 24000 // common, rate // common, axis=0)
    fade = np.linspace(0, 1, 480, dtype=np.float32)
    data[:480] *= fade[:, None]
    data[-480:] *= fade[::-1, None]
    peak = np.max(np.abs(data))
    data *= 0.7 / max(peak, 0.001)
    sf.write(OUT / f"vocal-music-{index}.wav", data, 24000, subtype="PCM_16")
    manifest.append(
        dict(
            id=f"vocal-music-{index}",
            name=name,
            category="人声音乐",
            description=description,
            path=f"/demos/vocal-music-{index}.wav",
            source=page,
            license="Public domain (composition and historical recording)",
            excerpt_seconds=[start, start + 12],
            source_sha256=hashlib.sha256(path.read_bytes()).hexdigest(),
        )
    )
(OUT / "manifest.json").write_text(
    json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
)
print("Two public-domain singing excerpts imported")
