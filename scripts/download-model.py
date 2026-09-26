"""Explicit online install step; the inference service never downloads weights."""

from pathlib import Path
import hashlib
import json
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
directory = ROOT / "models"
directory.mkdir(exist_ok=True)
target = directory / "audiosr_basic.bin"
revision = "74a47f49061a1e788e968cc43ad45c0b6243f37d"
expected = "8a3506b9619ed32435ce2c115604750c7bddb5ad8502be7b1a3131bde878aa01"


def digest(path):
    h = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(8 * 1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


if not target.exists() or digest(target) != expected:
    part = target.with_suffix(".part")
    url = f"https://huggingface.co/haoheliu/audiosr_basic/resolve/{revision}/pytorch_model.bin"
    print("Downloading official AudioSR basic model (about 6.2 GB)...", flush=True)
    urllib.request.urlretrieve(url, part)
    if digest(part) != expected:
        raise RuntimeError("Model checksum mismatch")
    part.replace(target)
(directory / "manifest.json").write_text(
    json.dumps(
        {
            "repository": "haoheliu/audiosr_basic",
            "revision": revision,
            "sha256": expected,
        },
        indent=2,
    )
)
print(f"Model verified: {expected}")
from transformers import RobertaTokenizer

# AudioSR imports this tokenizer even though the basic model is audio-conditioned.
RobertaTokenizer.from_pretrained(
    "roberta-base", cache_dir=str(directory / "huggingface")
)
print("Offline tokenizer cached")
