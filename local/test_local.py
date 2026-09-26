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
