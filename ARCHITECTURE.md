# Architecture

The application is a **modular desktop monolith**. It uses Clean Architecture boundaries where they reduce coupling, without introducing distributed-system patterns or abstractions that have no current second implementation.

## Dependency direction

```text
Tauri commands (desktop boundary)
          |
          v
Application services (use cases)
          |
          v
Application ports (interfaces)
          ^
          |
Infrastructure adapters
  - SQLite project repository
  - Local media storage
  - yt-dlp process adapter

Domain models are shared inward. Domain code does not depend on Tauri, SQLite, React, or external processes.
```

## Backend layout

- `domain/models`: project, media, and YouTube data structures.
- `application/ports`: interfaces required by use cases.
- `application/services`: project and media workflows.
- `infrastructure/sqlite_project_repository`: durable project and asset metadata.
- `infrastructure/media_storage`: file copying and project media paths.
- `infrastructure/youtube_downloader`: yt-dlp process integration and progress parsing.
- `commands`: thin Tauri IPC adapters. They translate UI requests into application calls.
- `logging`: application-wide structured logging.
- `state`: dependencies composed once during application startup.

### SOLID, applied pragmatically

- **Single Responsibility:** commands handle IPC, services coordinate use cases, repositories persist data, and adapters handle operating-system/process details.
- **Open/Closed:** media sources and persistence implementations can be extended behind existing boundaries.
- **Liskov Substitution:** the project repository port defines behavior that any implementation must preserve.
- **Interface Segregation:** the repository port contains only operations currently required by project and media use cases.
- **Dependency Inversion:** application services depend on the repository port, not on rusqlite or Tauri.

We intentionally do not create interfaces for every struct or utility. A second implementation or a real testing seam should justify each new abstraction.

## Persistence decision

SQLite is the source of truth for project and media metadata.

- Database: `<app-data>/tiktok-media-creator.sqlite3`
- Journal mode: WAL
- Synchronous mode: NORMAL
- Foreign keys: enabled
- Busy timeout: 5 seconds
- Schema version: `PRAGMA user_version`
- Assets are inserted in transactions, and project timestamps are updated in the same transaction.

Large media files remain on disk under `<app-data>/projects/<project-id>/media/`. SQLite stores relative paths and metadata; it does not store video or audio blobs.

The application opens short-lived SQLite connections per repository operation. For this single-user desktop workload, WAL plus SQLite's page cache is sufficient. A connection pool would add lifecycle and locking complexity without a demonstrated performance benefit. If profiling later shows connection setup to be material, we can add a small pool behind the same repository port.

### Existing project migration

At startup, the repository imports legacy `project.json` files into SQLite using idempotent inserts. Original JSON files and media are left untouched. This avoids destructive migration and makes startup safe to repeat.

Future schema changes must increment `user_version` and add a forward-only migration. Never silently delete or rewrite user media during a schema migration.

## Logging

The backend uses `tracing` with a daily rolling file appender. Logs are written to:

`<app-data>/logs/tiktok-media-creator.log.YYYY-MM-DD`

Use structured fields for project IDs, asset IDs, operation names, and elapsed time where useful. Do not log raw media contents, credentials, cookies, or private user data. User-facing errors remain concise; logs may include the underlying technical cause.

## Frontend direction

The React layer should depend on typed desktop API functions and feature-level state, not on raw Tauri commands scattered across components. Shared domain types belong in one place. UI components should own presentation; hooks or feature services should own workflows.

## Testing strategy

- Domain parsing and validation: unit tests.
- SQLite repository: temporary database integration tests.
- Media storage: temporary directory tests, with rollback checks.
- YouTube adapter: URL and progress parser tests; do not make network calls in unit tests.
- Tauri commands: keep them thin so most behavior can be tested without starting a desktop window.
- CI: frontend type-check/build, Rust tests, and backend check on Windows.

## Trade-offs

SQLite is not a replacement for the media filesystem. WAL improves reader/writer concurrency but creates `-wal` and `-shm` sidecar files while the database is open. The application should close connections normally and must not manually copy only the main database file while it is active.

A local database is durable on the current device, not cloud-synchronized. Backup/export and project portability should be explicit product features rather than hidden assumptions.
