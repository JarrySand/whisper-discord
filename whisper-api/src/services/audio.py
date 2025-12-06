"""Audio processing utilities."""
import os
import logging
from typing import Optional, Tuple

logger = logging.getLogger(__name__)


def get_audio_duration(file_path: str) -> Optional[float]:
    """
    Get the duration of an audio file in seconds.

    Args:
        file_path: Path to the audio file

    Returns:
        Duration in seconds, or None if unable to determine
    """
    try:
        import subprocess

        result = subprocess.run(
            [
                "ffprobe",
                "-v", "quiet",
                "-show_entries", "format=duration",
                "-of", "csv=p=0",
                file_path,
            ],
            capture_output=True,
            text=True,
            timeout=10,
        )

        if result.returncode == 0 and result.stdout.strip():
            return float(result.stdout.strip())
    except Exception as e:
        logger.debug(f"Could not get audio duration: {e}")

    return None


def validate_audio_file(
    file_path: str,
    min_duration_ms: int = 500,
    max_duration_seconds: int = 300,
    max_file_size_mb: int = 25,
) -> Tuple[bool, Optional[str], Optional[dict]]:
    """
    Validate an audio file.

    Args:
        file_path: Path to the audio file
        min_duration_ms: Minimum duration in milliseconds
        max_duration_seconds: Maximum duration in seconds
        max_file_size_mb: Maximum file size in megabytes

    Returns:
        Tuple[bool, Optional[str], Optional[dict]]:
            (is_valid, error_code, error_details)
    """
    # Check file exists
    if not os.path.exists(file_path):
        return False, "FILE_NOT_FOUND", {"path": file_path}

    # Check file size
    file_size_mb = os.path.getsize(file_path) / (1024 * 1024)
    if file_size_mb > max_file_size_mb:
        return False, "FILE_TOO_LARGE", {
            "size_mb": round(file_size_mb, 2),
            "max_size_mb": max_file_size_mb,
        }

    # Check duration (optional, requires ffprobe)
    duration = get_audio_duration(file_path)
    if duration is not None:
        duration_ms = duration * 1000

        if duration_ms < min_duration_ms:
            return False, "AUDIO_TOO_SHORT", {
                "duration_ms": round(duration_ms),
                "min_duration_ms": min_duration_ms,
            }

        if duration > max_duration_seconds:
            return False, "AUDIO_TOO_LONG", {
                "duration_seconds": round(duration, 2),
                "max_duration_seconds": max_duration_seconds,
            }

    return True, None, None


def get_supported_formats() -> list:
    """Get list of supported audio formats."""
    return [
        ".ogg",
        ".opus",
        ".wav",
        ".mp3",
        ".m4a",
        ".flac",
        ".webm",
    ]


def is_supported_format(filename: str) -> bool:
    """
    Check if the file format is supported.

    Args:
        filename: Name of the file

    Returns:
        True if format is supported
    """
    if not filename:
        return False
    ext = os.path.splitext(filename)[1].lower()
    return ext in get_supported_formats()

