"""
T-3: Whisper推論テスト - WhisperService

目的: ノイズ・重複音声への耐性

テスト項目:
- クリアな日本語音声の文字起こし
- ノイズを含む音声の処理
- 短い音声（500ms未満）の処理
- 無音ファイルの処理
- 統計情報の記録
"""
import pytest
from unittest.mock import Mock, patch, MagicMock
import wave
import struct
import math
import tempfile
import os

from src.core.config import WhisperConfig
from src.services.whisper import WhisperService, TranscriptionStats


class TestTranscriptionStats:
    """Tests for TranscriptionStats."""

    def test_initial_values(self):
        """Test initial statistics values."""
        stats = TranscriptionStats()
        assert stats.total_requests == 0
        assert stats.successful_requests == 0
        assert stats.failed_requests == 0
        assert stats.avg_processing_time == 0.0

    def test_record_success(self):
        """Test recording successful transcription."""
        stats = TranscriptionStats()
        stats.record(processing_time=1.5, success=True, audio_duration_seconds=10.0)

        assert stats.total_requests == 1
        assert stats.successful_requests == 1
        assert stats.failed_requests == 0
        assert stats.total_processing_time == 1.5
        assert stats.total_audio_seconds == 10.0

    def test_record_failure(self):
        """Test recording failed transcription."""
        stats = TranscriptionStats()
        stats.record(processing_time=0.5, success=False)

        assert stats.total_requests == 1
        assert stats.successful_requests == 0
        assert stats.failed_requests == 1

    def test_avg_processing_time(self):
        """Test average processing time calculation."""
        stats = TranscriptionStats()
        stats.record(processing_time=1.0, success=True)
        stats.record(processing_time=2.0, success=True)
        stats.record(processing_time=3.0, success=True)

        assert stats.avg_processing_time == 2.0

    def test_success_rate(self):
        """Test success rate calculation."""
        stats = TranscriptionStats()
        stats.record(processing_time=1.0, success=True)
        stats.record(processing_time=1.0, success=True)
        stats.record(processing_time=1.0, success=False)

        assert stats.success_rate == pytest.approx(2 / 3)

    def test_success_rate_no_requests(self):
        """Test success rate when no requests made."""
        stats = TranscriptionStats()
        assert stats.success_rate == 1.0

    def test_multiple_recordings(self):
        """Test multiple recordings with mixed results."""
        stats = TranscriptionStats()
        
        stats.record(processing_time=0.5, success=True, audio_duration_seconds=5.0)
        stats.record(processing_time=1.0, success=True, audio_duration_seconds=10.0)
        stats.record(processing_time=0.3, success=False, audio_duration_seconds=3.0)
        stats.record(processing_time=0.8, success=True, audio_duration_seconds=8.0)
        
        assert stats.total_requests == 4
        assert stats.successful_requests == 3
        assert stats.failed_requests == 1
        assert stats.total_processing_time == pytest.approx(2.6)
        assert stats.total_audio_seconds == 26.0


class TestWhisperService:
    """Tests for WhisperService."""

    def test_init(self):
        """Test service initialization."""
        config = WhisperConfig()
        service = WhisperService(config)

        assert service.model is None
        assert service.is_ready() is False

    def test_is_ready_before_load(self):
        """Test is_ready returns False before model load."""
        config = WhisperConfig()
        service = WhisperService(config)
        assert service.is_ready() is False

    @patch("faster_whisper.WhisperModel")
    def test_load_model(self, mock_whisper_model):
        """Test model loading."""
        config = WhisperConfig(model_name="tiny", device="cpu", compute_type="int8")
        service = WhisperService(config)

        service.load_model()

        assert service.is_ready() is True
        assert service.load_time is not None
        mock_whisper_model.assert_called_once()

    def test_transcribe_without_model(self):
        """Test transcribe raises error when model not loaded."""
        config = WhisperConfig()
        service = WhisperService(config)

        with pytest.raises(RuntimeError, match="Model not loaded"):
            service.transcribe("test.wav")

    def test_get_status(self):
        """Test get_status returns correct structure."""
        config = WhisperConfig(model_name="large-v3")
        service = WhisperService(config)
        status = service.get_status()

        assert "model_name" in status
        assert status["model_name"] == "large-v3"
        assert "model_loaded" in status
        assert status["model_loaded"] is False
        assert "stats" in status

    def test_get_status_stats_structure(self):
        """Test get_status returns correct stats structure."""
        config = WhisperConfig()
        service = WhisperService(config)
        status = service.get_status()
        
        stats = status["stats"]
        assert "total_requests" in stats
        assert "successful_requests" in stats
        assert "failed_requests" in stats
        assert "avg_processing_time_ms" in stats
        assert "success_rate" in stats
        assert "total_audio_processed_seconds" in stats

    def test_device_property(self):
        """Test device property."""
        config = WhisperConfig(device="cpu")
        service = WhisperService(config)
        
        assert service.device == "cpu"

    def test_compute_type_property(self):
        """Test compute_type property."""
        config = WhisperConfig(compute_type="int8")
        service = WhisperService(config)
        
        assert service.compute_type == "int8"


class TestWhisperServiceTranscription:
    """T-3: Whisper推論テスト - 実際の文字起こし機能のテスト"""

    @pytest.fixture
    def mock_whisper_service(self):
        """Create a mock whisper service for transcription tests."""
        config = WhisperConfig(model_name="tiny", device="cpu", compute_type="int8")
        service = WhisperService(config)
        
        # Mock the model
        mock_model = MagicMock()
        service.model = mock_model
        
        return service, mock_model

    def test_transcribe_clear_japanese(self, mock_whisper_service, temp_dir):
        """Test transcription of clear Japanese audio."""
        service, mock_model = mock_whisper_service
        
        # Mock segment with clear text
        mock_segment = MagicMock()
        mock_segment.text = " こんにちは、テストです。"
        mock_segment.avg_logprob = -0.3
        
        mock_info = MagicMock()
        mock_info.duration = 2.0
        
        mock_model.transcribe.return_value = (iter([mock_segment]), mock_info)
        
        filepath = os.path.join(temp_dir, "test_clear_japanese.wav")
        _create_test_wav(filepath, duration_seconds=2.0)
        
        text, confidence, processing_time = service.transcribe(filepath, language="ja")
        
        assert "こんにちは" in text
        assert confidence > 0.5
        assert processing_time > 0

    def test_transcribe_noisy_audio(self, mock_whisper_service, temp_dir):
        """Test transcription handles noisy audio gracefully."""
        service, mock_model = mock_whisper_service
        
        # Mock segment with lower confidence (noisy audio)
        mock_segment = MagicMock()
        mock_segment.text = " よく聞こえませんでした"
        mock_segment.avg_logprob = -1.5  # Lower confidence
        
        mock_info = MagicMock()
        mock_info.duration = 3.0
        
        mock_model.transcribe.return_value = (iter([mock_segment]), mock_info)
        
        filepath = os.path.join(temp_dir, "test_noisy.wav")
        _create_test_wav(filepath, duration_seconds=3.0, add_noise=True)
        
        text, confidence, processing_time = service.transcribe(filepath, language="ja")
        
        assert isinstance(text, str)
        assert 0.0 <= confidence <= 1.0
        assert processing_time > 0

    def test_transcribe_short_audio(self, mock_whisper_service, temp_dir):
        """Test transcription of short audio (under 500ms)."""
        service, mock_model = mock_whisper_service
        
        # Mock empty result for very short audio
        mock_info = MagicMock()
        mock_info.duration = 0.3
        
        mock_model.transcribe.return_value = (iter([]), mock_info)
        
        filepath = os.path.join(temp_dir, "test_short.wav")
        _create_test_wav(filepath, duration_seconds=0.3)
        
        text, confidence, processing_time = service.transcribe(filepath, language="ja")
        
        assert text == ""
        assert confidence == 0.0

    def test_transcribe_silence(self, mock_whisper_service, temp_dir):
        """Test transcription of silence."""
        service, mock_model = mock_whisper_service
        
        # Mock empty result for silence
        mock_info = MagicMock()
        mock_info.duration = 1.0
        
        mock_model.transcribe.return_value = (iter([]), mock_info)
        
        filepath = os.path.join(temp_dir, "test_silence.wav")
        _create_test_wav(filepath, duration_seconds=1.0, silence=True)
        
        text, confidence, processing_time = service.transcribe(filepath, language="ja")
        
        assert text == "" or len(text.strip()) == 0

    def test_transcribe_records_stats(self, mock_whisper_service, temp_dir):
        """Test that transcription records statistics."""
        service, mock_model = mock_whisper_service
        
        mock_segment = MagicMock()
        mock_segment.text = " テスト"
        mock_segment.avg_logprob = -0.5
        
        mock_info = MagicMock()
        mock_info.duration = 1.0
        
        mock_model.transcribe.return_value = (iter([mock_segment]), mock_info)
        
        filepath = os.path.join(temp_dir, "test_stats.wav")
        _create_test_wav(filepath, duration_seconds=1.0)
        
        # Initial stats
        assert service.stats.total_requests == 0
        
        # Transcribe
        service.transcribe(filepath, language="ja")
        
        # Check stats updated
        assert service.stats.total_requests == 1
        assert service.stats.successful_requests == 1

    def test_transcribe_multiple_segments(self, mock_whisper_service, temp_dir):
        """Test transcription with multiple segments."""
        service, mock_model = mock_whisper_service
        
        mock_segments = []
        for i, text in enumerate(["こんにちは", "テストです", "よろしく"]):
            seg = MagicMock()
            seg.text = f" {text}"
            seg.avg_logprob = -0.3 - (i * 0.1)
            mock_segments.append(seg)
        
        mock_info = MagicMock()
        mock_info.duration = 5.0
        
        mock_model.transcribe.return_value = (iter(mock_segments), mock_info)
        
        filepath = os.path.join(temp_dir, "test_multiple_segments.wav")
        _create_test_wav(filepath, duration_seconds=5.0)
        
        text, confidence, processing_time = service.transcribe(filepath, language="ja")
        
        assert "こんにちは" in text
        assert "テストです" in text
        assert "よろしく" in text


class TestWhisperServiceEdgeCases:
    """Edge case tests for WhisperService."""

    @patch("faster_whisper.WhisperModel")
    def test_transcribe_exception_handling(self, mock_whisper_model, temp_dir):
        """Test that exceptions are handled and stats recorded."""
        config = WhisperConfig(model_name="tiny", device="cpu", compute_type="int8")
        service = WhisperService(config)
        service.load_model()
        
        # Mock transcription to raise an exception
        mock_whisper_model.return_value.transcribe.side_effect = Exception("Test error")
        service.model = mock_whisper_model.return_value
        
        filepath = os.path.join(temp_dir, "test_exception.wav")
        _create_test_wav(filepath, duration_seconds=1.0)
        
        with pytest.raises(Exception, match="Test error"):
            service.transcribe(filepath)
        
        # Check failure was recorded
        assert service.stats.failed_requests == 1


def _create_test_wav(
    filepath: str,
    duration_seconds: float = 1.0,
    sample_rate: int = 16000,
    silence: bool = False,
    add_noise: bool = False
) -> None:
    """Create a test WAV file.
    
    Args:
        filepath: Path to write the WAV file
        duration_seconds: Duration in seconds
        sample_rate: Sample rate in Hz
        silence: If True, create silence (all zeros)
        add_noise: If True, add random noise
    """
    num_samples = int(sample_rate * duration_seconds)
    
    with wave.open(filepath, "w") as wav_file:
        wav_file.setnchannels(1)  # Mono
        wav_file.setsampwidth(2)  # 16-bit
        wav_file.setframerate(sample_rate)
        
        for i in range(num_samples):
            if silence:
                value = 0
            elif add_noise:
                # 440Hz tone with noise
                import random
                tone = int(5000 * math.sin(2 * math.pi * 440 * i / sample_rate))
                noise = random.randint(-3000, 3000)
                value = max(-32768, min(32767, tone + noise))
            else:
                # Pure 440Hz tone
                value = int(10000 * math.sin(2 * math.pi * 440 * i / sample_rate))
            
            wav_file.writeframes(struct.pack("h", value))
