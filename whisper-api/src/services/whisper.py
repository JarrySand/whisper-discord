"""Whisper transcription service."""
import time
import logging
from typing import Optional, Tuple, List, Union
from dataclasses import dataclass

from ..core.config import WhisperConfig
from .device import resolve_device_and_compute_type
from .aizuchi_filter import AizuchiFilter
from .hotwords import HotwordsManager
from .hallucination_filter import HallucinationFilter
from .cloud_providers import create_provider, GroqProvider, OpenAIProvider

logger = logging.getLogger(__name__)


@dataclass
class TranscriptionStats:
    """Statistics for transcription service."""

    total_requests: int = 0
    successful_requests: int = 0
    failed_requests: int = 0
    total_processing_time: float = 0.0
    total_audio_seconds: float = 0.0

    def record(
        self,
        processing_time: float,
        success: bool,
        audio_duration_seconds: float = 0.0,
    ) -> None:
        """Record a transcription result."""
        self.total_requests += 1
        self.total_processing_time += processing_time
        self.total_audio_seconds += audio_duration_seconds
        if success:
            self.successful_requests += 1
        else:
            self.failed_requests += 1

    @property
    def avg_processing_time(self) -> float:
        """Average processing time in seconds."""
        if self.total_requests == 0:
            return 0.0
        return self.total_processing_time / self.total_requests

    @property
    def success_rate(self) -> float:
        """Success rate as a ratio (0-1)."""
        if self.total_requests == 0:
            return 1.0
        return self.successful_requests / self.total_requests


class WhisperService:
    """Service for Whisper transcription."""

    def __init__(self, config: WhisperConfig):
        """
        Initialize the Whisper service.

        Args:
            config: Whisper configuration
        """
        self.config = config
        self.model = None  # For local provider (faster-whisper)
        self.cloud_provider: Optional[Union[GroqProvider, OpenAIProvider]] = None
        self.load_time: Optional[float] = None
        self.stats = TranscriptionStats()
        self._device: Optional[str] = None
        self._compute_type: Optional[str] = None
        self._provider_type = config.provider
        
        # Initialize aizuchi filter (disabled - moved to Bot side)
        self.aizuchi_filter = AizuchiFilter(
            enabled=False,  # Bot側でフィルタリング
            max_length=config.aizuchi_max_length,
        )
        
        # Initialize hallucination filter (disabled - moved to Bot side)
        self.hallucination_filter = HallucinationFilter(
            enabled=False,  # Bot側でフィルタリング
            min_repetition_count=3,
            max_repetition_length=20,
        )
        
        # Initialize hotwords manager
        self.hotwords = HotwordsManager(
            config_path=config.hotwords_file,
        )
        
        # Load hotwords from environment variable
        if config.hotwords:
            words = [w.strip() for w in config.hotwords.split(",") if w.strip()]
            self.hotwords.add_many(words)
        
        # Also load from env var (backup method)
        self.hotwords.load_from_env()
        
        logger.info(f"WhisperService initialized with provider: {self._provider_type}")

    def load_model(self) -> None:
        """Load the Whisper model or initialize cloud provider. Called once at startup."""
        start = time.time()
        
        if self._provider_type == "local":
            # Load local faster-whisper model
            from faster_whisper import WhisperModel

            logger.info(f"Loading local Whisper model: {self.config.model_name}")

            # Resolve device and compute type
            self._device, self._compute_type = resolve_device_and_compute_type(
                self.config.device,
                self.config.compute_type,
            )

            # Load model
            self.model = WhisperModel(
                model_size_or_path=self.config.model_name,
                device=self._device,
                compute_type=self._compute_type,
                download_root=self.config.model_cache_dir,
                local_files_only=self.config.local_files_only,
            )

            self.load_time = time.time() - start
            logger.info(
                f"Local model loaded in {self.load_time:.2f}s "
                f"(device={self._device}, compute_type={self._compute_type})"
            )
        
        elif self._provider_type in ("groq", "openai"):
            # Initialize cloud provider
            logger.info(f"Initializing {self._provider_type} cloud provider...")
            
            self.cloud_provider = create_provider(
                provider_type=self._provider_type,
                groq_api_key=self.config.groq_api_key,
                openai_api_key=self.config.openai_api_key,
                groq_model=self.config.groq_model,
                openai_model=self.config.openai_model,
            )
            
            # Verify provider is ready
            if self.cloud_provider and self.cloud_provider.is_ready():
                self.load_time = time.time() - start
                logger.info(
                    f"Cloud provider {self.cloud_provider.get_provider_name()} "
                    f"initialized in {self.load_time:.2f}s"
                )
            else:
                raise RuntimeError(f"Failed to initialize {self._provider_type} provider")
        
        else:
            raise ValueError(f"Unknown provider type: {self._provider_type}")

    def transcribe(
        self,
        audio_path: str,
        language: str = "ja",
        filter_aizuchi: bool = True,
        additional_hotwords: Optional[List[str]] = None,
    ) -> Tuple[str, float, float]:
        """
        Transcribe an audio file.

        Args:
            audio_path: Path to the audio file
            language: Language hint for transcription
            filter_aizuchi: Whether to filter out aizuchi (filler words)
            additional_hotwords: Additional hotwords for this request

        Returns:
            Tuple[str, float, float]: (transcribed_text, confidence, processing_time)

        Raises:
            RuntimeError: If model/provider is not loaded
        """
        # Use cloud provider if configured
        if self._provider_type in ("groq", "openai"):
            return self._transcribe_cloud(audio_path, language)
        
        # Otherwise use local model
        return self._transcribe_local(
            audio_path, language, filter_aizuchi, additional_hotwords
        )
    
    def _transcribe_cloud(
        self,
        audio_path: str,
        language: str = "ja",
    ) -> Tuple[str, float, float]:
        """Transcribe using cloud provider (Groq/OpenAI)."""
        if self.cloud_provider is None:
            raise RuntimeError("Cloud provider not initialized. Call load_model() first.")
        
        start = time.time()
        
        try:
            text, confidence, processing_time = self.cloud_provider.transcribe(
                audio_path, language
            )
            
            # Apply hallucination filter (post-processing)
            text, was_hallucination, hallucination_reason = self.hallucination_filter.filter(text)
            if was_hallucination:
                logger.debug(f"Hallucination filtered: {hallucination_reason}")
            
            # Record stats
            self.stats.record(
                processing_time=processing_time,
                success=len(text) > 0,
                audio_duration_seconds=0,  # Cloud providers don't return duration
            )
            
            return text, confidence, processing_time
            
        except Exception as e:
            processing_time = time.time() - start
            self.stats.record(processing_time=processing_time, success=False)
            logger.error(f"Cloud transcription failed: {e}")
            raise

    def _transcribe_local(
        self,
        audio_path: str,
        language: str = "ja",
        filter_aizuchi: bool = True,
        additional_hotwords: Optional[List[str]] = None,
    ) -> Tuple[str, float, float]:
        """Transcribe using local faster-whisper model."""
        if self.model is None:
            raise RuntimeError("Local model not loaded. Call load_model() first.")

        start = time.time()

        try:
            # Build initial_prompt with hotwords and Japanese context
            hotwords_prompt = self.hotwords.merge_with_request_hotwords(
                additional_hotwords,
                max_total=50,
            )
            
            # 日本語特化: initial_prompt で日本語会話のコンテキストを提供
            # これにより、Whisper が日本語の音韻を正しく認識しやすくなる
            if language == "ja":
                base_prompt = "これは日本語の会話です。Discordのボイスチャンネルで話しています。"
                if hotwords_prompt:
                    initial_prompt = f"{base_prompt} 用語: {hotwords_prompt}"
                else:
                    initial_prompt = base_prompt
            else:
                initial_prompt = hotwords_prompt if hotwords_prompt else None
            
            # Perform transcription
            segments, info = self.model.transcribe(
                audio_path,
                language=language,
                task="transcribe",
                beam_size=self.config.beam_size,
                best_of=self.config.best_of,
                temperature=self.config.temperature,
                vad_filter=self.config.vad_filter,
                vad_parameters=self.config.vad_parameters if self.config.vad_filter else None,
                initial_prompt=initial_prompt,
            )

            # Collect segments and calculate confidence
            text_parts = []
            total_logprob = 0.0
            segment_count = 0
            filtered_count = 0

            for segment in segments:
                text = segment.text.strip()
                
                # Apply aizuchi filter
                if filter_aizuchi and self.aizuchi_filter.is_aizuchi(text):
                    filtered_count += 1
                    continue
                
                text_parts.append(text)
                total_logprob += segment.avg_logprob
                segment_count += 1

            text = " ".join(text_parts).strip()
            
            if filtered_count > 0:
                logger.debug(f"Filtered {filtered_count} aizuchi segments")
            
            # Apply hallucination filter
            text, was_hallucination, hallucination_reason = self.hallucination_filter.filter(text)
            if was_hallucination:
                logger.debug(f"Hallucination filtered: {hallucination_reason}")

            # Calculate confidence from average log probability
            # log probability is typically between -1 and 0, convert to 0-1 scale
            confidence = 0.0
            if segment_count > 0:
                avg_logprob = total_logprob / segment_count
                # Convert log probability to confidence (0-1)
                # More negative = less confident
                confidence = min(1.0, max(0.0, 1.0 + avg_logprob / 3))

            processing_time = time.time() - start

            # Record stats
            self.stats.record(
                processing_time=processing_time,
                success=len(text) > 0,
                audio_duration_seconds=info.duration if hasattr(info, "duration") else 0,
            )

            logger.debug(
                f"Transcription completed: {len(text)} chars, "
                f"confidence={confidence:.2f}, time={processing_time:.2f}s"
            )

            return text, confidence, processing_time

        except Exception as e:
            processing_time = time.time() - start
            self.stats.record(processing_time=processing_time, success=False)
            logger.error(f"Local transcription failed: {e}")
            raise

    def is_ready(self) -> bool:
        """Check if the model/provider is loaded and ready."""
        if self._provider_type in ("groq", "openai"):
            return self.cloud_provider is not None and self.cloud_provider.is_ready()
        return self.model is not None

    @property
    def device(self) -> str:
        """Get the device being used."""
        if self._provider_type in ("groq", "openai"):
            return "cloud"
        return self._device or self.config.device

    @property
    def compute_type(self) -> str:
        """Get the compute type being used."""
        if self._provider_type in ("groq", "openai"):
            return "cloud"
        return self._compute_type or self.config.compute_type
    
    @property
    def provider_name(self) -> str:
        """Get the provider name."""
        if self._provider_type in ("groq", "openai") and self.cloud_provider:
            return self.cloud_provider.get_provider_name()
        return f"local ({self.config.model_name})"

    def get_status(self) -> dict:
        """Get service status information."""
        # Determine model name based on provider
        if self._provider_type == "groq":
            model_name = self.config.groq_model
        elif self._provider_type == "openai":
            model_name = self.config.openai_model
        else:
            model_name = self.config.model_name
        
        return {
            "provider": self._provider_type,
            "provider_name": self.provider_name,
            "model_name": model_name,
            "model_loaded": self.is_ready(),
            "device": self.device,
            "compute_type": self.compute_type,
            "load_time_seconds": self.load_time,
            "stats": {
                "total_requests": self.stats.total_requests,
                "successful_requests": self.stats.successful_requests,
                "failed_requests": self.stats.failed_requests,
                "avg_processing_time_ms": self.stats.avg_processing_time * 1000,
                "success_rate": self.stats.success_rate,
                "total_audio_processed_seconds": self.stats.total_audio_seconds,
            },
            "aizuchi_filter": self.aizuchi_filter.get_stats(),
            "hallucination_filter": self.hallucination_filter.get_stats(),
            "hotwords": self.hotwords.get_stats(),
        }

