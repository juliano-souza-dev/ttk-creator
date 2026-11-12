mod application;
mod commands;
mod domain;
mod infrastructure;
mod logging;
mod process;
mod state;
mod translation;
mod transcription;

use std::{path::PathBuf, sync::{Arc, Mutex}};
use tauri::Manager;

use application::services::{MediaService, ProjectService};
use infrastructure::{media_storage::MediaStorage, sqlite_project_repository::SqliteProjectRepository, youtube_cache::YoutubeCache};
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
            let youtube_cache = YoutubeCache::new(app_data_directory.join("youtube-cache"));
            youtube_cache.cleanup_expired().map_err(std::io::Error::other)?;
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
            let cleanup_cache = youtube_cache.clone();
            std::thread::spawn(move || loop {
                std::thread::sleep(std::time::Duration::from_secs(60 * 60));
                if let Err(error) = cleanup_cache.cleanup_expired() {
                    tracing::warn!(%error, "Could not clean expired YouTube cache entries");
                }
            });
            tracing::info!("TikTok Media Creator started");
            app.manage(AppState {
                projects,
                media,
                media_storage,
                youtube_cache,
                sound_library_directory,
                _log_guard: Mutex::new(Some(log_guard)),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::media::list_projects,
            commands::media::open_project,
            commands::media::create_project,
            commands::media::list_project_assets,
            commands::media::get_project_asset_path,
            commands::media::import_media_files,
            commands::media::inspect_youtube,
            commands::media::download_youtube,
            commands::media::prepare_youtube_cache,
            commands::media::trim_youtube_cache,
            commands::export::check_ffmpeg,
            commands::sounds::list_global_sounds,
            commands::sounds::import_global_sound,
            commands::sounds::get_global_sound_path,
            commands::sounds::delete_global_sound,
            commands::transcription::transcribe_media,
            commands::transcription::check_local_asr,
            commands::transcription::install_local_asr,
            commands::export::export_timeline,
            translation::get_groq_settings,
            translation::save_groq_settings,
            translation::test_groq_connection,
            translation::translate_groq_chunk
        ])
        .run(tauri::generate_context!())
        .expect("error while running TikTok Media Creator");
}
