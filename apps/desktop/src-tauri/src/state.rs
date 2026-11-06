use std::sync::{Arc, Mutex};
use tracing_appender::non_blocking::WorkerGuard;

use crate::{
    application::ports::ProjectRepository,
    infrastructure::media_storage::MediaStorage,
};

pub struct AppState {
    pub projects: Arc<dyn ProjectRepository>,
    pub media_storage: MediaStorage,
    // Keeping the guard alive is required for buffered log writes to flush.
    pub(crate) _log_guard: Mutex<Option<WorkerGuard>>,
}
