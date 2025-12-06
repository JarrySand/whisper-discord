"""API route definitions."""
import time
import json
import logging
from typing import Optional, List

from fastapi import APIRouter, UploadFile, File, Form, HTTPException

from .schemas import (
    TranscribeResponse,
    TranscriptionResult,
    HealthResponse,
    StatusResponse,
    ErrorDetail,
    BatchMetadata,
    BatchResult,
    BatchTranscribeResponse,
)
from ..services.whisper import WhisperService
from ..services.audio import is_supported_format, validate_audio_file
from ..core.config import Config
from ..utils.file import save_upload_file, cleanup_temp_file

logger = logging.getLogger(__name__)

# Router for transcription endpoints
router = APIRouter()

# These will be set by main.py
whisper_service: Optional[WhisperService] = None
config: Optional[Config] = None
start_time: Optional[float] = None


def init_router(
    service: WhisperService,
    app_config: Config,
    app_start_time: float,
) -> None:
    """Initialize the router with dependencies."""
    global whisper_service, config, start_time
    whisper_service = service
    config = app_config
    start_time = app_start_time


@router.post("/transcribe", response_model=TranscribeResponse)
async def transcribe(
    audio_file: UploadFile = File(...),
    user_id: str = Form(...),
    username: str = Form(...),
    display_name: Optional[str] = Form(None),
    start_ts: int = Form(...),
    end_ts: int = Form(...),
    language: str = Form("ja"),
    filter_aizuchi: bool = Form(True),
    hotwords: Optional[str] = Form(None),
) -> TranscribeResponse:
    """
    Transcribe an audio file.

    Args:
        audio_file: Audio file to transcribe
        user_id: Discord User ID
        username: Discord Username
        display_name: Server display name (optional)
        start_ts: Start timestamp (Unix ms)
        end_ts: End timestamp (Unix ms)
        language: Language hint (default: "ja")

    Returns:
        Transcription result
    """
    if whisper_service is None or config is None:
        raise HTTPException(503, detail="Service not initialized")

    if not whisper_service.is_ready():
        return TranscribeResponse(
            success=False,
            error=ErrorDetail(
                code="MODEL_NOT_LOADED",
                message="Whisper model is not loaded yet",
            ),
        )

    request_start = time.time()

    # Validate file format
    if not is_supported_format(audio_file.filename or ""):
        return TranscribeResponse(
            success=False,
            error=ErrorDetail(
                code="INVALID_FORMAT",
                message="Unsupported audio format",
                details={"filename": audio_file.filename},
            ),
        )

    # Read file content
    content = await audio_file.read()
    file_size_mb = len(content) / (1024 * 1024)

    # Check file size
    if file_size_mb > config.server.max_file_size_mb:
        return TranscribeResponse(
            success=False,
            error=ErrorDetail(
                code="FILE_TOO_LARGE",
                message=f"File too large: {file_size_mb:.2f}MB (max: {config.server.max_file_size_mb}MB)",
                details={
                    "size_mb": round(file_size_mb, 2),
                    "max_size_mb": config.server.max_file_size_mb,
                },
            ),
        )

    # Save to temporary file
    tmp_path = await save_upload_file(
        content,
        audio_file.filename or "audio.ogg",
        config.server.temp_dir,
    )

    try:
        # Validate audio file
        is_valid, error_code, error_details = validate_audio_file(
            tmp_path,
            min_duration_ms=config.server.min_audio_duration_ms,
            max_duration_seconds=config.server.max_audio_duration_seconds,
            max_file_size_mb=config.server.max_file_size_mb,
        )

        if not is_valid:
            return TranscribeResponse(
                success=False,
                error=ErrorDetail(
                    code=error_code or "VALIDATION_FAILED",
                    message=f"Audio validation failed: {error_code}",
                    details=error_details,
                ),
            )

        # Parse hotwords from comma-separated string
        hotwords_list = None
        if hotwords:
            hotwords_list = [w.strip() for w in hotwords.split(",") if w.strip()]
        
        # Perform transcription
        text, confidence, processing_time = whisper_service.transcribe(
            tmp_path,
            language=language,
            filter_aizuchi=filter_aizuchi,
            additional_hotwords=hotwords_list,
        )

        total_time_ms = int((time.time() - request_start) * 1000)

        logger.info(
            f"Transcription complete: user={username}, "
            f"text_len={len(text)}, confidence={confidence:.2f}, "
            f"time={total_time_ms}ms"
        )

        return TranscribeResponse(
            success=True,
            data=TranscriptionResult(
                user_id=user_id,
                username=username,
                display_name=display_name,
                text=text,
                start_ts=start_ts,
                end_ts=end_ts,
                duration_ms=end_ts - start_ts,
                language=language,
                confidence=round(confidence, 3),
                processing_time_ms=total_time_ms,
            ),
        )

    except Exception as e:
        logger.error(f"Transcription error: {e}")
        return TranscribeResponse(
            success=False,
            error=ErrorDetail(
                code="TRANSCRIPTION_FAILED",
                message=str(e),
            ),
        )

    finally:
        # Clean up temporary file
        cleanup_temp_file(tmp_path)


@router.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    """
    Health check endpoint.

    Returns:
        Health status including model state and statistics
    """
    if whisper_service is None or config is None:
        raise HTTPException(503, detail="Service not initialized")

    uptime = int(time.time() - start_time) if start_time else 0

    return HealthResponse(
        status="healthy" if whisper_service.is_ready() else "loading",
        model_loaded=whisper_service.is_ready(),
        model_name=config.whisper.model_name,
        device=whisper_service.device,
        compute_type=whisper_service.compute_type,
        uptime_seconds=uptime,
        requests_processed=whisper_service.stats.total_requests,
        avg_processing_time_ms=round(whisper_service.stats.avg_processing_time * 1000, 2),
    )


@router.get("/status", response_model=StatusResponse)
async def status() -> StatusResponse:
    """
    Detailed status endpoint.

    Returns:
        Detailed status including server, model, and statistics
    """
    if whisper_service is None or config is None:
        raise HTTPException(503, detail="Service not initialized")

    import sys

    uptime = int(time.time() - start_time) if start_time else 0
    hours, remainder = divmod(uptime, 3600)
    minutes, seconds = divmod(remainder, 60)
    uptime_str = f"{hours}:{minutes:02d}:{seconds:02d}"

    service_status = whisper_service.get_status()

    return StatusResponse(
        server={
            "version": "1.0.0",
            "uptime": uptime_str,
            "uptime_seconds": uptime,
            "python_version": sys.version.split()[0],
        },
        model={
            "name": config.whisper.model_name,
            "loaded": whisper_service.is_ready(),
            "device": whisper_service.device,
            "compute_type": whisper_service.compute_type,
            "load_time_seconds": whisper_service.load_time,
        },
        stats=service_status["stats"],
    )


@router.post("/transcribe/batch", response_model=BatchTranscribeResponse)
async def transcribe_batch(
    files: List[UploadFile] = File(...),
    metadata: str = Form(...),
) -> BatchTranscribeResponse:
    """
    Transcribe multiple audio files in batch.

    Args:
        files: List of audio files to transcribe
        metadata: JSON string containing metadata for each file

    Returns:
        Batch transcription results
    """
    if whisper_service is None or config is None:
        raise HTTPException(503, detail="Service not initialized")

    if not whisper_service.is_ready():
        return BatchTranscribeResponse(
            success=False,
            error=ErrorDetail(
                code="MODEL_NOT_LOADED",
                message="Whisper model is not loaded yet",
            ),
        )

    batch_start = time.time()

    # Parse metadata JSON
    try:
        metadata_list: List[dict] = json.loads(metadata)
    except json.JSONDecodeError as e:
        return BatchTranscribeResponse(
            success=False,
            error=ErrorDetail(
                code="INVALID_METADATA",
                message=f"Failed to parse metadata JSON: {str(e)}",
            ),
        )

    # Validate counts match
    if len(files) != len(metadata_list):
        return BatchTranscribeResponse(
            success=False,
            error=ErrorDetail(
                code="METADATA_MISMATCH",
                message=f"Number of files ({len(files)}) does not match metadata entries ({len(metadata_list)})",
                details={
                    "files_count": len(files),
                    "metadata_count": len(metadata_list),
                },
            ),
        )

    results: List[BatchResult] = []
    tmp_paths: List[str] = []

    try:
        # Process each file
        for index, (file, meta) in enumerate(zip(files, metadata_list)):
            file_start = time.time()

            try:
                # Parse metadata
                batch_meta = BatchMetadata(**meta)
            except Exception as e:
                results.append(BatchResult(
                    index=index,
                    success=False,
                    error=ErrorDetail(
                        code="INVALID_METADATA_ENTRY",
                        message=f"Invalid metadata at index {index}: {str(e)}",
                    ),
                ))
                continue

            # Validate file format
            if not is_supported_format(file.filename or ""):
                results.append(BatchResult(
                    index=index,
                    success=False,
                    error=ErrorDetail(
                        code="INVALID_FORMAT",
                        message="Unsupported audio format",
                        details={"filename": file.filename},
                    ),
                ))
                continue

            # Read and save file
            content = await file.read()
            file_size_mb = len(content) / (1024 * 1024)

            if file_size_mb > config.server.max_file_size_mb:
                results.append(BatchResult(
                    index=index,
                    success=False,
                    error=ErrorDetail(
                        code="FILE_TOO_LARGE",
                        message=f"File too large: {file_size_mb:.2f}MB",
                        details={"size_mb": round(file_size_mb, 2)},
                    ),
                ))
                continue

            tmp_path = await save_upload_file(
                content,
                file.filename or "audio.ogg",
                config.server.temp_dir,
            )
            tmp_paths.append(tmp_path)

            try:
                # Validate audio
                is_valid, error_code, error_details = validate_audio_file(
                    tmp_path,
                    min_duration_ms=config.server.min_audio_duration_ms,
                    max_duration_seconds=config.server.max_audio_duration_seconds,
                    max_file_size_mb=config.server.max_file_size_mb,
                )

                if not is_valid:
                    results.append(BatchResult(
                        index=index,
                        success=False,
                        error=ErrorDetail(
                            code=error_code or "VALIDATION_FAILED",
                            message=f"Audio validation failed: {error_code}",
                            details=error_details,
                        ),
                    ))
                    continue

                # Perform transcription
                text, confidence, _ = whisper_service.transcribe(
                    tmp_path,
                    language=batch_meta.language,
                )

                processing_time_ms = int((time.time() - file_start) * 1000)

                results.append(BatchResult(
                    index=index,
                    success=True,
                    text=text,
                    user_id=batch_meta.user_id,
                    username=batch_meta.username,
                    display_name=batch_meta.display_name,
                    start_ts=batch_meta.start_ts,
                    end_ts=batch_meta.end_ts,
                    duration_ms=batch_meta.end_ts - batch_meta.start_ts,
                    language=batch_meta.language,
                    confidence=round(confidence, 3),
                    processing_time_ms=processing_time_ms,
                ))

                logger.info(
                    f"Batch item {index} complete: user={batch_meta.username}, "
                    f"text_len={len(text)}, time={processing_time_ms}ms"
                )

            except Exception as e:
                logger.error(f"Batch item {index} error: {e}")
                results.append(BatchResult(
                    index=index,
                    success=False,
                    error=ErrorDetail(
                        code="TRANSCRIPTION_FAILED",
                        message=str(e),
                    ),
                ))

    finally:
        # Clean up all temporary files
        for tmp_path in tmp_paths:
            cleanup_temp_file(tmp_path)

    total_time_ms = int((time.time() - batch_start) * 1000)
    successful_count = sum(1 for r in results if r.success)

    logger.info(
        f"Batch complete: {successful_count}/{len(files)} successful, "
        f"total_time={total_time_ms}ms"
    )

    return BatchTranscribeResponse(
        success=True,
        data={
            "results": [r.model_dump() for r in results],
            "total_count": len(files),
            "successful_count": successful_count,
            "failed_count": len(files) - successful_count,
            "total_processing_time_ms": total_time_ms,
        },
    )

