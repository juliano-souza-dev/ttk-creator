# Desktop application

The desktop app uses Tauri 2, React, TypeScript, Vite, and a Rust backend.

## Requirements

- Node.js (LTS) and npm
- Rust toolchain
- Microsoft C++ Build Tools
- WebView2 Runtime

See the official [Tauri v2 Windows prerequisites](https://v2.tauri.app/start/prerequisites/).

## Run in development

From this directory in PowerShell:

```powershell
npm install
npm run tauri dev
```

## Build a Windows installer

```powershell
npm run tauri build
```

## Media import

The media library currently supports:

- Local video: MP4, MOV, M4V, MKV, WebM, AVI.
- Local audio: MP3, WAV, M4A, AAC, FLAC, OGG, OPUS.
- Images: PNG, JPG, JPEG, WebP, GIF, BMP.
- Up to 100 selected files per import operation.
- Project-local copies under `projects/<id>/media/`; original files are not modified.
- YouTube video inspection, quality selection, MP4 download, and progress reporting.

### YouTube tools

Install yt-dlp:

```powershell
py -m pip install -U yt-dlp
```

Install FFmpeg and make sure `ffmpeg.exe` is available in PATH. Verify both:

```powershell
yt-dlp --version
ffmpeg -version
```

The app searches for `yt-dlp`, `yt-dlp.exe`, and Python module launchers (`py -m yt_dlp`, `python -m yt_dlp`, `python3 -m yt_dlp`). The standalone app bundle does not include these external tools yet.

YouTube availability is not guaranteed for private, restricted, age-gated, region-blocked, or authentication-required videos. Only download content you have permission to use.

## Project document

Each project starts with a 1080 × 1920 canvas at 30 FPS and a versioned `project.json`. Imported assets are recorded in the document with a relative path, media type, source, and file metadata.

Timeline editing, media playback, captions, and final rendering are upcoming milestones.
