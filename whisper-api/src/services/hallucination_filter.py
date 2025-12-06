"""Hallucination detection and filtering for Whisper transcription."""
import re
import logging
from typing import Tuple, Optional
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)


@dataclass
class HallucinationStats:
    """Statistics for hallucination filtering."""
    
    total_filtered: int = 0
    repetition_filtered: int = 0
    pattern_filtered: int = 0
    
    def to_dict(self) -> dict:
        return {
            "total_filtered": self.total_filtered,
            "repetition_filtered": self.repetition_filtered,
            "pattern_filtered": self.pattern_filtered,
        }


class HallucinationFilter:
    """
    ハルシネーション（幻覚）フィルター
    
    Whisper はまれに以下のようなハルシネーションを生成する:
    - 同じフレーズの繰り返し: 「しょうがない しょうがない しょうがない」
    - 意味不明な繰り返しパターン
    - 特定の定型フレーズ（字幕提供、ご視聴ありがとうございましたなど）
    """

    # 定型フレーズパターン（Whisper がよく生成するハルシネーション）
    HALLUCINATION_PATTERNS = [
        r"^字幕提供.*$",
        r"^ご視聴ありがとうございました.*$",
        r"^チャンネル登録.*$",
        r"^お疲れ様でした$",
        r"^\.+$",  # ドットのみ
        r"^,+$",  # カンマのみ
        r"^[\s\u3000]+$",  # 空白のみ
        r"(?:music|♪|♫)+",  # 音楽記号
        r"\[音楽\]",
        r"\[拍手\]",
        r"^\s*お\s*$",  # 単独の「お」
        r"^\s*ん\s*$",  # 単独の「ん」
    ]

    def __init__(
        self,
        enabled: bool = True,
        min_repetition_count: int = 3,
        max_repetition_length: int = 20,
    ):
        """
        Initialize the hallucination filter.
        
        Args:
            enabled: Whether filtering is enabled.
            min_repetition_count: Minimum repetitions to detect as hallucination.
            max_repetition_length: Maximum length of repeated phrase to detect.
        """
        self.enabled = enabled
        self.min_repetition_count = min_repetition_count
        self.max_repetition_length = max_repetition_length
        self.stats = HallucinationStats()
        
        # Compile patterns
        self._compiled_patterns = [
            re.compile(p, re.IGNORECASE | re.UNICODE) 
            for p in self.HALLUCINATION_PATTERNS
        ]

    def detect_repetition(self, text: str) -> Tuple[bool, Optional[str]]:
        """
        繰り返しパターンを検出
        
        Args:
            text: Input text to check.
            
        Returns:
            Tuple of (is_repetition, repeated_phrase).
        """
        if not text or len(text) < 6:
            return False, None
        
        # 正規化
        text = text.strip()
        
        # スペースで分割して同じ単語の繰り返しを検出
        words = text.split()
        if len(words) >= self.min_repetition_count:
            # 全ての単語が同じかチェック
            unique_words = set(words)
            if len(unique_words) == 1:
                return True, words[0]
        
        # サブストリングの繰り返しを検出
        # 例: "abc abc abc" -> "abc" が繰り返し
        for phrase_len in range(2, min(self.max_repetition_length + 1, len(text) // 2 + 1)):
            phrase = text[:phrase_len]
            repetitions = text.count(phrase)
            
            # フレーズがテキストの大部分を占める場合
            if repetitions >= self.min_repetition_count:
                expected_len = len(phrase) * repetitions
                # 繰り返しがテキストの80%以上を占める
                if expected_len / len(text) >= 0.8:
                    return True, phrase
        
        return False, None

    def detect_pattern_hallucination(self, text: str) -> bool:
        """
        定型フレーズパターンを検出
        
        Args:
            text: Input text to check.
            
        Returns:
            True if text matches a hallucination pattern.
        """
        if not text:
            return False
        
        for pattern in self._compiled_patterns:
            if pattern.search(text):
                return True
        
        return False

    def filter(self, text: str) -> Tuple[str, bool, Optional[str]]:
        """
        テキストをフィルタリング
        
        Args:
            text: Input text to filter.
            
        Returns:
            Tuple of (filtered_text, was_filtered, reason).
        """
        if not self.enabled or not text:
            return text, False, None
        
        original_text = text
        
        # パターンマッチによるハルシネーション検出
        if self.detect_pattern_hallucination(text):
            self.stats.total_filtered += 1
            self.stats.pattern_filtered += 1
            logger.debug(f"Pattern hallucination detected: {text[:50]}...")
            return "", True, "pattern_match"
        
        # 繰り返し検出
        is_repetition, repeated_phrase = self.detect_repetition(text)
        if is_repetition:
            self.stats.total_filtered += 1
            self.stats.repetition_filtered += 1
            logger.debug(f"Repetition hallucination detected: '{repeated_phrase}' in '{text[:50]}...'")
            
            # 繰り返しを1回だけに減らす
            if repeated_phrase:
                # 繰り返されたフレーズを1つだけ残す
                cleaned = repeated_phrase.strip()
                return cleaned, True, f"repetition:{repeated_phrase}"
            
            return "", True, "repetition"
        
        return text, False, None

    def get_stats(self) -> dict:
        """Get filter statistics."""
        return {
            "enabled": self.enabled,
            "min_repetition_count": self.min_repetition_count,
            "max_repetition_length": self.max_repetition_length,
            **self.stats.to_dict(),
        }



