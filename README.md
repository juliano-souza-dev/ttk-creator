# TikTok Media Creator

A Windows-first desktop video editor for short-form and educational content.

TikTok Media Creator is an independent project. It does not depend on the legacy nova-generator or its material formats.

## Product direction

Build a capable editor for TikTok, Instagram Reels, and YouTube Shorts, with a strong workflow for educational videos: media, narration, captions, timed scenes, motion graphics, and export.

## Technology

- **Desktop shell:** Tauri 2
- **Frontend:** React + TypeScript
- **Native desktop services:** Rust
- **Media processing roadmap:** FFmpeg
- **Initial platform:** Windows

The architecture is intentionally modular. Media processing and AI providers can be added or replaced without coupling them to the editor UI.

## Current development status

The current milestone provides:

- Project creation and local project library.
- Per-project media library.
- Import of local video, audio, and image files.
- Copying imported media into the project folder, preserving the original files.
- YouTube link inspection, available video quality selection, and download into the project.
- Download progress events in the desktop UI.

The editor timeline, playback, captions, and final video rendering are separate upcoming milestones.

## Run on Windows

Install Node.js, Rust, Microsoft C++ Build Tools, and WebView2. See the official [Tauri v2 Windows prerequisites](https://v2.tauri.app/start/prerequisites/).

From PowerShell, in `apps/desktop`:

```powershell
npm install
npm run tauri dev
```

To build a Windows installer:

```powershell
npm run tauri build
```

### YouTube importer prerequisites

The YouTube importer currently uses the external command-line tools **yt-dlp** and **FFmpeg**. Install them and make sure both commands are available in the Windows PATH.

Install/update yt-dlp with Python:

```powershell
py -m pip install -U yt-dlp
```

Install FFmpeg using a trusted Windows distribution and verify:

```powershell
yt-dlp --version
ffmpeg -version
```

The app also checks common Python launchers and can run yt-dlp as `py -m yt_dlp` when the standalone command is not available. YouTube access may vary by video, region, age restriction, authentication, and changes made by YouTube. Only import videos you are authorized to download and reuse.

## Project storage

Projects are stored in the operating system's application data directory under `projects/<project-id>/`. Each project contains a versioned `project.json` and a `media/` directory for imported assets. Media files are copied into this directory and assigned internal IDs, so duplicate filenames do not collide.

## Principles

1. Keep the editor independent from legacy projects and formats.
2. Keep UI, project data, media processing, and AI integrations separated.
3. Prefer non-destructive editing: source media is never modified by editing operations.
4. Make projects portable and versioned.
5. Keep rendering deterministic and testable.
6. Treat AI providers as optional adapters, never as the core of the editor.

## License

Not specified yet.
