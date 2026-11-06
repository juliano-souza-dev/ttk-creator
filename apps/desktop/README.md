# Desktop application

Planned implementation: Tauri 2 + React + TypeScript.

This application owns the desktop experience: project browser, media bin, preview, timeline, captions, and export controls.

The first implementation milestone will add the runnable shell and typed boundaries for project and media services. UI components must not construct FFmpeg commands or access arbitrary filesystem paths directly.

See [the architecture overview](../../docs/architecture.md).
