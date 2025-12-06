"""File operation utilities."""
import os
import tempfile
import shutil
import logging
import asyncio
from typing import Optional
from datetime import datetime, timedelta

logger = logging.getLogger(__name__)


async def save_upload_file(
    content: bytes,
    filename: str,
    temp_dir: str,
) -> str:
    """
    Save uploaded file content to a temporary file.

    Args:
        content: File content as bytes
        filename: Original filename (for extension)
        temp_dir: Directory to save temporary files

    Returns:
        Path to the saved temporary file
    """
    # Ensure temp directory exists
    os.makedirs(temp_dir, exist_ok=True)

    # Get file extension
    suffix = os.path.splitext(filename or ".ogg")[1]

    # Create temporary file
    with tempfile.NamedTemporaryFile(
        delete=False,
        suffix=suffix,
        dir=temp_dir,
    ) as tmp:
        tmp.write(content)
        return tmp.name


def cleanup_temp_file(file_path: str) -> bool:
    """
    Clean up a temporary file.

    Args:
        file_path: Path to the file to delete

    Returns:
        True if file was deleted successfully
    """
    try:
        if os.path.exists(file_path):
            os.unlink(file_path)
            return True
    except Exception as e:
        logger.warning(f"Failed to cleanup temp file {file_path}: {e}")
    return False


def cleanup_old_temp_files(
    temp_dir: str,
    max_age_seconds: int = 3600,
) -> int:
    """
    Clean up old temporary files.

    Args:
        temp_dir: Directory containing temporary files
        max_age_seconds: Maximum age of files to keep (default: 1 hour)

    Returns:
        Number of files deleted
    """
    deleted = 0
    cutoff = datetime.now() - timedelta(seconds=max_age_seconds)

    try:
        if not os.path.exists(temp_dir):
            return 0

        for filename in os.listdir(temp_dir):
            file_path = os.path.join(temp_dir, filename)

            try:
                if os.path.isfile(file_path):
                    mtime = datetime.fromtimestamp(os.path.getmtime(file_path))
                    if mtime < cutoff:
                        os.unlink(file_path)
                        deleted += 1
                        logger.debug(f"Deleted old temp file: {filename}")
            except Exception as e:
                logger.warning(f"Error cleaning up {filename}: {e}")

    except Exception as e:
        logger.error(f"Error during temp cleanup: {e}")

    if deleted > 0:
        logger.info(f"Cleaned up {deleted} old temp files")

    return deleted


async def periodic_cleanup(
    temp_dir: str,
    interval_seconds: int = 300,
    max_age_seconds: int = 3600,
) -> None:
    """
    Periodically clean up old temporary files.

    This should be run as a background task.

    Args:
        temp_dir: Directory containing temporary files
        interval_seconds: How often to run cleanup
        max_age_seconds: Maximum age of files to keep
    """
    while True:
        await asyncio.sleep(interval_seconds)
        try:
            cleanup_old_temp_files(temp_dir, max_age_seconds)
        except Exception as e:
            logger.error(f"Periodic cleanup error: {e}")


def ensure_directories(*dirs: str) -> None:
    """
    Ensure directories exist.

    Args:
        *dirs: Directory paths to create
    """
    for dir_path in dirs:
        os.makedirs(dir_path, exist_ok=True)
        logger.debug(f"Ensured directory exists: {dir_path}")

