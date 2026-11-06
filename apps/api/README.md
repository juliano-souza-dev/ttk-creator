# Local media service

Planned implementation: Python + FastAPI.

Responsibilities:
- project and asset operations;
- media probing and validation;
- render job lifecycle and progress;
- FFmpeg process orchestration;
- optional transcription and AI provider adapters.

Long-running media work must be asynchronous, cancellable, and observable. Keep provider-specific code outside the core project and editing models.

The service must bind to loopback only when launched by the desktop application.

See [the architecture overview](../../docs/architecture.md).
