"""AudioSR adapter. All model loading is local; no runtime downloads."""

import os

os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["TRANSFORMERS_OFFLINE"] = "1"
os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
import math
from pathlib import Path
import tempfile
import numpy as np
import soundfile as sf
from scipy.signal import resample_poly, butter, sosfiltfilt

ROOT = Path(__file__).resolve().parents[1]
os.environ["TRANSFORMERS_CACHE"] = str(ROOT / "models/huggingface")
MODEL_PATH = Path(os.environ.get("NEKO_MODEL_PATH", ROOT / "models/audiosr_basic.bin"))
_model = None


def load_model():
    global _model
    if _model is None:
        if not MODEL_PATH.is_file():
            raise RuntimeError("AudioSR 模型未安装，请先运行 scripts/setup-local.ps1")
        import torch

        if not torch.cuda.is_available():
            raise RuntimeError(
                "未检测到可用的 CUDA GPU，请安装 NVIDIA 驱动及 CUDA 版 PyTorch"
            )
        from audiosr.latent_diffusion.models.ddpm import LatentDiffusion
        from audiosr.utils import default_audioldm_config

        config = default_audioldm_config("basic")
        config["model"]["params"]["device"] = "cuda:0"
        model = LatentDiffusion(**config["model"]["params"])
        # Only a pinned, locally verified official state-dict is loaded. Never user uploads.
        checkpoint = torch.load(str(MODEL_PATH), map_location="cpu", weights_only=True)
        model.load_state_dict(checkpoint["state_dict"], strict=True)
        del checkpoint
        _model = model.eval().to("cuda:0")
    return _model


def convert_rate(audio, source_rate, target_rate=48000):
    if source_rate == target_rate:
        return audio.astype(np.float32)
    common = math.gcd(source_rate, target_rate)
    return resample_poly(
        audio, target_rate // common, source_rate // common, axis=0
    ).astype(np.float32)


def reconstruct(
    audio,
    rate,
    steps=50,
    seed=233,
    mix=0.7,
    cutoff=0,
    progress=lambda *_: None,
    cancelled=lambda: False,
    infer=None,
):
    """Reconstruct 5.12 s windows with overlap-add, restoring duration and stereo channels.

    The wet path is RMS-matched before blending. This prevents the model's input
    normalization from being mistaken for improved quality. We preserve the dry
    low band using a complementary crossover; only the inferred high band is mixed.
    """
    if (
        audio.ndim != 2
        or not 1 <= audio.shape[1] <= 2
        or len(audio) == 0
        or not np.isfinite(audio).all()
    ):
        raise ValueError("Invalid mono/stereo PCM")
    if (
        not 8000 <= rate <= 192000
        or not 10 <= steps <= 100
        or not 0 <= seed <= 2147483647
        or not 0 <= mix <= 1
        or cutoff not in (0, 4000, 8000, 12000, 16000)
    ):
        raise ValueError("Invalid reconstruction settings")
    dry = convert_rate(audio, rate)
    if len(dry) / 48000 > 180:
        raise ValueError("AudioSR supports up to 180 seconds per job")
    if infer is None:
        model = load_model()
        from audiosr import super_resolution

        def infer(path, chunk_seed):
            generated = super_resolution(
                model, str(path), seed=chunk_seed, ddim_steps=steps, guidance_scale=3.5
            )
            return np.asarray(generated).reshape(-1)

    chunk_size, overlap = 245760, 24000  # 5.12 seconds, 0.5-second crossfade.
    hop = chunk_size - overlap
    starts = list(range(0, max(1, len(dry) - overlap), hop))
    result = np.zeros_like(dry)
    norm = np.zeros(len(dry), dtype=np.float32)
    for index, start in enumerate(starts):
        end = min(start + chunk_size, len(dry))
        length = end - start
        window = np.ones(length, dtype=np.float32)
        fade = min(overlap, length)
        if index > 0:
            window[:fade] = np.linspace(0, 1, fade)
        if index < len(starts) - 1:
            window[-fade:] = np.linspace(1, 0, fade)
        for channel in range(dry.shape[1]):
            if cancelled():
                raise InterruptedError("已取消 GPU 任务")
            progress(index * dry.shape[1] + channel, len(starts) * dry.shape[1])
            chunk = dry[start:end, channel]
            if np.max(np.abs(chunk)) < 1e-6:
                result[start:end, channel] += chunk * window
                continue
            feed = np.pad(chunk, (0, chunk_size - length))
            # Optional clean cutoff can help compressed audio with irregular bandwidth.
            if cutoff:
                feed = sosfiltfilt(
                    butter(8, cutoff, fs=48000, output="sos"), feed
                ).astype(np.float32)
            with tempfile.TemporaryDirectory(prefix="neko-chunk-") as directory:
                path = Path(directory) / "input.wav"
                sf.write(path, feed, 48000, subtype="FLOAT")
                wet = infer(path, seed + index)[:length].astype(np.float32)
            if len(wet) != length or not np.isfinite(wet).all():
                raise RuntimeError("AudioSR returned malformed audio")
            wet -= wet.mean()
            energy = np.sqrt(np.mean(wet**2))
            if energy > 1e-8:
                wet *= min(4.0, np.sqrt(np.mean(chunk**2)) / energy)
            # A complementary crossover preserves original low frequencies exactly.
            spectrum = np.abs(np.fft.rfft(feed)) ** 2
            edge = cutoff or min(
                16000,
                max(
                    2000,
                    float(np.searchsorted(np.cumsum(spectrum), 0.995 * spectrum.sum()))
                    * 48000
                    / len(feed),
                ),
            )
            sos = butter(4, min(edge, 20000), fs=48000, output="sos")
            # scipy requires enough frames for filtfilt; very short files are dry.
            if length > 32:
                low_wet = sosfiltfilt(sos, wet)
                low_dry = sosfiltfilt(sos, chunk)
                blended = chunk + mix * ((wet - low_wet) - (chunk - low_dry))
            else:
                blended = chunk
            result[start:end, channel] += blended.astype(np.float32) * window
        norm[start:end] += window
    result /= np.maximum(norm[:, None], 1e-8)
    peak = np.max(np.abs(result))
    if peak > 0.89125:
        result *= 0.89125 / peak
    return result
