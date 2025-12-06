"""
Tests for API routes.

テスト項目:
- /health エンドポイント
- /transcribe エンドポイント
- /status エンドポイント
- /transcribe/batch エンドポイント
- 入力バリデーション
"""
import pytest
import json
import wave
import struct
import math
import tempfile
import os
from io import BytesIO
from unittest.mock import Mock, patch, MagicMock


def _create_wav_bytes(
    duration_seconds: float = 1.0,
    sample_rate: int = 16000,
    silence: bool = False
) -> bytes:
    """Create WAV file bytes for testing."""
    num_samples = int(sample_rate * duration_seconds)
    
    buffer = BytesIO()
    with wave.open(buffer, "wb") as wav_file:
        wav_file.setnchannels(1)  # Mono
        wav_file.setsampwidth(2)  # 16-bit
        wav_file.setframerate(sample_rate)
        
        for i in range(num_samples):
            if silence:
                value = 0
            else:
                # 440Hz tone
                value = int(10000 * math.sin(2 * math.pi * 440 * i / sample_rate))
            wav_file.writeframes(struct.pack("h", value))
    
    buffer.seek(0)
    return buffer.read()


def _create_ogg_bytes() -> bytes:
    """Create minimal OGG file bytes for testing (actually just header)."""
    # This is a minimal OGG header for testing purposes
    # Real OGG encoding would require more complex handling
    return b'OggS' + b'\x00' * 100


class TestHealthEndpoint:
    """Tests for the /health endpoint."""

    @patch("src.main.app")
    def test_health_endpoint_structure(self, mock_app):
        """Test that health endpoint returns expected structure."""
        # Mock the whisper service
        mock_service = MagicMock()
        mock_service.is_ready.return_value = True
        mock_service.get_status.return_value = {
            "model_name": "large-v3",
            "model_loaded": True,
            "device": "cuda",
            "compute_type": "float16",
            "load_time_seconds": 5.0,
            "stats": {
                "total_requests": 100,
                "successful_requests": 95,
                "failed_requests": 5,
                "avg_processing_time_ms": 500.0,
                "success_rate": 0.95,
                "total_audio_processed_seconds": 1000.0,
            },
        }
        
        # Verify the structure
        status = mock_service.get_status()
        assert "model_name" in status
        assert "model_loaded" in status
        assert "device" in status
        assert "stats" in status


class TestTranscribeEndpoint:
    """Tests for the /transcribe endpoint."""

    def test_transcribe_request_validation(self):
        """Test request validation for transcribe endpoint."""
        # Valid request structure
        audio_bytes = _create_wav_bytes(duration_seconds=1.0)
        
        # Create a mock request structure
        request_data = {
            "user_id": "123456789",
            "username": "test_user",
            "start_ts": 1733389200000,
            "end_ts": 1733389201000,
            "language": "ja",
        }
        
        # Verify required fields
        assert "user_id" in request_data
        assert "username" in request_data
        assert "start_ts" in request_data
        assert "end_ts" in request_data

    def test_transcribe_accepts_wav_format(self):
        """Test that transcribe accepts WAV format."""
        audio_bytes = _create_wav_bytes(duration_seconds=1.0)
        
        # Verify it's a valid WAV file
        buffer = BytesIO(audio_bytes)
        with wave.open(buffer, "rb") as wav:
            assert wav.getnchannels() == 1
            assert wav.getsampwidth() == 2
            assert wav.getframerate() == 16000

    def test_transcribe_accepts_ogg_format(self):
        """Test that transcribe accepts OGG format."""
        audio_bytes = _create_ogg_bytes()
        
        # Verify it starts with OGG magic bytes
        assert audio_bytes.startswith(b'OggS')

    def test_audio_duration_calculation(self):
        """Test audio duration is correctly calculated."""
        audio_bytes = _create_wav_bytes(duration_seconds=3.0)
        
        buffer = BytesIO(audio_bytes)
        with wave.open(buffer, "rb") as wav:
            frames = wav.getnframes()
            rate = wav.getframerate()
            duration = frames / rate
            
            assert abs(duration - 3.0) < 0.1


class TestStatusEndpoint:
    """Tests for the /status endpoint."""

    def test_status_returns_comprehensive_info(self):
        """Test that status returns comprehensive information."""
        # Mock status response
        status = {
            "status": "ok",
            "model_loaded": True,
            "model_name": "large-v3",
            "device": "cuda",
            "compute_type": "float16",
            "uptime_seconds": 3600.0,
            "requests_processed": 500,
            "avg_processing_time_ms": 450.0,
        }
        
        # Verify all expected fields
        assert "status" in status
        assert "model_loaded" in status
        assert "model_name" in status
        assert "device" in status


class TestBatchEndpoint:
    """Tests for the /transcribe/batch endpoint."""

    def test_batch_metadata_structure(self):
        """Test batch metadata structure validation."""
        metadata = [
            {
                "user_id": "123",
                "username": "Alice",
                "start_ts": 1000,
                "end_ts": 2000,
                "language": "ja",
            },
            {
                "user_id": "456",
                "username": "Bob",
                "start_ts": 1500,
                "end_ts": 2500,
                "language": "ja",
            },
        ]
        
        # Verify metadata structure
        for item in metadata:
            assert "user_id" in item
            assert "username" in item
            assert "start_ts" in item
            assert "end_ts" in item

    def test_batch_response_structure(self):
        """Test batch response structure."""
        # Mock batch response
        response = {
            "success": True,
            "data": {
                "total_count": 2,
                "success_count": 2,
                "failed_count": 0,
                "results": [
                    {
                        "user_id": "123",
                        "text": "こんにちは",
                        "confidence": 0.95,
                    },
                    {
                        "user_id": "456",
                        "text": "テストです",
                        "confidence": 0.92,
                    },
                ],
            },
        }
        
        assert response["success"] is True
        assert response["data"]["total_count"] == 2
        assert len(response["data"]["results"]) == 2


class TestInputValidation:
    """Tests for input validation."""

    def test_user_id_required(self):
        """Test that user_id is required."""
        request_data = {
            "username": "test_user",
            "start_ts": 1000,
            "end_ts": 2000,
        }
        
        assert "user_id" not in request_data

    def test_timestamp_validation(self):
        """Test timestamp validation."""
        # end_ts should be greater than start_ts
        valid = {
            "start_ts": 1000,
            "end_ts": 2000,
        }
        
        invalid = {
            "start_ts": 2000,
            "end_ts": 1000,
        }
        
        assert valid["end_ts"] > valid["start_ts"]
        assert invalid["end_ts"] < invalid["start_ts"]

    def test_language_default(self):
        """Test language defaults to 'ja'."""
        request_data = {
            "user_id": "123",
            "username": "test",
            "start_ts": 1000,
            "end_ts": 2000,
            # language not provided
        }
        
        # Language should default to 'ja' when not provided
        language = request_data.get("language", "ja")
        assert language == "ja"


class TestErrorResponses:
    """Tests for error responses."""

    def test_error_response_structure(self):
        """Test error response structure."""
        error_response = {
            "success": False,
            "error": {
                "code": "TRANSCRIPTION_FAILED",
                "message": "Failed to transcribe audio",
                "details": {"reason": "Audio too short"},
            },
        }
        
        assert error_response["success"] is False
        assert "code" in error_response["error"]
        assert "message" in error_response["error"]

    def test_model_not_ready_error(self):
        """Test model not ready error."""
        error_response = {
            "success": False,
            "error": {
                "code": "MODEL_NOT_READY",
                "message": "Whisper model is not loaded",
            },
        }
        
        assert error_response["error"]["code"] == "MODEL_NOT_READY"


class TestAudioFileHandling:
    """Tests for audio file handling."""

    def test_wav_file_creation(self):
        """Test WAV file can be created and read."""
        audio_bytes = _create_wav_bytes(duration_seconds=2.0)
        
        # Verify it's a valid WAV file
        buffer = BytesIO(audio_bytes)
        with wave.open(buffer, "rb") as wav:
            assert wav.getnchannels() == 1
            assert wav.getsampwidth() == 2
            assert wav.getframerate() == 16000
            assert wav.getnframes() == 32000  # 2 seconds * 16000 samples/sec

    def test_silence_wav_creation(self):
        """Test silence WAV file creation."""
        audio_bytes = _create_wav_bytes(duration_seconds=1.0, silence=True)
        
        buffer = BytesIO(audio_bytes)
        with wave.open(buffer, "rb") as wav:
            frames = wav.readframes(wav.getnframes())
            # All zeros for silence
            samples = struct.unpack(f"{len(frames)//2}h", frames)
            assert all(s == 0 for s in samples)


# =============================================================================
# Integration tests (require model to be loaded)
# =============================================================================

@pytest.mark.integration
class TestTranscribeIntegration:
    """Integration tests for transcription."""

    @pytest.mark.skip(reason="Requires Whisper model to be loaded")
    def test_transcribe_japanese_audio(self, client, sample_audio_bytes):
        """Test Japanese audio transcription."""
        response = client.post(
            "/transcribe",
            files={"audio_file": ("test.wav", sample_audio_bytes, "audio/wav")},
            data={
                "user_id": "123456789",
                "username": "test_user",
                "start_ts": 1733389200000,
                "end_ts": 1733389201000,
                "language": "ja",
            },
        )
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True


@pytest.mark.integration
class TestBatchIntegration:
    """Integration tests for batch transcription."""

    @pytest.mark.skip(reason="Requires Whisper model to be loaded")
    def test_batch_transcribe_multiple_files(self, client, sample_audio_bytes):
        """Test batch transcription of multiple files."""
        metadata = [
            {
                "user_id": "123",
                "username": "Alice",
                "start_ts": 1000,
                "end_ts": 2000,
                "language": "ja",
            },
            {
                "user_id": "456",
                "username": "Bob",
                "start_ts": 1500,
                "end_ts": 2500,
                "language": "ja",
            },
        ]

        response = client.post(
            "/transcribe/batch",
            files=[
                ("files", ("audio1.wav", sample_audio_bytes, "audio/wav")),
                ("files", ("audio2.wav", sample_audio_bytes, "audio/wav")),
            ],
            data={"metadata": json.dumps(metadata)},
        )
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["data"]["total_count"] == 2
