"""Pytest configuration and fixtures."""
import pytest
import os
import tempfile
from typing import Generator

from fastapi.testclient import TestClient


@pytest.fixture(scope="session")
def temp_dir() -> Generator[str, None, None]:
    """Create a temporary directory for tests."""
    with tempfile.TemporaryDirectory() as tmpdir:
        yield tmpdir


@pytest.fixture
def sample_audio_path(temp_dir: str) -> str:
    """Create a sample audio file for testing."""
    # Create a minimal WAV file (silence)
    import wave
    import struct

    filepath = os.path.join(temp_dir, "test_audio.wav")

    # Create 1 second of silence at 16kHz mono
    sample_rate = 16000
    duration = 1  # seconds
    num_samples = sample_rate * duration

    with wave.open(filepath, "w") as wav_file:
        wav_file.setnchannels(1)  # Mono
        wav_file.setsampwidth(2)  # 16-bit
        wav_file.setframerate(sample_rate)

        # Write silence (zeros)
        for _ in range(num_samples):
            wav_file.writeframes(struct.pack("h", 0))

    return filepath


@pytest.fixture
def sample_audio_bytes(sample_audio_path: str) -> bytes:
    """Get sample audio as bytes."""
    with open(sample_audio_path, "rb") as f:
        return f.read()


# Note: For full integration tests, you would need to:
# 1. Mock the WhisperService
# 2. Or use a smaller model for testing
# Example:
#
# @pytest.fixture
# def client():
#     from src.main import app
#     with TestClient(app) as client:
#         yield client

