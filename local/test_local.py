import io
import numpy as np
import soundfile as sf
from fastapi.testclient import TestClient
from local.server import app, jobs
from local.audio_pipeline import reconstruct

client = TestClient(app)


def wav():
    b = io.BytesIO()
    sf.write(b, np.zeros((4800, 2)), 48000, format="WAV", subtype="FLOAT")
    return b.getvalue()


def test_origin_and_host_boundaries():
    assert (
        client.post(
            "/api/jobs", headers={"Origin": "https://evil.test", "X-Neko-Client": "1"}
        ).status_code
        == 403
    )
    assert client.post("/api/jobs").status_code == 403
    assert client.get("/api/health", headers={"Host": "evil.test"}).status_code == 403


def test_export_real_flac_and_reject_invalid_bits():
    result = client.post(
        "/api/export",
        headers={"X-Neko-Client": "1"},
        data={"format": "flac", "bits": "24"},
        files={"file": ("in.wav", wav())},
    )
    assert result.status_code == 200
    assert result.content[:4] == b"fLaC"
    assert sf.info(io.BytesIO(result.content)).subtype == "PCM_24"
    assert (
        client.post(
            "/api/export",
            headers={"X-Neko-Client": "1"},
            data={"format": "flac", "bits": "32"},
            files={"file": ("in.wav", wav())},
        ).status_code
        == 422
    )


def test_bad_upload_and_unknown_job():
    assert (
        client.post(
            "/api/jobs",
            headers={"X-Neko-Client": "1"},
            files={"file": ("bad.wav", b"bad")},
        ).status_code
        == 422
    )
    assert client.get("/api/jobs/nonexistent").status_code == 404


def test_overlap_add_preserves_duration_channels_and_silence():
    def infer(path, seed):
        return sf.read(path, dtype="float32")[0]

    audio = np.zeros((48000 * 6, 2), dtype=np.float32)
    t = np.arange(len(audio)) / 48000
    audio[:, 0] = 0.1 * np.sin(2 * np.pi * 440 * t)
    result = reconstruct(audio, 48000, infer=infer)
    assert result.shape == audio.shape
    assert np.isfinite(result).all()
    assert np.max(np.abs(result[:, 1])) == 0
    assert np.max(np.abs(result - audio)) < 0.003


def test_cancel_stops_between_chunks():
    import pytest

    with pytest.raises(InterruptedError):
        reconstruct(
            np.ones((4800, 1), dtype=np.float32) * 0.1,
            48000,
            cancelled=lambda: True,
            infer=lambda *_: None,
        )


def test_mp3_real_encoding():
    result = client.post(
        "/api/export",
        headers={"X-Neko-Client": "1"},
        data={"format": "mp3", "bitrate": "192"},
        files={"file": ("in.wav", wav())},
    )
    assert result.status_code == 200
    assert len(result.content) > 1000


def test_cpu_default_does_not_query_cuda(monkeypatch):
    import sys
    from types import SimpleNamespace
    from local.audio_pipeline import runtime_info

    class NoGpu:
        def __getattr__(self, name):
            raise AssertionError("Default CPU path must not access CUDA")

    monkeypatch.setitem(sys.modules, "torch", SimpleNamespace(cuda=NoGpu()))
    monkeypatch.delenv("NEKO_DEVICE", raising=False)
    monkeypatch.setenv("NEKO_CPU_THREADS", "2")
    assert runtime_info() == {
        "device": "cpu",
        "processor": "CPU · 2 线程",
        "threads": 2,
    }


def test_cpu_health_ready_without_gpu_and_missing_model_is_explicit(
    monkeypatch, tmp_path
):
    import sys
    from types import SimpleNamespace
    from local import server

    monkeypatch.setitem(sys.modules, "torch", SimpleNamespace())
    monkeypatch.setenv("NEKO_DEVICE", "cpu")
    model = tmp_path / "model.bin"
    monkeypatch.setattr(server, "MODEL_PATH", model)
    assert client.get("/api/health").json()["ready"] is False
    model.write_bytes(b"test fixture")
    state = client.get("/api/health").json()
    assert state["ready"] and state["device"] == "cpu" and state["error"] is None


def test_invalid_device_and_threads_fail_clearly(monkeypatch):
    monkeypatch.setenv("NEKO_DEVICE", "unrecognized")
    assert "NEKO_DEVICE" in client.get("/api/health").json()["error"]
    monkeypatch.setenv("NEKO_DEVICE", "cpu")
    monkeypatch.setenv("NEKO_CPU_THREADS", "0")
    assert "NEKO_CPU_THREADS" in client.get("/api/health").json()["error"]
