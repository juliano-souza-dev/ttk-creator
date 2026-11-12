#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod application;
mod commands;
mod domain;
mod infrastructure;
mod logging;
mod process;
mod state;
mod translation;
mod transcription;

use std::{
    collections::HashSet,
    path::PathBuf,
    sync::{Arc, Mutex},
};
use tauri::Manager;

use application::services::{MediaService, ProjectService};
use infrastructure::{
    media_storage::MediaStorage,
    sqlite_project_repository::SqliteProjectRepository,
    youtube_cache::YoutubeCache,
};
use state::AppState;

fn resolve_media_shared_directory(app: &tauri::App) -> Result<Option<PathBuf>, String> {
    let mut candidates = Vec::<PathBuf>::new();

    if let Some(path) = std::env::var_os("NOVA_GENERATOR_SHARED_CONFIG") {
        candidates.push(PathBuf::from(path));
    }
    if let Ok(cwd) = std::env::current_dir() {
        let mut current = Some(cwd.as_path());
        while let Some(path) = current {
            candidates.push(path.join("shared.config.json"));
            current = path.parent();
        }
    }
    if let Ok(executable) = std::env::current_exe() {
        let mut current = executable.parent();
        while let Some(path) = current {
            candidates.push(path.join("shared.config.json"));
            current = path.parent();
        }
    }
    if let Ok(resource_dir) = app.path().resource_dir() {
        let mut current = Some(resource_dir.as_path());
        while let Some(path) = current {
            candidates.push(path.join("shared.config.json"));
            current = path.parent();
        }
    }

    let mut seen = HashSet::new();
    for candidate in candidates {
        let path = if candidate.is_dir() {
            candidate.join("shared.config.json")
        } else {
            candidate
        };
        if !seen.insert(path.clone()) || !path.is_file() {
            continue;
        }

        let raw = std::fs::read(&path).map_err(|error| {
            format!("Não foi possível ler o vínculo Shared Runtime em {}: {error}", path.display())
        })?;
        let manifest: serde_json::Value = serde_json::from_slice(&raw)
            .map_err(|error| format!("Manifesto Shared Runtime inválido em {}: {error}", path.display()))?;

        if manifest.get("schemaVersion").and_then(|value| value.as_str()) != Some("1.0") {
            return Err("A versão do shared.config.json não é compatível. Atualize o vínculo pelo Shared Runtime Manager.".into());
        }
        if manifest.pointer("/shared/enabled").and_then(|value| value.as_bool()) != Some(true) {
            return Err("O Shared Runtime está desativado para esta aplicação.".into());
        }

        let directory = manifest.pointer("/shared/directories/mediaShared")
            .and_then(|value| value.as_str())
            .ok_or("O manifesto Shared Runtime não informa shared.directories.mediaShared. Sincronize a aplicação pelo Shared Runtime Manager.")?;
        let directory = PathBuf::from(directory);
        if !directory.is_absolute() {
            return Err("O caminho shared.directories.mediaShared precisa ser absoluto.".into());
        }
        std::fs::create_dir_all(&directory).map_err(|error| {
            format!("Não foi possível preparar o diretório mediaShared ({}): {error}", directory.display())
        })?;
        return Ok(Some(directory));
    }

    Ok(None)
}

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
            let media_shared_directory = resolve_media_shared_directory(app)
                .map_err(std::io::Error::other)?;
            if media_shared_directory.is_none() {
                tracing::warn!("Shared Runtime não está vinculado. O cache de vídeos do YouTube ficará indisponível até sincronizar shared.config.json.");
            }
            let youtube_cache = YoutubeCache::new(media_shared_directory);
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
            commands::media::projects::list_projects,
            commands::media::projects::open_project,
            commands::media::projects::create_project,
            commands::media::projects::list_project_assets,
            commands::media::projects::get_project_asset_path,
            commands::media::projects::import_media_files,
            commands::media::youtube::inspect_youtube,
            commands::media::youtube::download_youtube,
            commands::media::youtube::prepare_youtube_cache,
            commands::media::youtube::trim_youtube_cache,
            commands::export::ffmpeg::check_ffmpeg,
            commands::sounds::list_global_sounds,
            commands::sounds::import_global_sound,
            commands::sounds::get_global_sound_path,
            commands::sounds::delete_global_sound,
            commands::transcription::transcribe_media,
            commands::transcription::check_local_asr,
            commands::transcription::install_local_asr,
            commands::export::export_timeline,
            translation::settings::get_groq_settings,
            translation::settings::save_groq_settings,
            translation::groq::test_groq_connection,
            translation::groq::translate_groq_chunk
        ])
        .run(tauri::generate_context!())
        .expect("error while running TikTok Media Creator");
}
