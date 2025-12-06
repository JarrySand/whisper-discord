"""Hotwords manager for specialized terminology recognition."""
import os
import json
import logging
from typing import List, Optional
from pathlib import Path

logger = logging.getLogger(__name__)


class HotwordsManager:
    """
    専門用語管理
    
    DAO、NFT、プロジェクト名などの専門用語・固有名詞は、
    Whisperが誤認識しやすい。initial_prompt を使用して認識精度を向上させる。
    """

    def __init__(
        self,
        config_path: Optional[str] = None,
        hotwords: Optional[List[str]] = None,
    ):
        """
        Initialize the hotwords manager.
        
        Args:
            config_path: Path to a JSON configuration file.
            hotwords: Initial list of hotwords.
        """
        self.hotwords: List[str] = hotwords.copy() if hotwords else []
        self._config_path = config_path

        # Load from config file if provided
        if config_path and os.path.exists(config_path):
            self.load_from_file(config_path)
        
        logger.debug(f"HotwordsManager initialized with {len(self.hotwords)} hotwords")

    def load_from_file(self, path: str) -> None:
        """
        Load hotwords from a JSON configuration file.
        
        Args:
            path: Path to the JSON file.
            
        Expected JSON format:
        {
            "hotwords": ["DAO", "NFT", "KIBOTCHA", ...],
            "description": "Optional description"
        }
        """
        try:
            with open(path, 'r', encoding='utf-8') as f:
                data = json.load(f)
                new_hotwords = data.get('hotwords', [])
                
                # Merge with existing (avoid duplicates)
                for word in new_hotwords:
                    if word not in self.hotwords:
                        self.hotwords.append(word)
                
                logger.info(f"Loaded {len(new_hotwords)} hotwords from {path}")
        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse hotwords JSON: {e}")
        except Exception as e:
            logger.error(f"Failed to load hotwords from file: {e}")

    def load_from_env(self, env_var: str = "WHISPER_HOTWORDS") -> None:
        """
        Load hotwords from an environment variable (comma-separated).
        
        Args:
            env_var: Name of the environment variable.
        """
        value = os.getenv(env_var, "")
        if value:
            new_hotwords = [w.strip() for w in value.split(",") if w.strip()]
            
            # Merge with existing (avoid duplicates)
            for word in new_hotwords:
                if word not in self.hotwords:
                    self.hotwords.append(word)
            
            logger.info(f"Loaded {len(new_hotwords)} hotwords from env var {env_var}")

    def save_to_file(self, path: Optional[str] = None) -> None:
        """
        Save hotwords to a JSON file.
        
        Args:
            path: Path to save to. Uses config_path if not specified.
        """
        save_path = path or self._config_path
        if not save_path:
            raise ValueError("No path specified and no config_path set")

        # Ensure directory exists
        Path(save_path).parent.mkdir(parents=True, exist_ok=True)

        data = {
            "hotwords": self.hotwords,
            "description": "Hotwords for Whisper transcription",
        }

        with open(save_path, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        
        logger.info(f"Saved {len(self.hotwords)} hotwords to {save_path}")

    def add(self, word: str) -> bool:
        """
        Add a hotword.
        
        Args:
            word: Word to add.
            
        Returns:
            True if added, False if already exists.
        """
        if word not in self.hotwords:
            self.hotwords.append(word)
            logger.debug(f"Added hotword: {word}")
            return True
        return False

    def add_many(self, words: List[str]) -> int:
        """
        Add multiple hotwords.
        
        Args:
            words: Words to add.
            
        Returns:
            Number of words actually added.
        """
        added = 0
        for word in words:
            if self.add(word):
                added += 1
        return added

    def remove(self, word: str) -> bool:
        """
        Remove a hotword.
        
        Args:
            word: Word to remove.
            
        Returns:
            True if removed, False if not found.
        """
        if word in self.hotwords:
            self.hotwords.remove(word)
            logger.debug(f"Removed hotword: {word}")
            return True
        return False

    def clear(self) -> None:
        """Clear all hotwords."""
        self.hotwords.clear()
        logger.debug("Cleared all hotwords")

    def get_prompt(self, max_words: int = 50) -> str:
        """
        Generate an initial_prompt string for Whisper.
        
        Args:
            max_words: Maximum number of words to include.
            
        Returns:
            Comma-separated string of hotwords.
        """
        if not self.hotwords:
            return ""

        # Limit to max_words
        words = self.hotwords[:max_words]
        return ", ".join(words)

    def get_prompt_with_context(self, max_words: int = 20) -> str:
        """
        Generate a more effective prompt with natural language context.
        
        Args:
            max_words: Maximum number of words to include.
            
        Returns:
            Natural language prompt including hotwords.
        """
        if not self.hotwords:
            return ""

        # Use first max_words
        words = self.hotwords[:max_words]
        terms = ", ".join(words)
        
        return f"この会話では以下の用語が登場します: {terms}。"

    def merge_with_request_hotwords(
        self,
        request_hotwords: Optional[List[str]],
        max_total: int = 50,
    ) -> str:
        """
        Merge server hotwords with request-specific hotwords.
        
        Args:
            request_hotwords: Additional hotwords from the request.
            max_total: Maximum total words in the prompt.
            
        Returns:
            Combined prompt string.
        """
        combined = self.hotwords.copy()
        
        if request_hotwords:
            for word in request_hotwords:
                if word not in combined:
                    combined.append(word)
        
        # Limit and create prompt
        combined = combined[:max_total]
        return ", ".join(combined) if combined else ""

    def __len__(self) -> int:
        """Return the number of hotwords."""
        return len(self.hotwords)

    def __contains__(self, word: str) -> bool:
        """Check if a word is in the hotwords list."""
        return word in self.hotwords

    def get_stats(self) -> dict:
        """Get manager statistics."""
        return {
            "count": len(self.hotwords),
            "config_path": self._config_path,
        }

