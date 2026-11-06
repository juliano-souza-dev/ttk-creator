# Desktop application

The first runnable desktop slice uses Tauri 2, React, TypeScript, and Vite.

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

## What works in this first slice

- Desktop shell and studio dashboard.
- Create a project with a name.
- Save a versioned `project.json` under the app's local data directory.
- List saved projects when the app starts.
- Search projects by name.

The project document starts with a 1080 × 1920 canvas at 30 FPS. Timeline editing, media import, playback, and export are future milestones.
