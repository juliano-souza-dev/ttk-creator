# Desktop app

## Development

From this directory:

```bash
npm install
npm run tauri dev
```

The Windows desktop build requires Node.js, Rust/Cargo, Microsoft C++ Build Tools, and WebView2.

## Media import

Local imports use the native Tauri file picker. Imported files are copied into the selected project's `media/` directory. The original files are never modified.

Supported local formats:

- Video: MP4, MOV, M4V, MKV, WebM, AVI
- Audio: MP3, WAV, M4A, AAC, FLAC, OGG, OPUS
- Image: PNG, JPG/JPEG, WebP, GIF, BMP

YouTube inspection and downloads use the yt-dlp command-line tool. Install it in a Python environment available to the app with `py -m pip install --upgrade yt-dlp`. FFmpeg must also be installed separately and available on PATH so yt-dlp can merge separate audio/video streams and remux downloads to MP4. The app checks for `yt-dlp` on PATH, then tries `py -m yt_dlp`, `python -m yt_dlp`, and `python3 -m yt_dlp`.

YouTube format availability is determined by the source. The importer offers the available video heights and remuxes the selected download to MP4. Only import videos that you have permission to download and reuse.

Each asset is registered in the project's `project.json` and stored under its `media/` directory.
