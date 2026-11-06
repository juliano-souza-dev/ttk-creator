use std::sync::{Arc, Mutex};
use tracing_appender::non_blocking::WorkerGuard;

use crate::{
    application::{ports::ProjectRepository, services::{MediaService, ProjectService}},
    infrastructure::media_storage::MediaStorage,
};

pub struct AppState {
    pub projects: ProjectService,
    pub media: MediaService,
    pub repository: Arc<dyn ProjectRepository>,
    pub media_storage: MediaStorage,
    // The worker must remain alive so buffered log records are flushed.
    pub(crate) _log_guard: Mutex<Option<WorkerGuard>>,
}
