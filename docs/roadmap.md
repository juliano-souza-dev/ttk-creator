# Roadmap

## 0.1.0 - Desktop foundation

- [x] Tauri 2 + React + TypeScript shell
- [x] Local project creation and listing
- [x] Project document persisted as project.json

## 0.2.0 - Media library and import

- [x] Native multi-file picker for local media
- [x] Copy imported assets into each project's media folder
- [x] Record asset metadata in project.json
- [x] YouTube URL inspection before download
- [x] Available-height quality selection
- [x] yt-dlp CLI integration with progress events
- [ ] Detect and guide installation of yt-dlp and FFmpeg
- [x] MP4 output and project asset registration
- [ ] Probe local media duration, dimensions, frame rate, and codecs with FFprobe
- [ ] Asset preview and remove/relink actions
- [ ] Drag-and-drop import

## 0.3.0 - Editing workspace

- [x] Video/image/audio preview in the desktop editor
- [x] Initial video/image and audio timeline lanes
- [x] Add, reorder, duplicate, remove, and split clips
- [x] Trim clip in/out points without changing source files
- [x] Timeline playhead, seek, and sequential preview playback
- [x] Per-clip audio volume control
- [x] Save and restore timeline state locally per project
- [ ] Place audio independently under video (true overlapping tracks)
- [ ] Persist timeline state in the versioned project document
- [ ] Caption editor and synchronization
- [ ] MP4 vertical export and rendering pipeline
