"""Configuration management using pydantic-settings."""
from typing import Any, Dict, List, Optional, Literal
from pydantic_settings import BaseSettings
from functools import lru_cache


class WhisperConfig(BaseSettings):
    """Whisper model configuration."""

    # Provider settings: "local", "groq", "openai"
    provider: Literal["local", "groq", "openai"] = "local"
    
    # API Keys (for cloud providers)
    groq_api_key: Optional[str] = None
    openai_api_key: Optional[str] = None

    # Model settings (for local provider)
    model_name: str = "large-v3"
    device: str = "auto"  # "auto", "cuda", "cpu", "mps"
    compute_type: str = "auto"  # "auto", "float16", "int8", "float32"
    model_cache_dir: str = "./models"
    local_files_only: bool = False
    
    # Cloud provider model settings
    groq_model: str = "whisper-large-v3"  # or "whisper-large-v3-turbo"
    openai_model: str = "whisper-1"

    # Inference parameters
    beam_size: int = 5
    best_of: int = 5
    temperature: float = 0.0

    # VAD (Voice Activity Detection)
    vad_filter: bool = True
    vad_parameters: Dict[str, Any] = {
        "threshold": 0.5,
        "min_speech_duration_ms": 250,
        "min_silence_duration_ms": 100,
        "speech_pad_ms": 30,
    }

    # 相槌フィルター (Aizuchi Filter)
    aizuchi_filter_enabled: bool = True
    aizuchi_max_length: int = 15

    # hotwords (専門用語)
    hotwords: Optional[str] = None  # Comma-separated list
    hotwords_file: Optional[str] = None  # Path to JSON file

    model_config = {"env_prefix": "WHISPER_"}


class ServerConfig(BaseSettings):
    """Server configuration."""

    # Server settings
    host: str = "0.0.0.0"
    port: int = 8000
    workers: int = 1  # Whisper is recommended to run in single process

    # Limits
    max_file_size_mb: int = 25
    max_audio_duration_seconds: int = 300  # 5 minutes
    min_audio_duration_ms: int = 500
    request_timeout_seconds: int = 120

    # Temporary files
    temp_dir: str = "./temp"
    cleanup_interval_seconds: int = 300

    model_config = {"env_prefix": "SERVER_"}


class Config(BaseSettings):
    """Application configuration."""

    whisper: WhisperConfig = WhisperConfig()
    server: ServerConfig = ServerConfig()

    # Logging
    log_level: str = "INFO"
    log_format: str = "json"  # "json" or "text"

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}


@lru_cache
def get_config() -> Config:
    """Get cached configuration instance."""
    return Config()

