# Project schema

This package will own the versioned project document contract, validation rules, and representative fixtures.

The schema must describe edits rather than rendered output. It should remain independent from the desktop UI, FFmpeg command syntax, and AI provider payloads.

Before the first schema version is frozen, validate it against the core workflows: importing assets, placing clips, trimming, captions, audio, saving, reopening, and exporting.
