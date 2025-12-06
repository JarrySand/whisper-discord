"""FastAPI application entry point."""
import time
import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .core.config import get_config
from .core.logging import setup_logging
from .services.whisper import WhisperService
from .api import routes
from .utils.file import ensure_directories, periodic_cleanup

# Initialize configuration
config = get_config()

# Setup logging
logger = setup_logging(
    level=config.log_level,
    format_type=config.log_format,
    logger_name="whisper_api",
)

# Initialize Whisper service
whisper_service = WhisperService(config.whisper)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Application lifespan manager.

    Handles startup and shutdown events.
    """
    # ==========================================================================
    # Startup
    # ==========================================================================
    logger.info("Starting Whisper API Server...")

    # Ensure required directories exist
    ensure_directories(
        config.whisper.model_cache_dir,
        config.server.temp_dir,
    )

    # Record start time
    app.state.start_time = time.time()

    # Load Whisper model
    logger.info(f"Loading Whisper model: {config.whisper.model_name}")
    try:
        whisper_service.load_model()
        logger.info("Whisper model loaded successfully")
    except Exception as e:
        logger.error(f"Failed to load Whisper model: {e}")
        raise

    # Initialize routes with dependencies
    routes.init_router(
        service=whisper_service,
        app_config=config,
        app_start_time=app.state.start_time,
    )

    # Start background cleanup task
    cleanup_task = asyncio.create_task(
        periodic_cleanup(
            temp_dir=config.server.temp_dir,
            interval_seconds=config.server.cleanup_interval_seconds,
            max_age_seconds=3600,  # 1 hour
        )
    )

    logger.info(
        f"Server ready at http://{config.server.host}:{config.server.port}"
    )

    yield

    # ==========================================================================
    # Shutdown
    # ==========================================================================
    logger.info("Shutting down Whisper API Server...")

    # Cancel cleanup task
    cleanup_task.cancel()
    try:
        await cleanup_task
    except asyncio.CancelledError:
        pass

    logger.info("Server shutdown complete")


# Create FastAPI application
app = FastAPI(
    title="Whisper Transcription API",
    description="API server for audio transcription using Whisper",
    version="1.0.0",
    lifespan=lifespan,
)

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routes
app.include_router(routes.router)


# =============================================================================
# Root endpoint
# =============================================================================


@app.get("/")
async def root():
    """Root endpoint with API information."""
    return {
        "name": "Whisper Transcription API",
        "version": "1.0.0",
        "docs": "/docs",
        "health": "/health",
        "status": "/status",
    }


# =============================================================================
# CLI entry point
# =============================================================================


def main():
    """Run the server using uvicorn."""
    import uvicorn

    uvicorn.run(
        "src.main:app",
        host=config.server.host,
        port=config.server.port,
        workers=config.server.workers,
        reload=False,
    )


if __name__ == "__main__":
    main()

