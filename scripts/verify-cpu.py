"""Real CPU-only AudioSR inference with all outgoing socket connections blocked."""

import os
import sys
from pathlib import Path

os.environ["NEKO_DEVICE"] = "cpu"
os.environ["CUDA_VISIBLE_DEVICES"] = "-1"
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import json
import socket
import time
import numpy as np
import soundfile as sf
import torch
from local.audio_pipeline import reconstruct, convert_rate, load_model, runtime_info

assert torch.version.cuda is None, (
    "Install the CPU-only PyTorch wheel for this verification"
)
assert not torch.cuda.is_available()


def blocked(*args, **kwargs):
    raise RuntimeError(
        "External connections / CUDA initialization forbidden in CPU verification"
    )


socket.socket.connect = blocked
socket.create_connection = blocked
torch.cuda._lazy_init = blocked
out = ROOT / "artifacts"
out.mkdir(exist_ok=True)
source, rate = sf.read(
    ROOT / "web/public/demos/voice-1.wav", dtype="float32", always_2d=True
)
source = source[rate : rate * 3]
sf.write(out / "cpu-input.wav", source, rate, subtype="PCM_24")
started = time.monotonic()
result = reconstruct(source, rate, steps=10, seed=233)
elapsed = time.monotonic() - started
dry = convert_rate(source, rate)
assert result.shape == dry.shape
assert np.isfinite(result).all() and np.max(np.abs(result)) <= 0.89126
delta = float(np.sqrt(np.mean((result - dry) ** 2)))
assert delta > 1e-6
devices = sorted({str(parameter.device) for parameter in load_model().parameters()})
assert devices == ["cpu"], devices
sf.write(out / "cpu-enhanced.wav", result, 48000, subtype="PCM_24")
report = {
    **runtime_info(),
    "torch": torch.__version__,
    "cuda_runtime": torch.version.cuda,
    "model_devices": devices,
    "network": "blocked at socket.connect and create_connection",
    "input_seconds": len(source) / rate,
    "frames": len(result),
    "channels": result.shape[1],
    "steps": 10,
    "cold_seconds": round(elapsed, 2),
    "difference_rms": delta,
    "peak": float(np.max(np.abs(result))),
}
(out / "cpu-verification.json").write_text(
    json.dumps(report, indent=2), encoding="utf-8"
)
print(json.dumps(report, indent=2), flush=True)
