# Architecture

## 1. Product boundary

TikTok Media Creator is a new application with its own project model, editing pipeline, and user experience. It does not read or write legacy nova-generator formats as a compatibility requirement.

The first target is Windows desktop. The architecture should avoid coupling core editing concepts to Windows-only APIs so a web client can be considered later.

## 2. Initial system shape

```text
Desktop application (Tauri 2 + React + TypeScript)
  ├─ Project dashboard and project document
  ├─ Native file picker and project media library
  ├─ Tauri/Rust commands for local file operations
  └─ YouTube adapter (yt-dlp CLI)
       └─ FFmpeg for stream merging and MP4 remuxing

Future local media service (Python + FastAPI)
  ├─ FFmpeg render orchestration and media probing
  ├─ Transcription and AI provider adapters
  └─ Long-running media jobs
```

This is an incremental architecture. The current import workflows use native Tauri commands. The Python service remains a future boundary for heavier media processing and AI jobs. The frontend never executes shell commands directly.

## 3. Repository layout

- `apps/desktop`: Tauri shell and React user interface.
- `apps/api`: local Python service for media and project operations.
- `packages/project-schema`: versioned project document definitions and validation fixtures.
- `docs`: architecture decisions, roadmap, and developer guidance.

The folders are introduced before implementation so ownership boundaries remain explicit.

## 4. Responsibilities

### Desktop UI

Owns presentation and user interaction: project browser, media bin, preview, timeline, caption editor, and export workflow. It should call application services through typed interfaces and should not contain FFmpeg orchestration.

### Local media service

Owns file inspection, media operations, render orchestration, job state, and persistence. Long-running work must be represented as jobs with progress, cancellation, and useful error details.

### Project model

The project document is the source of truth for an edit. It describes source assets and timeline references; it does not contain generated render output as editable source data.

### Media engine

FFmpeg is the initial media execution engine. Keep command construction, filter graphs, probing, and process management behind a small internal interface. This allows testing and eventual replacement of individual operations.

### AI integrations

Transcription, translation, voice generation, and other AI capabilities are adapters. Provider credentials and provider-specific payloads must not leak into the project format or UI domain model.

## 5. Editing principles

1. **Non-destructive:** never overwrite imported source media.
2. **Time-based:** store timeline positions and durations in a canonical integer unit (milliseconds initially); convert to frames at render boundaries.
3. **Explicit tracks:** audio, video, overlays, and captions have clear track/layer semantics.
4. **Deterministic export:** the same project, assets, and render settings should produce equivalent output.
5. **Portable projects:** use relative asset references where possible and provide a relink workflow for moved media.
6. **Versioned data:** every saved project declares a schema version and has a migration path before incompatible changes ship.

## 6. Initial project document direction

A project should contain:
- document identity and schema version;
- canvas settings (width, height, frame rate, background);
- imported assets and technical metadata;
- tracks and ordered timeline clips;
- clip source in/out points, timeline start, duration, and transforms;
- caption segments and style references;
- export presets and project metadata.

The exact schema will be implemented and validated in `packages/project-schema`. Avoid prematurely freezing fields before the first editor workflows are tested.

## 7. Local service and security

- Bind the local service to loopback only.
- Use an ephemeral or securely managed local authentication token for desktop-to-service communication.
- Validate all paths and reject path traversal.
- Treat imported media and AI responses as untrusted input.
- Do not expose arbitrary command execution to the renderer process.
- Keep secrets out of project files, logs, and source control.

## 8. Technology trade-offs

| Choice | Why it fits now | Cost / risk |
|---|---|---|
| Tauri 2 | Lightweight desktop shell and native integration | Rust toolchain and packaging knowledge required |
| React + TypeScript | Mature ecosystem for complex editor interfaces | Timeline and preview performance need deliberate profiling |
| Python + FastAPI | Strong media/AI ecosystem and rapid iteration | Shipping Python runtime as a Windows sidecar needs packaging work |
| FFmpeg | Broad codec and filter support | Licensing, codec availability, and command complexity need review |
| SQLite | Reliable local project database | Multi-device collaboration is out of scope initially |

## 9. Architectural decisions to validate

- Whether the local service ships as a bundled sidecar or is embedded behind Tauri commands.
- Whether project metadata lives entirely in SQLite or uses a portable project manifest plus SQLite cache.
- Preview strategy and proxy generation for large source files.
- Frame-rate representation and variable-frame-rate handling.
- Packaging, FFmpeg distribution, and codec licensing for Windows.

These are explicit validation items, not settled implementation facts.

## 10. Implemented feature boundaries

The desktop editor is organized around feature ownership. `App.tsx` and `EditorWorkspace.tsx` coordinate application state and user interaction; domain transformations and provider-specific work belong to feature modules instead of being implemented inline in those components.

### Frontend feature modules

- `features/timeline`: clip and group contracts, duration/time calculations, clip creation, duplication, splitting, and visual reordering.
- `features/motion-graphics`: text/caption model, ordered layer collections, caption editing, transcript conversion, Scene Spec/Super JSON conversion, caption styling, and the Lucide icon catalog/layout.
- `features/image-overlays`: image-overlay contract and entrance-animation state.
- `features/scene-spec`: conversion of a validated Scene Spec into project timeline and motion data, including referenced media matching.
- `features/export`: conversion of editor state into the typed timeline-export payload. The editor does not assemble FFmpeg payload details itself.
- `services/desktop-api`: typed boundary between React and Tauri commands.

### Rust feature boundaries

- `commands` is a Tauri command facade. Project/library commands, YouTube commands, export commands, sound-library commands, and transcription commands live in separate modules and are registered by their feature path.
- `application/services` separates project lifecycle from media-library operations.
- `infrastructure` owns persistence and external-system adapters, including SQLite, media storage, YouTube cache/download, and the global sound library.
- `commands/export` separates FFmpeg discovery/capability checks and caption/filter helpers from the export command orchestration.
- `translation/settings` owns credential and configuration resolution; `translation/groq` owns Groq translation requests.
- `transcription/local` owns the local Faster-Whisper adapter; cloud transcription remains behind the transcription feature boundary.

### Rules for future changes

1. A feature owns its domain types and pure transformations. Another feature consumes its public contract rather than reaching into its implementation details.
2. React components coordinate state and events. Parsing, conversion, ordering, timing, and export mapping stay in feature modules when they can be deterministic functions.
3. Tauri command modules validate/orchestrate the boundary. File persistence, provider access, and media processing stay in application or infrastructure services.
4. Do not change user-visible behavior as part of a structural extraction. Behavior changes must be isolated, described, and validated separately.
5. Each extraction must pass the frontend type-check/build and Rust test/check workflow before further behavior work is layered on top.
6. Keep source assets immutable. Export and editing operations work on references and generated outputs, never overwrite imported originals.

The remaining editor components are intentionally still orchestration-heavy. Further UI extraction should happen by introducing feature components with explicit props and callbacks, not by moving state blindly or creating a shared global state store.
