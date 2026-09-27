"""Loopback-only offline AudioSR jobs, encoding, and the built web app."""

import os

os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["TRANSFORMERS_OFFLINE"] = "1"
os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import io
import subprocess
import tempfile
import threading
import time
import uuid
import numpy as np
import soundfile as sf
from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, JSONResponse
from fastapi.staticfiles import StaticFiles
from local.audio_pipeline import MODEL_PATH, ROOT, reconstruct, runtime_info

app = FastAPI(title="neko audio local", docs_url=None, redoc_url=None)
ORIGINS = [
    "https://music.neko233.com",
    "http://127.0.0.1:8765",
    "http://localhost:8765",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:4173",
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=ORIGINS,
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "X-Neko-Client"],
)
jobs = {}
lock = threading.Lock()
pool = ThreadPoolExecutor(max_workers=1)
MAX_BYTES = 80 * 1024 * 1024


@app.middleware("http")
async def boundary(request: Request, call_next):
    host = request.url.hostname
    if host not in ("localhost", "127.0.0.1", "::1", "testserver"):
        return JSONResponse({"detail": "Loopback host required"}, status_code=403)
    origin = request.headers.get("origin")
    if origin and origin not in ORIGINS:
        return JSONResponse({"detail": "Origin not allowed"}, status_code=403)
    if (
        request.method in ("POST", "DELETE")
        and request.headers.get("X-Neko-Client") != "1"
    ):
        return JSONResponse({"detail": "X-Neko-Client required"}, status_code=403)
    size = request.headers.get("content-length")
    limit = MAX_BYTES * 2 if request.url.path == "/api/export" else MAX_BYTES
    if size and (not size.isdigit() or int(size) > limit + 16384):
        return JSONResponse({"detail": "Upload exceeds 80 MB"}, status_code=413)
    response = await call_next(request)
    response.headers["Cache-Control"] = (
        "no-store" if request.url.path.startswith("/api/") else "no-cache"
    )
    if origin in ORIGINS:
        response.headers["Access-Control-Allow-Private-Network"] = "true"
    return response


def prune():
    now = time.time()
    for key in list(jobs):
        if now - jobs[key]["created"] > 3600 and jobs[key]["status"] not in (
            "queued",
            "running",
        ):
            del jobs[key]


def load_audio(data):
    try:
        info = sf.info(io.BytesIO(data))
        if (
            info.channels not in (1, 2)
            or not 8000 <= info.samplerate <= 192000
            or not 0 < info.duration <= 180
        ):
            raise ValueError("Use mono/stereo 8–192 kHz audio, 0–180 seconds")
        audio, rate = sf.read(io.BytesIO(data), dtype="float32", always_2d=True)
        if not np.isfinite(audio).all():
            raise ValueError("Invalid PCM samples")
        return audio, rate
    except Exception as exc:
        raise HTTPException(422, str(exc)) from exc


@app.get("/api/health")
def health():
    try:
        runtime = runtime_info()
        import torch

        ready = MODEL_PATH.is_file()
        error = None if ready else "请运行 scripts/setup-local.ps1 安装本机模型"
    except (ImportError, RuntimeError, ValueError) as exc:
        runtime = {
            "device": "unavailable",
            "processor": "本机运行环境未就绪",
            "threads": 0,
        }
        ready, error = False, str(exc)
    return {
        "ready": ready,
        **runtime,
        "gpu": runtime["processor"],  # Compatibility with already-cached web clients.
        "model": "AudioSR basic",
        "offline": True,
        "error": error,
    }


def run_job(job_id, audio, rate, settings):
    state = jobs[job_id]
    if state["cancel"]:
        state["status"] = "cancelled"
        return
    state.update(status="running", message="加载本地 AudioSR 模型，首次加载可能较慢…")

    def progress(done, total):
        state.update(
            message=f"本机重建 {done + 1}/{total} 个片段 · 正在推理，请耐心等待",
            progress=done / total,
        )

    try:
        output = reconstruct(
            audio,
            rate,
            progress=progress,
            cancelled=lambda: state["cancel"],
            **settings,
        )
        if state["cancel"]:
            raise InterruptedError("已取消")
        buffer = io.BytesIO()
        sf.write(buffer, output, 48000, format="WAV", subtype="FLOAT")
        state.update(
            status="succeeded",
            message="细节重建完成",
            progress=1,
            audio=buffer.getvalue(),
        )
    except InterruptedError as exc:
        state.update(status="cancelled", error=str(exc))
    except Exception as exc:
        state.update(status="failed", error=str(exc))
        import traceback

        traceback.print_exc()
        try:
            import torch

            if os.environ.get("NEKO_DEVICE") == "cuda":
                torch.cuda.empty_cache()
        except Exception:
            pass


@app.post("/api/jobs", status_code=202)
async def create_job(
    file: UploadFile = File(...),
    steps: int = Form(50),
    seed: int = Form(233),
    mix: float = Form(0.7),
    cutoff: int = Form(0),
):
    if (
        not 10 <= steps <= 100
        or not 0 <= seed <= 2147483647
        or not 0 <= mix <= 1
        or cutoff not in (0, 4000, 8000, 12000, 16000)
    ):
        raise HTTPException(422, "Invalid reconstruction settings")
    data = await file.read(MAX_BYTES + 1)
    await file.close()
    if len(data) > MAX_BYTES:
        raise HTTPException(413, "Upload exceeds 80 MB")
    audio, rate = load_audio(data)
    with lock:
        prune()
        if any(s["status"] in ("queued", "running") for s in jobs.values()):
            raise HTTPException(409, "本机模型正忙，请等待当前任务完成")
        # Keep at most four audio results in memory.
        while len(jobs) >= 4:
            jobs.pop(next(iter(jobs)))
        job_id = uuid.uuid4().hex
        jobs[job_id] = {
            "id": job_id,
            "status": "queued",
            "created": time.time(),
            "progress": 0,
            "cancel": False,
        }
        pool.submit(
            run_job,
            job_id,
            audio,
            rate,
            dict(steps=steps, seed=seed, mix=mix, cutoff=cutoff),
        )
    return {"id": job_id, "status": "queued"}


def get_job(job_id):
    if job_id not in jobs:
        raise HTTPException(404, "Job not found or expired")
    return jobs[job_id]


@app.get("/api/jobs/{job_id}")
def status(job_id: str):
    return {k: v for k, v in get_job(job_id).items() if k not in ("audio", "cancel")}


@app.delete("/api/jobs/{job_id}")
def cancel(job_id: str):
    state = get_job(job_id)
    state["cancel"] = True
    return {"status": "cancelling"}


@app.get("/api/jobs/{job_id}/audio")
def audio(job_id: str):
    state = get_job(job_id)
    if state["status"] != "succeeded":
        raise HTTPException(409, "Audio not ready")
    return Response(state["audio"], media_type="audio/wav")


@app.post("/api/export")
def export(
    file: UploadFile = File(...),
    format: str = Form(...),
    bits: int = Form(24),
    bitrate: int = Form(320),
):
    if (
        format not in ("flac", "mp3")
        or bits not in (16, 24, 32, 33)
        or bitrate not in (64, 96, 128, 160, 192, 224, 256, 320)
    ):
        raise HTTPException(422, "Invalid export options")
    if format == "flac" and bits not in (16, 24):
        raise HTTPException(422, "FLAC supports 16/24 bit")
    data = file.file.read(MAX_BYTES * 2 + 1)
    file.file.close()
    if len(data) > MAX_BYTES * 2:
        raise HTTPException(413, "Export exceeds 160 MB")
    pcm, rate = load_audio(data)
    if format == "flac":
        buffer = io.BytesIO()
        sf.write(buffer, pcm, rate, format="FLAC", subtype=f"PCM_{bits}")
        return Response(buffer.getvalue(), media_type="audio/flac")
    if rate not in (44100, 48000):
        raise HTTPException(422, "MP3 requires 44.1/48 kHz")
    import imageio_ffmpeg

    with tempfile.TemporaryDirectory(prefix="neko-export-") as directory:
        source = Path(directory) / "input.wav"
        target = Path(directory) / "output.mp3"
        source.write_bytes(data)
        subprocess.run(
            [
                imageio_ffmpeg.get_ffmpeg_exe(),
                "-v",
                "error",
                "-nostdin",
                "-i",
                str(source),
                "-codec:a",
                "libmp3lame",
                "-b:a",
                f"{bitrate}k",
                str(target),
            ],
            check=True,
            timeout=120,
            capture_output=True,
        )
        return Response(target.read_bytes(), media_type="audio/mpeg")


if (ROOT / "web/dist").is_dir():
    app.mount("/", StaticFiles(directory=ROOT / "web/dist", html=True), name="web")

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8765, access_log=False)
