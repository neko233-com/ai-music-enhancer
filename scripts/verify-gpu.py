"""Opt-in integration test: real AudioSR inference with network sockets blocked."""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import json
import socket
import time
import numpy as np
import soundfile as sf
from local.audio_pipeline import reconstruct, convert_rate


def blocked(*args, **kwargs):
    raise RuntimeError("Network access forbidden during offline GPU verification")


socket.socket.connect = blocked
socket.create_connection = blocked
report = []
OUT = ROOT / "artifacts"
OUT.mkdir(exist_ok=True)
for item in json.loads(
    (ROOT / "web/public/demos/manifest.json").read_text(encoding="utf-8")
):
    audio, rate = sf.read(
        ROOT / "web/public" / item["path"].lstrip("/"), dtype="float32", always_2d=True
    )
    audio = audio[rate : rate * 3]
    start = time.monotonic()
    result = reconstruct(audio, rate, steps=10, seed=233, mix=0.7)
    dry = convert_rate(audio, rate)
    assert result.shape == dry.shape
    assert np.isfinite(result).all() and np.max(np.abs(result)) <= 0.89126
    delta = float(np.sqrt(np.mean((result - dry) ** 2)))
    assert delta > 1e-6, "Inference did not change the waveform"

    def high_energy(x):
        spectrum = np.abs(np.fft.rfft(x[:, 0] * np.hanning(len(x)))) ** 2
        freq = np.fft.rfftfreq(len(x), 1 / 48000)
        return float(
            spectrum[(freq > 12000) & (freq < 22000)].sum() / max(spectrum.sum(), 1e-12)
        )

    entry = {
        "id": item["id"],
        "seconds": round(time.monotonic() - start, 2),
        "frames": len(result),
        "channels": result.shape[1],
        "difference_rms": delta,
        "input_high_band_ratio": high_energy(dry),
        "output_high_band_ratio": high_energy(result),
    }
    report.append(entry)
    print(json.dumps(entry), flush=True)
    sf.write(OUT / f"gpu-{item['id']}.wav", result, 48000, subtype="PCM_24")
import torch

(OUT / "gpu-verification.json").write_text(
    json.dumps(
        {
            "gpu": torch.cuda.get_device_name(),
            "torch": torch.__version__,
            "network": "blocked at socket.connect",
            "steps": 10,
            "samples": report,
        },
        indent=2,
    )
)
print("Six real GPU inferences passed with network blocked", flush=True)
