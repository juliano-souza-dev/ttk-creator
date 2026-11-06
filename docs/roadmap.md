# Roadmap

The roadmap is milestone-based. A milestone is complete only when its acceptance criteria are verified in the application.

## Milestone 0 - Repository foundation

- [x] Establish the independent product boundary.
- [x] Record the initial architecture and technology direction.
- [x] Define repository ownership boundaries.
- [ ] Add runnable desktop and API development environments.

## Milestone 1 - Desktop shell

- [ ] Create the Tauri 2 + React + TypeScript application.
- [ ] Add a clean application layout and navigation.
- [ ] Add typed frontend service boundaries.
- [ ] Run the application on Windows in development mode.
- [ ] Document setup and troubleshooting.

**Acceptance:** a Windows user can install dependencies, start the app, and open the desktop shell without manual code changes.

## Milestone 2 - Projects and media foundation

- [ ] Define and validate the first version of the project schema.
- [ ] Create, open, rename, and delete local projects.
- [ ] Import video, image, and audio files without modifying originals.
- [ ] Probe media metadata through FFmpeg.
- [ ] Persist project and asset metadata.
- [ ] Handle missing or moved source files.

**Acceptance:** a project can be closed and reopened with its imported media correctly represented.

## Milestone 3 - Preview and timeline

- [ ] Build the preview surface.
- [ ] Add a multi-track timeline.
- [ ] Add clip placement, trimming, splitting, and moving.
- [ ] Keep timeline state synchronized with the project document.
- [ ] Add undo/redo for editing operations.

**Acceptance:** users can assemble and revise a basic short-form edit without rendering after every change.

## Milestone 4 - Captions and audio

- [ ] Add caption segments with editable text and timing.
- [ ] Add caption styling and safe-area guides.
- [ ] Add audio levels, fades, and basic trimming.
- [ ] Add transcription as an optional provider-backed workflow.

**Acceptance:** a narrated video can be captioned and previewed with synchronized timing.

## Milestone 5 - Export

- [ ] Add vertical presets for 9:16 output.
- [ ] Build a render graph from the project document.
- [ ] Show render progress, cancellation, and actionable errors.
- [ ] Validate output dimensions, frame rate, and audio.
- [ ] Preserve project editability after export.

**Acceptance:** a short-form MP4 can be exported from a saved project and independently verified.

## Later milestones

- Motion graphics and reusable visual templates.
- AI-assisted scripts, translation, transcription, and voice workflows.
- Proxy media and performance optimization.
- Additional aspect ratios and platform presets.
- Optional web client, after core domain boundaries prove stable.

## Working agreement

- Integrate work into `main`, as requested for this repository.
- Keep commits focused and descriptive.
- Do not claim a milestone is complete without running its acceptance checks.
- Prefer small vertical slices that can be tested end-to-end.
