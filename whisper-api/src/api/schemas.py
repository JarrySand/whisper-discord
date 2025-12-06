"""Pydantic schemas for API requests and responses."""
from typing import Optional, List, Any, Dict
from pydantic import BaseModel, Field


# =============================================================================
# Request Schemas
# =============================================================================


class TranscribeRequest(BaseModel):
    """Request schema for transcription (form data)."""

    user_id: str = Field(..., description="Discord User ID")
    username: str = Field(..., description="Discord Username")
    display_name: Optional[str] = Field(None, description="Server display name")
    start_ts: int = Field(..., description="Start timestamp (Unix ms)")
    end_ts: int = Field(..., description="End timestamp (Unix ms)")
    language: str = Field("ja", description="Language hint")
    filter_aizuchi: bool = Field(True, description="Filter out aizuchi (filler words)")
    hotwords: Optional[List[str]] = Field(
        None,
        description="Additional hotwords for this request (merged with server config)"
    )


class BatchMetadata(BaseModel):
    """Metadata for batch transcription."""

    user_id: str
    username: str
    display_name: Optional[str] = None
    start_ts: int
    end_ts: int
    language: str = "ja"


# =============================================================================
# Response Schemas
# =============================================================================


class TranscriptionResult(BaseModel):
    """Result of a single transcription."""

    user_id: str
    username: str
    display_name: Optional[str]
    text: str
    start_ts: int
    end_ts: int
    duration_ms: int
    language: str
    confidence: float
    processing_time_ms: int


class ErrorDetail(BaseModel):
    """Error details."""

    code: str
    message: str
    details: Optional[Dict[str, Any]] = None


class TranscribeResponse(BaseModel):
    """Response for transcription endpoint."""

    success: bool
    data: Optional[TranscriptionResult] = None
    error: Optional[ErrorDetail] = None


class BatchResult(BaseModel):
    """Result for a single item in batch transcription."""

    index: int
    success: bool
    text: Optional[str] = None
    user_id: Optional[str] = None
    username: Optional[str] = None
    display_name: Optional[str] = None
    start_ts: Optional[int] = None
    end_ts: Optional[int] = None
    duration_ms: Optional[int] = None
    language: Optional[str] = None
    confidence: Optional[float] = None
    processing_time_ms: Optional[int] = None
    error: Optional[ErrorDetail] = None


class BatchTranscribeResponse(BaseModel):
    """Response for batch transcription endpoint."""

    success: bool
    data: Optional[Dict[str, Any]] = None
    error: Optional[ErrorDetail] = None


class HealthResponse(BaseModel):
    """Response for health check endpoint."""

    status: str
    model_loaded: bool
    model_name: str
    device: str
    compute_type: str
    uptime_seconds: int
    requests_processed: int
    avg_processing_time_ms: float


class StatusResponse(BaseModel):
    """Response for status endpoint."""

    server: Dict[str, Any]
    model: Dict[str, Any]
    stats: Dict[str, Any]

