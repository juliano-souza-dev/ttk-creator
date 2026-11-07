mod application;
mod commands;
mod domain;
mod infrastructure;
mod logging;
mod state;

use std::{path::PathBuf, sync::{Arc, Mutex}};
use tauri::Manager;

use application::services::{MediaService, ProjectService};
use infrastructure::{media_storage::MediaStorage, sqlite_project_repository::SqliteProjectRepository};
use state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let app_data_directory = app.path().app_data_dir()?;
            std::fs::create_dir_all(&app_data_directory)?;

            let log_guard = logging::initialize(&app_data_directory.join("logs"))
                .map_err(std::io::Error::other)?;
            let projects_directory = app_data_directory.join("projects");
            let sound_library_directory = app_data_directory.join("sound-library");
            std::fs::create_dir_all(&sound_library_directory)?;
            let database_path: PathBuf = app_data_directory.join("tiktok-media-creator.sqlite3");
            let repository = Arc::new(
                SqliteProjectRepository::initialize(database_path, &projects_directory)
                    .map_err(std::io::Error::other)?,
            );
            let repository_port: Arc<dyn application::ports::ProjectRepository> = repository.clone();
            let media_storage = MediaStorage::new(app_data_directory.clone());
            let projects = ProjectService::new(repository_port.clone(), media_storage.clone());
            let media = MediaService::new(repository_port.clone(), media_storage.clone());
            tracing::info!("TikTok Media Creator started");
            app.manage(AppState {
                projects,
                media,
                media_storage,
                sound_library_directory,
                _log_guard: Mutex::new(Some(log_guard)),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_projects,
            commands::open_project,
            commands::create_project,
            commands::list_project_assets,
            commands::get_project_asset_path,
            commands::import_media_files,
            commands::inspect_youtube,
            commands::download_youtube,
            commands::check_ffmpeg,
            commands::list_global_sounds,
            commands::import_global_sound,
            commands::get_global_sound_path,
            commands::delete_global_sound,
            commands::export_timeline
        ])
        .run(tauri::generate_context!())
        .expect("error while running TikTok Media Creator");
}
