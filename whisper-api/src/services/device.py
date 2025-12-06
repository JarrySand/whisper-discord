"""Device detection and optimization utilities."""
from typing import Tuple
import logging

logger = logging.getLogger(__name__)


def detect_device() -> str:
    """
    Detect the best available device for inference.

    Returns:
        str: Device name ("cuda", "mps", or "cpu")
    """
    try:
        import torch

        if torch.cuda.is_available():
            device_name = torch.cuda.get_device_name(0)
            logger.info(f"CUDA available: {device_name}")
            return "cuda"
        elif hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
            logger.info("Apple Silicon MPS available")
            return "mps"
        else:
            logger.info("Using CPU for inference")
            return "cpu"
    except ImportError:
        logger.warning("PyTorch not installed, defaulting to CPU")
        return "cpu"


def detect_compute_type(device: str) -> str:
    """
    Detect the optimal compute type for the given device.

    Args:
        device: Device name ("cuda", "mps", or "cpu")

    Returns:
        str: Compute type ("float16", "int8", or "float32")
    """
    if device == "cuda":
        try:
            import torch

            capability = torch.cuda.get_device_capability()
            # Volta (7.0) and newer support efficient float16
            if capability[0] >= 7:
                logger.info(f"GPU compute capability {capability}, using float16")
                return "float16"
            else:
                logger.info(f"GPU compute capability {capability}, using int8")
                return "int8"
        except Exception as e:
            logger.warning(f"Error detecting GPU capability: {e}, using float16")
            return "float16"
    elif device == "mps":
        logger.info("MPS device, using float16")
        return "float16"
    else:
        logger.info("CPU device, using int8 for efficiency")
        return "int8"


def resolve_device_and_compute_type(
    device: str = "auto",
    compute_type: str = "auto",
) -> Tuple[str, str]:
    """
    Resolve device and compute type from auto settings.

    Args:
        device: Device setting ("auto", "cuda", "cpu", "mps")
        compute_type: Compute type setting ("auto", "float16", "int8", "float32")

    Returns:
        Tuple[str, str]: (resolved_device, resolved_compute_type)
    """
    # Resolve device
    if device == "auto":
        resolved_device = detect_device()
    else:
        resolved_device = device

    # Resolve compute type
    if compute_type == "auto":
        resolved_compute_type = detect_compute_type(resolved_device)
    else:
        resolved_compute_type = compute_type

    logger.info(f"Using device={resolved_device}, compute_type={resolved_compute_type}")
    return resolved_device, resolved_compute_type


def get_device_info() -> dict:
    """
    Get detailed device information.

    Returns:
        dict: Device information including GPU name, memory, etc.
    """
    info = {
        "device": "cpu",
        "device_name": "CPU",
        "cuda_available": False,
        "mps_available": False,
    }

    try:
        import torch

        info["cuda_available"] = torch.cuda.is_available()
        info["mps_available"] = (
            hasattr(torch.backends, "mps") and torch.backends.mps.is_available()
        )

        if info["cuda_available"]:
            info["device"] = "cuda"
            info["device_name"] = torch.cuda.get_device_name(0)
            info["cuda_version"] = torch.version.cuda
            info["gpu_memory_total_mb"] = (
                torch.cuda.get_device_properties(0).total_memory // (1024 * 1024)
            )
            info["gpu_memory_allocated_mb"] = (
                torch.cuda.memory_allocated(0) // (1024 * 1024)
            )
        elif info["mps_available"]:
            info["device"] = "mps"
            info["device_name"] = "Apple Silicon"
    except ImportError:
        pass

    return info

