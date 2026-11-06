# TikTok Media Creator

A Windows-first desktop video editor for short-form and educational content.

TikTok Media Creator is an independent project. It does not depend on the legacy nova-generator or its material formats.

## Product direction

Build a capable editor for TikTok, Instagram Reels, and YouTube Shorts, with a strong workflow for educational videos: media, narration, captions, timed scenes, motion graphics, and export.

## Initial technology direction

- **Desktop shell:** Tauri 2
- **Frontend:** React + TypeScript
- **Local media service:** Python + FastAPI
- **Media processing:** FFmpeg
- **Project database:** SQLite
- **Initial platform:** Windows

These choices are the starting architecture, not immutable constraints. Each subsystem should remain replaceable behind clear interfaces.

## Development status

The repository is being initialized. The first milestone is a runnable desktop shell and a reliable local project/media foundation. Timeline editing, caption synchronization, and rendering will follow in deliberate increments.

See [Architecture](docs/architecture.md) and [Roadmap](docs/roadmap.md).

## Principles

1. Keep the editor independent from legacy projects and formats.
2. Keep UI, project data, media processing, and AI integrations separated.
3. Prefer non-destructive editing: source media is never modified by editing operations.
4. Make projects portable and versioned.
5. Keep rendering deterministic and testable.
6. Treat AI providers as optional adapters, never as the core of the editor.

## License

Not specified yet.
