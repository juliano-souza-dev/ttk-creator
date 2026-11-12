use tauri::{AppHandle, Emitter, State};
use crate::{
    domain::models::{DownloadProgress, MediaAsset, ProjectSummary, YoutubeInspection},
    infrastructure::youtube_downloader::YoutubeDownloader,
    state::AppState,
};
use super::export::resolve_ffmpeg_executable;

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


#[tauri::command]
pub async fn prepare_youtube_cache(
    state: State<'_, AppState>,
    url: String,
    max_height: Option<u32>,
) -> Result<crate::infrastructure::youtube_cache::YoutubeCacheEntry, String> {
    let cache = state.youtube_cache.clone();
    tauri::async_runtime::spawn_blocking(move || cache.prepare(&url, max_height.unwrap_or(1080)))
        .await.map_err(|e| format!("A preparação do vídeo foi interrompida: {e}"))?
}

#[tauri::command]
pub async fn trim_youtube_cache(
    state: State<'_, AppState>,
    project_id: String,
    video_id: String,
    start_ms: u64,
    end_ms: u64,
) -> Result<MediaAsset, String> {
    let cache = state.youtube_cache.clone();
    let storage = state.media_storage.clone();
    let media = state.media.clone();
    tauri::async_runtime::spawn_blocking(move || {
        if end_ms <= start_ms || end_ms - start_ms < 300 {
            return Err("Selecione um trecho de pelo menos 0,3 segundo.".to_string());
        }
        let _cache_guard = cache.lock()?;
        let entry = cache.validate_entry(&video_id)?;
        if let Some(duration) = entry.duration_ms {
            if end_ms > duration { return Err("O fim do recorte ultrapassa a duração do vídeo.".into()); }
        }
        let media_dir = storage.project_media_directory(&project_id)?;
        let id = uuid::Uuid::new_v4().to_string();
        let output = media_dir.join(format!("{id}.mp4"));
        let (ffmpeg, _) = resolve_ffmpeg_executable()?;
        let duration = end_ms - start_ms;
        let result = crate::process::hidden_command(ffmpeg)
            .args(["-y", "-hide_banner", "-loglevel", "error", "-ss"])
            .arg(format!("{:.3}", start_ms as f64 / 1000.0))
            .arg("-i").arg(&entry.file_path)
            .arg("-t").arg(format!("{:.3}", duration as f64 / 1000.0))
            .args(["-map", "0:v:0", "-map", "0:a?", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart"])
            .arg(&output)
            .output()
            .map_err(|e| format!("Não foi possível iniciar o recorte: {e}"))?;
        if !result.status.success() {
            let _ = std::fs::remove_file(&output);
            return Err(format!("O FFmpeg não conseguiu gerar o trecho: {}", String::from_utf8_lossy(&result.stderr).trim()));
        }
        let size_bytes = std::fs::metadata(&output).map_err(|e| e.to_string())?.len();
        if size_bytes == 0 { let _ = std::fs::remove_file(&output); return Err("O trecho gerado está vazio.".into()); }
        let safe_title: String = entry.title.chars().map(|ch| if ch.is_ascii_alphanumeric() || ch=='-' || ch=='_' {ch} else {'_'}).take(42).collect();
        let asset = MediaAsset {
            id: id.clone(),
            name: format!("{} (trecho)", entry.title),
            original_name: format!("{safe_title}_clip.mp4"),
            kind: "video".into(),
            mime_type: "video/mp4".into(),
            size_bytes,
            relative_path: format!("media/{id}.mp4"),
            source: "youtube".into(),
            source_url: Some(format!("https://www.youtube.com/watch?v={video_id}")),
            duration_ms: Some(duration),
            width: None,
            height: None,
            created_at: crate::domain::models::timestamp_millis(),
        };
        media.register_download(&project_id, &asset, &output)?;
        Ok(asset)
    }).await.map_err(|e| format!("O recorte foi interrompido: {e}"))?
}
