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

The first Windows desktop shell is now in place. It includes a project dashboard and local project creation/listing. Timeline editing, media import, caption synchronization, and rendering will follow in deliberate increments.

See [Architecture](docs/architecture.md) and [Roadmap](docs/roadmap.md).\n\n## Run on Windows\n\nInstall the prerequisites described in the [Tauri v2 Windows guide](https://v2.tauri.app/start/prerequisites/), including Node.js, Rust, Microsoft C++ Build Tools, and WebView2.\n\nThen open PowerShell in `apps/desktop` and run:\n\n```powershell\nnpm install\nnpm run tauri dev\n```\n\nTo build a Windows installer:\n\n```powershell\nnpm run tauri build\n```\n\nProjects created by the app are stored in the operating system's application data directory under `projects/`. The current version creates and lists project documents; the editing timeline and media workflows are not implemented yet.

## Principles

1. Keep the editor independent from legacy projects and formats.
2. Keep UI, project data, media processing, and AI integrations separated.
3. Prefer non-destructive editing: source media is never modified by editing operations.
4. Make projects portable and versioned.
5. Keep rendering deterministic and testable.
6. Treat AI providers as optional adapters, never as the core of the editor.

## License

Not specified yet.
