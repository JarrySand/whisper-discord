"""相槌フィルター - Aizuchi (filler word) filter for Japanese transcription."""
import re
from typing import List, Tuple, Optional
import logging

logger = logging.getLogger(__name__)


class AizuchiFilter:
    """
    相槌（あいづち）フィルター
    
    VC会話では「うん」「はい」「なるほど」などの相槌が大量に発生する。
    これらは議事録としてはノイズとなるため、文字起こし結果から除去する。
    """

    DEFAULT_PATTERNS = [
        # 基本的な相槌
        r"^うん[。．、]*$",
        r"^ん[ー〜]*[。．、]*$",
        r"^はい[。．、]*$",
        r"^ええ[。．、]*$",
        r"^へー[ー]*[。．、]*$",
        
        # フィラー（言い淀み）
        r"^えー[っと]*[。．、]*$",
        r"^あー[。．、]*$",
        r"^まあ[。．、]*$",
        r"^えっと[。．、]*$",
        r"^あのー*[。．、]*$",
        r"^その[ー]*[。．、]*$",
        r"^なんか[。．、]*$",
        
        # 同意・理解
        r"^そうですね[。．、]*$",
        r"^なるほど[ね]*[。．、]*$",
        r"^確かに[。．、]*$",
        r"^そうそう[。．、]*$",
        r"^そっか[ー]*[。．、]*$",
        r"^そうだね[。．、]*$",
        r"^だね[。．、]*$",
        r"^ね[ー]*[。．、]*$",
        
        # 感嘆
        r"^おー[。．、]*$",
        r"^わー[。．、]*$",
        r"^すごい[。．、]*$",
        r"^ふーん[。．、]*$",
        r"^ほー[。．、]*$",
        
        # 笑い
        r"^[笑わはw]+[。．、]*$",
        r"^\(笑\)[。．、]*$",
        r"^ふふ[ふ]*[。．、]*$",
        r"^あは[は]*[。．、]*$",
    ]

    def __init__(
        self,
        patterns: Optional[List[str]] = None,
        max_length: int = 15,
        enabled: bool = True,
    ):
        """
        Initialize the aizuchi filter.
        
        Args:
            patterns: Custom regex patterns to match. Uses DEFAULT_PATTERNS if None.
            max_length: Maximum text length to consider as aizuchi.
            enabled: Whether the filter is enabled.
        """
        self.patterns = patterns or self.DEFAULT_PATTERNS
        self.max_length = max_length
        self.enabled = enabled
        self._compiled = [re.compile(p) for p in self.patterns]
        
        logger.debug(
            f"AizuchiFilter initialized: enabled={enabled}, "
            f"patterns={len(self._compiled)}, max_length={max_length}"
        )

    def is_aizuchi(self, text: str) -> bool:
        """
        Check if the text is an aizuchi (filler word).
        
        Args:
            text: Text to check.
            
        Returns:
            True if the text is an aizuchi and should be filtered.
        """
        if not self.enabled:
            return False

        t = text.strip()

        # Long text is not aizuchi
        if len(t) > self.max_length:
            return False

        # Empty text is not aizuchi (but should be handled elsewhere)
        if len(t) == 0:
            return False

        # Check against patterns
        for pattern in self._compiled:
            if pattern.match(t):
                logger.debug(f"Aizuchi detected: '{t}'")
                return True

        return False

    def filter_text(self, text: str) -> Optional[str]:
        """
        Filter aizuchi from text.
        
        Args:
            text: Text to filter.
            
        Returns:
            None if the text is aizuchi, otherwise the original text.
        """
        if self.is_aizuchi(text):
            return None
        return text

    def filter_segments(
        self,
        segments: List[Tuple[float, float, str]],
    ) -> List[Tuple[float, float, str]]:
        """
        Filter aizuchi from a list of segments.
        
        Args:
            segments: List of (start_time, end_time, text) tuples.
            
        Returns:
            Filtered list of segments without aizuchi.
        """
        filtered = [
            (start, end, text)
            for start, end, text in segments
            if not self.is_aizuchi(text)
        ]
        
        filtered_count = len(segments) - len(filtered)
        if filtered_count > 0:
            logger.debug(f"Filtered {filtered_count} aizuchi segments")
        
        return filtered

    def add_pattern(self, pattern: str) -> None:
        """Add a new pattern to the filter."""
        self.patterns.append(pattern)
        self._compiled.append(re.compile(pattern))

    def remove_pattern(self, pattern: str) -> bool:
        """Remove a pattern from the filter. Returns True if found and removed."""
        if pattern in self.patterns:
            idx = self.patterns.index(pattern)
            self.patterns.pop(idx)
            self._compiled.pop(idx)
            return True
        return False

    def get_stats(self) -> dict:
        """Get filter statistics."""
        return {
            "enabled": self.enabled,
            "pattern_count": len(self.patterns),
            "max_length": self.max_length,
        }

