"""Cloud provider clients for Whisper transcription (Groq, OpenAI)."""
import time
import logging
import tempfile
import os
from typing import Tuple, Optional, Protocol
from abc import ABC, abstractmethod

logger = logging.getLogger(__name__)


class TranscriptionProvider(Protocol):
    """Protocol for transcription providers."""
    
    def transcribe(
        self,
        audio_path: str,
        language: str = "ja",
    ) -> Tuple[str, float, float]:
        """
        Transcribe audio file.
        
        Returns:
            Tuple[str, float, float]: (text, confidence, processing_time)
        """
        ...
    
    def is_ready(self) -> bool:
        """Check if provider is ready."""
        ...
    
    def get_provider_name(self) -> str:
        """Get provider name."""
        ...


class GroqProvider:
    """Groq API provider for Whisper transcription."""
    
    def __init__(self, api_key: str, model: str = "whisper-large-v3"):
        """
        Initialize Groq provider.
        
        Args:
            api_key: Groq API key
            model: Model to use (whisper-large-v3 or whisper-large-v3-turbo)
        """
        self.api_key = api_key
        self.model = model
        self._client = None
        self._ready = False
        
    def _ensure_client(self):
        """Lazily initialize the Groq client."""
        if self._client is None:
            try:
                from groq import Groq
                self._client = Groq(api_key=self.api_key)
                self._ready = True
                logger.info(f"Groq client initialized (model={self.model})")
            except ImportError:
                raise RuntimeError(
                    "groq package not installed. Run: pip install groq"
                )
            except Exception as e:
                logger.error(f"Failed to initialize Groq client: {e}")
                raise
    
    def transcribe(
        self,
        audio_path: str,
        language: str = "ja",
    ) -> Tuple[str, float, float]:
        """
        Transcribe audio using Groq API.
        
        Args:
            audio_path: Path to audio file
            language: Language code
            
        Returns:
            Tuple[str, float, float]: (text, confidence, processing_time)
        """
        self._ensure_client()
        
        start = time.time()
        
        try:
            with open(audio_path, "rb") as audio_file:
                # Get filename for the API
                filename = os.path.basename(audio_path)
                
                transcription = self._client.audio.transcriptions.create(
                    file=(filename, audio_file),
                    model=self.model,
                    language=language,
                    response_format="verbose_json",
                )
            
            processing_time = time.time() - start
            text = transcription.text.strip()
            
            # Groq doesn't return confidence directly, estimate from response
            # If we got a response, assume high confidence
            confidence = 0.90 if text else 0.0
            
            logger.debug(
                f"Groq transcription: {len(text)} chars, "
                f"time={processing_time:.2f}s"
            )
            
            return text, confidence, processing_time
            
        except Exception as e:
            processing_time = time.time() - start
            logger.error(f"Groq transcription failed: {e}")
            raise
    
    def is_ready(self) -> bool:
        """Check if Groq provider is ready."""
        try:
            self._ensure_client()
            return self._ready
        except Exception:
            return False
    
    def get_provider_name(self) -> str:
        """Get provider name."""
        return f"groq ({self.model})"


class OpenAIProvider:
    """OpenAI API provider for Whisper transcription."""
    
    def __init__(self, api_key: str, model: str = "whisper-1"):
        """
        Initialize OpenAI provider.
        
        Args:
            api_key: OpenAI API key
            model: Model to use (whisper-1)
        """
        self.api_key = api_key
        self.model = model
        self._client = None
        self._ready = False
        
    def _ensure_client(self):
        """Lazily initialize the OpenAI client."""
        if self._client is None:
            try:
                from openai import OpenAI
                self._client = OpenAI(api_key=self.api_key)
                self._ready = True
                logger.info(f"OpenAI client initialized (model={self.model})")
            except ImportError:
                raise RuntimeError(
                    "openai package not installed. Run: pip install openai"
                )
            except Exception as e:
                logger.error(f"Failed to initialize OpenAI client: {e}")
                raise
    
    def transcribe(
        self,
        audio_path: str,
        language: str = "ja",
    ) -> Tuple[str, float, float]:
        """
        Transcribe audio using OpenAI API.
        
        Args:
            audio_path: Path to audio file
            language: Language code
            
        Returns:
            Tuple[str, float, float]: (text, confidence, processing_time)
        """
        self._ensure_client()
        
        start = time.time()
        
        try:
            with open(audio_path, "rb") as audio_file:
                transcription = self._client.audio.transcriptions.create(
                    file=audio_file,
                    model=self.model,
                    language=language,
                    response_format="verbose_json",
                )
            
            processing_time = time.time() - start
            text = transcription.text.strip()
            
            # OpenAI doesn't return confidence directly
            confidence = 0.92 if text else 0.0
            
            logger.debug(
                f"OpenAI transcription: {len(text)} chars, "
                f"time={processing_time:.2f}s"
            )
            
            return text, confidence, processing_time
            
        except Exception as e:
            processing_time = time.time() - start
            logger.error(f"OpenAI transcription failed: {e}")
            raise
    
    def is_ready(self) -> bool:
        """Check if OpenAI provider is ready."""
        try:
            self._ensure_client()
            return self._ready
        except Exception:
            return False
    
    def get_provider_name(self) -> str:
        """Get provider name."""
        return f"openai ({self.model})"


def create_provider(
    provider_type: str,
    groq_api_key: Optional[str] = None,
    openai_api_key: Optional[str] = None,
    groq_model: str = "whisper-large-v3",
    openai_model: str = "whisper-1",
) -> Optional[TranscriptionProvider]:
    """
    Create a cloud transcription provider.
    
    Args:
        provider_type: "groq" or "openai"
        groq_api_key: Groq API key
        openai_api_key: OpenAI API key
        groq_model: Groq model name
        openai_model: OpenAI model name
        
    Returns:
        TranscriptionProvider or None if provider_type is "local"
    """
    if provider_type == "groq":
        if not groq_api_key:
            raise ValueError("WHISPER_GROQ_API_KEY is required for Groq provider")
        return GroqProvider(api_key=groq_api_key, model=groq_model)
    
    elif provider_type == "openai":
        if not openai_api_key:
            raise ValueError("WHISPER_OPENAI_API_KEY is required for OpenAI provider")
        return OpenAIProvider(api_key=openai_api_key, model=openai_model)
    
    elif provider_type == "local":
        return None  # Local provider uses faster-whisper directly
    
    else:
        raise ValueError(f"Unknown provider type: {provider_type}")

