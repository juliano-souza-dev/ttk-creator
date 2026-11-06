use tauri::{AppHandle, Emitter, State};
use crate::{
    domain::models::{DownloadProgress, MediaAsset, ProjectSummary, YoutubeInspection},
    infrastructure::youtube_downloader::YoutubeDownloader,
    state::AppState,
};

#[tauri::command]
pub fn list_projects(state: State<'_, AppState>) -> Result<Vec<ProjectSummary>, String> {
    state.projects.list()
}

#[tauri::command]
pub fn open_project(state: State<'_, AppState>, project_id: String) -> Result<ProjectSummary, String> {
    state.projects.open(&project_id)
}

#[tauri::command]
pub fn create_project(state: State<'_, AppState>, name: String) -> Result<ProjectSummary, String> {
    state.projects.create(&name)
}

#[tauri::command]
pub fn list_project_assets(state: State<'_, AppState>, project_id: String) -> Result<Vec<MediaAsset>, String> {
    state.media.list(&project_id)
}

#[tauri::command]
pub fn import_media_files(
    state: State<'_, AppState>,
    project_id: String,
    paths: Vec<String>,
) -> Result<Vec<MediaAsset>, String> {
    state.media.import_local(&project_id, &paths)
}

#[tauri::command]
pub fn get_project_asset_path(
    state: State<'_, AppState>,
    project_id: String,
    asset_id: String,
) -> Result<String, String> {
    use std::path::Component;

    let asset = state.media.list(&project_id)?.into_iter()
        .find(|item| item.id == asset_id)
        .ok_or_else(|| "Mídia não encontrada neste projeto.".to_string())?;
    let relative = std::path::PathBuf::from(&asset.relative_path);
    if relative.components().any(|part| !matches!(part, Component::Normal(_))) {
        return Err("Caminho de mídia inválido.".into());
    }
    let media_directory = state.media_storage.project_media_directory(&project_id)?;
    let project_directory = media_directory.parent()
        .ok_or_else(|| "Diretório do projeto inválido.".to_string())?
        .canonicalize().map_err(|error| error.to_string())?;
    let file_path = project_directory.join(relative).canonicalize()
        .map_err(|error| format!("Arquivo de mídia não encontrado: {error}"))?;
    if !file_path.starts_with(&project_directory) || !file_path.is_file() {
        return Err("O arquivo solicitado não pertence a este projeto.".into());
    }
    Ok(file_path.to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn inspect_youtube(url: String) -> Result<YoutubeInspection, String> {
    tauri::async_runtime::spawn_blocking(move || YoutubeDownloader::inspect(&url))
        .await
        .map_err(|error| format!("A consulta do YouTube foi interrompida: {error}"))?
}

#[tauri::command]
pub async fn download_youtube(
    app: AppHandle,
    state: State<'_, AppState>,
    project_id: String,
    url: String,
    max_height: Option<u32>,
) -> Result<MediaAsset, String> {
    let storage = state.media_storage.clone();
    let media = state.media.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let progress_app = app.clone();
        let progress_project = project_id.clone();
        let (asset, downloaded_file) = YoutubeDownloader::download(
            &url,
            &project_id,
            max_height,
            &storage,
            move |progress: DownloadProgress| {
                let _ = progress_app.emit("youtube-download-progress", progress);
            },
        )?;
        media.register_download(&project_id, &asset, &downloaded_file)?;
        let _ = app.emit("youtube-download-progress", DownloadProgress {
            project_id: progress_project,
            percent: Some(100.0),
            speed: None,
            eta: None,
            status: "completed".into(),
        });
        Ok(asset)
    })
    .await
    .map_err(|error| format!("A tarefa de download foi interrompida: {error}"))?
}
