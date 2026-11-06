# TikTok Media Creator

A Windows-first desktop video editor for short-form and educational content.

This is an independent application with its own project format, media library, editing pipeline, and user experience. It does not depend on the legacy nova-generator.

## Current stack

- Tauri 2, Rust, React, and TypeScript
- Native Windows file picker for local media
- yt-dlp CLI for YouTube inspection and downloads
- External yt-dlp and FFmpeg tools
- Python + FastAPI reserved for future media and AI jobs

## Current milestone

The desktop shell, local project persistence, project media library, multi-file local import, and YouTube import workflow are implemented.

Local assets are copied into each project's `media/` directory and registered in `project.json`. YouTube imports support metadata inspection, available video-height selection, and download progress. The application prepares yt-dlp and FFmpeg on first use and reuses them afterward.

The next milestones are media probing, asset preview, a multi-track timeline, caption editing, and MP4 export.

See [Architecture](docs/architecture.md) and [Roadmap](docs/roadmap.md).

## Run on Windows

Install Node.js, Rust, Microsoft C++ Build Tools, and WebView2 as described in the [Tauri v2 Windows prerequisites](https://v2.tauri.app/start/prerequisites/).

Then open PowerShell in `apps/desktop`:

```powershell
npm install
npm run tauri dev
```

To build a Windows installer:

```powershell
npm run tauri build
```

Projects are stored in the operating system's application data directory under `projects/`.

## Principles

1. Keep the editor independent from legacy projects and formats.
2. Keep UI, project data, media processing, and AI integrations separated.
3. Never modify imported source media.
4. Make projects portable and versioned.
5. Keep rendering deterministic and testable.
6. Treat AI providers as optional adapters.

## License

Not specified yet.
