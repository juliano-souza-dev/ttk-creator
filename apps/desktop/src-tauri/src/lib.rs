use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{fs, path::{Path, PathBuf}, time::{SystemTime, UNIX_EPOCH}};
use tauri::{AppHandle, Emitter, Manager};
use uuid::Uuid;
use yt_dlp::{Downloader, model::selector::VideoQuality};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProjectSummary {
    id: String,
    name: String,
    created_at: String,
    updated_at: String,
    width: u32,
    height: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MediaAsset {
    id: String,
    name: String,
    original_name: String,
    kind: String,
    mime_type: String,
    size_bytes: u64,
    relative_path: String,
    source: String,
    source_url: Option<String>,
    duration_ms: Option<u64>,
    width: Option<u32>,
    height: Option<u32>,
    created_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct YoutubeQuality {
    height: u32,
    label: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct YoutubeInspection {
    video_id: String,
    url: String,
    title: String,
    channel: Option<String>,
    duration_ms: Option<u64>,
    thumbnail: Option<String>,
    qualities: Vec<YoutubeQuality>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DownloadProgress {
    project_id: String,
    percent: Option<f32>,
    speed: Option<String>,
    eta: Option<String>,
    status: String,
}

fn timestamp_millis() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .to_string()
}

fn projects_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let mut path = app.path().app_data_dir().map_err(|e| e.to_string())?;
    path.push("projects");
    fs::create_dir_all(&path).map_err(|e| e.to_string())?;
    Ok(path)
}

fn project_folder(app: &AppHandle, id: &str) -> Result<PathBuf, String> {
    Uuid::parse_str(id).map_err(|_| "Identificador de projeto inválido.".to_string())?;
    let path = projects_dir(app)?.join(id);
    if !path.is_dir() {
        return Err("Projeto não encontrado neste dispositivo.".into());
    }
    Ok(path)
}

fn read_project(app: &AppHandle, id: &str) -> Result<(PathBuf, Value), String> {
    let file = project_folder(app, id)?.join("project.json");
    let content = fs::read_to_string(&file).map_err(|e| e.to_string())?;
    let document = serde_json::from_str(&content).map_err(|e| e.to_string())?;
    Ok((file, document))
}

fn save_project(file: &Path, document: &Value) -> Result<(), String> {
    let temporary = file.with_extension("json.tmp");
    let serialized = serde_json::to_string_pretty(document).map_err(|e| e.to_string())?;
    fs::write(&temporary, serialized).map_err(|e| e.to_string())?;
    let backup = file.with_extension("json.bak");
    let had_original = file.exists();
    if had_original {
        if let Err(error) = fs::rename(file, &backup) {
            let _ = fs::remove_file(&temporary);
            return Err(format!("Não foi possível preparar a atualização do projeto: {error}"));
        }
    }
    if let Err(error) = fs::rename(&temporary, file) {
        if had_original {
            let _ = fs::rename(&backup, file);
        }
        let _ = fs::remove_file(&temporary);
        return Err(format!("Não foi possível salvar a biblioteca do projeto: {error}"));
    }
    if had_original {
        let _ = fs::remove_file(backup);
    }
    Ok(())
}

fn append_assets(
    app: &AppHandle,
    project_id: &str,
    assets: &[MediaAsset],
    rollback_files: &[PathBuf],
) -> Result<(), String> {
    let result = (|| {
        let (file, mut document) = read_project(app, project_id)?;
        let list = document
            .get_mut("assets")
            .and_then(Value::as_array_mut)
            .ok_or("O documento do projeto não possui uma biblioteca de mídia válida.")?;
        for asset in assets {
            list.push(serde_json::to_value(asset).map_err(|e| e.to_string())?);
        }
        save_project(&file, &document)
    })();

    if result.is_err() {
        for path in rollback_files {
            let _ = fs::remove_file(path);
        }
    }
    result
}

fn make_asset(
    id: String,
    name: String,
    original_name: String,
    kind: &str,
    mime_type: &str,
    size_bytes: u64,
    relative_path: String,
    source: &str,
    source_url: Option<String>,
    duration_ms: Option<u64>,
    width: Option<u32>,
    height: Option<u32>,
) -> MediaAsset {
    MediaAsset {
        id,
        name,
        original_name,
        kind: kind.into(),
        mime_type: mime_type.into(),
        size_bytes,
        relative_path,
        source: source.into(),
        source_url,
        duration_ms,
        width,
        height,
        created_at: timestamp_millis(),
    }
}

fn classify_extension(extension: &str) -> Option<(&'static str, &'static str)> {
    match extension.to_ascii_lowercase().as_str() {
        "mp4" => Some(("video", "video/mp4")),
        "mov" => Some(("video", "video/quicktime")),
        "m4v" => Some(("video", "video/x-m4v")),
        "mkv" => Some(("video", "video/x-matroska")),
        "webm" => Some(("video", "video/webm")),
        "avi" => Some(("video", "video/x-msvideo")),
        "mp3" => Some(("audio", "audio/mpeg")),
        "wav" => Some(("audio", "audio/wav")),
        "m4a" => Some(("audio", "audio/mp4")),
        "aac" => Some(("audio", "audio/aac")),
        "flac" => Some(("audio", "audio/flac")),
        "ogg" => Some(("audio", "audio/ogg")),
        "opus" => Some(("audio", "audio/opus")),
        "png" => Some(("image", "image/png")),
        "jpg" | "jpeg" => Some(("image", "image/jpeg")),
        "webp" => Some(("image", "image/webp")),
        "gif" => Some(("image", "image/gif")),
        "bmp" => Some(("image", "image/bmp")),
        _ => None,
    }
}

#[tauri::command]
fn list_projects(app: AppHandle) -> Result<Vec<ProjectSummary>, String> {
    let directory = projects_dir(&app)?;
    let mut projects = Vec::new();

    for entry in fs::read_dir(directory).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let project_file = entry.path().join("project.json");
        if !project_file.is_file() {
            continue;
        }
        let content = fs::read_to_string(project_file).map_err(|e| e.to_string())?;
        let document: Value = serde_json::from_str(&content).map_err(|e| e.to_string())?;
        let Some(project_value) = document.get("project") else {
            continue;
        };
        if let Ok(project) = serde_json::from_value::<ProjectSummary>(project_value.clone()) {
            projects.push(project);
        }
    }

    projects.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    Ok(projects)
}

#[tauri::command]
fn create_project(app: AppHandle, name: String) -> Result<ProjectSummary, String> {
    let clean_name = name.trim();
    if clean_name.is_empty() {
        return Err("Informe um nome para o projeto.".into());
    }
    if clean_name.chars().count() > 80 {
        return Err("O nome do projeto deve ter no máximo 80 caracteres.".into());
    }

    let now = timestamp_millis();
    let id = Uuid::new_v4().to_string();
    let project = ProjectSummary {
        id: id.clone(),
        name: clean_name.to_string(),
        created_at: now.clone(),
        updated_at: now,
        width: 1080,
        height: 1920,
    };

    let folder = projects_dir(&app)?.join(&id);
    fs::create_dir_all(folder.join("media")).map_err(|e| e.to_string())?;

    let document = json!({
        "schemaVersion": 1,
        "project": project,
        "canvas": {
            "width": 1080,
            "height": 1920,
            "frameRate": 30,
            "background": "#101114"
        },
        "assets": [],
        "tracks": [],
        "captions": []
    });

    let output = folder.join("project.json");
    let serialized = serde_json::to_string_pretty(&document).map_err(|e| e.to_string())?;
    if let Err(error) = fs::write(output, serialized) {
        let _ = fs::remove_dir_all(folder);
        return Err(error.to_string());
    }

    serde_json::from_value(document["project"].clone()).map_err(|e| e.to_string())
}

#[tauri::command]
fn list_project_assets(app: AppHandle, project_id: String) -> Result<Vec<MediaAsset>, String> {
    let (_, document) = read_project(&app, &project_id)?;
    serde_json::from_value(document.get("assets").cloned().unwrap_or_else(|| json!([])))
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn import_media_files(
    app: AppHandle,
    project_id: String,
    paths: Vec<String>,
) -> Result<Vec<MediaAsset>, String> {
    if paths.is_empty() {
        return Ok(Vec::new());
    }
    if paths.len() > 100 {
        return Err("Importe até 100 arquivos por vez.".into());
    }

    let folder = project_folder(&app, &project_id)?.join("media");
    fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
    let mut assets = Vec::new();
    let mut copied: Vec<PathBuf> = Vec::new();

    for raw_path in paths {
        let result = (|| {
            let source = PathBuf::from(&raw_path)
                .canonicalize()
                .map_err(|e| format!("Não foi possível acessar o arquivo selecionado: {e}"))?;
            if !source.is_file() {
                return Err("Um dos itens selecionados não é um arquivo.".to_string());
            }
            let original_name = source
                .file_name()
                .and_then(|value| value.to_str())
                .ok_or("Nome de arquivo inválido.")?
                .to_string();
            let extension = source.extension().and_then(|value| value.to_str()).unwrap_or("");
            let (kind, mime_type) = classify_extension(extension)
                .ok_or_else(|| format!("Formato não suportado: .{extension}"))?;

            let id = Uuid::new_v4().to_string();
            let filename = format!("{id}.{}", extension.to_ascii_lowercase());
            let destination = folder.join(&filename);
            fs::copy(&source, &destination)
                .map_err(|e| format!("Falha ao copiar {original_name}: {e}"))?;
            copied.push(destination.clone());

            let size_bytes = fs::metadata(&destination).map_err(|e| e.to_string())?.len();
            Ok(make_asset(
                id,
                original_name.clone(),
                original_name,
                kind,
                mime_type,
                size_bytes,
                format!("media/{filename}"),
                "local",
                None,
                None,
                None,
                None,
            ))
        })();

        match result {
            Ok(asset) => assets.push(asset),
            Err(error) => {
                for path in &copied {
                    let _ = fs::remove_file(path);
                }
                return Err(error);
            }
        }
    }

    append_assets(&app, &project_id, &assets, &copied)?;
    Ok(assets)
}

fn normalize_youtube_url(raw: &str) -> Result<(String, String), String> {
    let candidate = raw.trim();
    if candidate.is_empty() { return Err("Cole um link do YouTube.".into()); }
    let value = if candidate.contains("://") { candidate.to_string() } else { format!("https://{candidate}") };
    let parsed = url::Url::parse(&value).map_err(|_| "Link do YouTube inválido.".to_string())?;
    let host = parsed.host_str().unwrap_or("").to_ascii_lowercase();
    let segments: Vec<&str> = parsed.path_segments().map(|s| s.collect()).unwrap_or_default();
    let id: Option<String> = if host == "youtu.be" {
        segments.first().map(|s| (*s).to_string())
    } else if ["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com",
        "youtube-nocookie.com", "www.youtube-nocookie.com"].contains(&host.as_str()) {
        if parsed.path() == "/watch" {
            parsed.query_pairs().find(|(key, _)| key == "v").map(|(_, value)| value.into_owned())
        } else if segments.len() >= 2 && ["embed", "shorts", "live", "v"].contains(&segments[0]) {
            segments.get(1).map(|s| (*s).to_string())
        } else { None }
    } else { return Err("O link precisa ser de um vídeo do YouTube.".into()); };
    let id = id.ok_or("Não foi possível identificar o vídeo neste link.")?;
    if id.len() != 11 || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-') {
        return Err("O identificador do vídeo do YouTube é inválido.".into());
    }
    Ok((id.clone(), format!("https://www.youtube.com/watch?v={id}")))
}

async fn youtube_downloader(app: &AppHandle) -> Result<Downloader, String> {
    let app_data = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let tools = app_data.join("tools");
    let output = app_data.join("youtube-cache");
    fs::create_dir_all(&tools).map_err(|e| e.to_string())?;
    fs::create_dir_all(&output).map_err(|e| e.to_string())?;
    let builder = Downloader::with_new_binaries(tools, output).await
        .map_err(|e| format!("Não foi possível preparar o importador do YouTube: {e}"))?;
    builder.build().await.map_err(|e| format!("Não foi possível iniciar o importador do YouTube: {e}"))
}

fn youtube_inspection(video: &yt_dlp::model::Video, canonical: String, video_id: String) -> YoutubeInspection {
    let mut heights = std::collections::BTreeSet::new();
    for format in &video.formats {
        if format.is_video() {
            if let Some(height) = format.video_resolution.height {
                if height > 0 && height <= 2160 { heights.insert(height); }
            }
        }
    }
    let mut qualities: Vec<YoutubeQuality> = heights.into_iter().rev()
        .map(|height| YoutubeQuality { height, label: format!("{height}p") }).collect();
    if qualities.is_empty() {
        qualities.push(YoutubeQuality { height: 720, label: "Melhor disponível".into() });
    }
    YoutubeInspection {
        video_id,
        url: canonical,
        title: video.title.chars().take(255).collect(),
        channel: video.channel.clone().or_else(|| video.uploader.clone()),
        duration_ms: video.duration.map(|seconds| (seconds.max(0) as u64) * 1000),
        thumbnail: video.thumbnail.clone(),
        qualities,
    }
}

#[tauri::command]
async fn inspect_youtube(app: AppHandle, url: String) -> Result<YoutubeInspection, String> {
    let (video_id, canonical) = normalize_youtube_url(&url)?;
    let downloader = youtube_downloader(&app).await?;
    let video = downloader.fetch_video_infos(canonical.clone()).await
        .map_err(|e| format!("Não foi possível inspecionar o vídeo: {e}"))?;
    if video.id != video_id { return Err("O YouTube retornou um vídeo diferente do link informado.".into()); }
    Ok(youtube_inspection(&video, canonical, video_id))
}

#[tauri::command]
async fn download_youtube(
    app: AppHandle,
    project_id: String,
    url: String,
    max_height: Option<u32>,
) -> Result<MediaAsset, String> {
    let (video_id, canonical) = normalize_youtube_url(&url)?;
    let height = max_height.unwrap_or(1080);
    if height != 0 && !(144..=2160).contains(&height) { return Err("Qualidade selecionada inválida.".into()); }

    let project = project_folder(&app, &project_id)?;
    let media_folder = project.join("media");
    fs::create_dir_all(&media_folder).map_err(|e| e.to_string())?;
    let downloader = youtube_downloader(&app).await?;
    let video = downloader.fetch_video_infos(canonical.clone()).await
        .map_err(|e| format!("Não foi possível acessar o vídeo: {e}"))?;
    if video.id != video_id { return Err("O YouTube retornou um vídeo diferente do link informado.".into()); }

    let asset_id = Uuid::new_v4().to_string();
    let destination = media_folder.join(format!("{asset_id}.mp4"));
    let app_for_progress = app.clone();
    let project_for_progress = project_id.clone();
    let quality = if height == 0 { VideoQuality::Best } else { VideoQuality::CustomHeight(height) };
    let downloaded = downloader.download(&video, destination.clone())
        .video_quality(quality)
        .with_progress(move |fraction| {
            let _ = app_for_progress.emit("youtube-download-progress", DownloadProgress {
                project_id: project_for_progress.clone(),
                percent: Some((fraction * 100.0) as f32),
                speed: None,
                eta: None,
                status: "downloading".into(),
            });
        })
        .execute().await
        .map_err(|e| format!("Falha ao baixar o vídeo: {e}"))?;

    if !downloaded.is_file() {
        return Err("O download terminou, mas o arquivo MP4 não foi encontrado.".into());
    }
    let size = fs::metadata(&downloaded).map_err(|e| e.to_string())?.len();
    if size == 0 { return Err("O arquivo baixado está vazio.".into()); }
    if downloaded != destination {
        fs::copy(&downloaded, &destination).map_err(|e| e.to_string())?;
        let _ = fs::remove_file(&downloaded);
    }

    let title = video.title.clone();
    let safe_name: String = title.chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
        .take(48).collect();
    let asset = MediaAsset {
        id: asset_id.clone(),
        name: title.clone(),
        original_name: format!("{safe_name}.mp4"),
        kind: "video".into(),
        mime_type: "video/mp4".into(),
        size_bytes: size,
        relative_path: format!("media/{asset_id}.mp4"),
        source: "youtube".into(),
        source_url: Some(canonical),
        duration_ms: video.duration.map(|seconds| (seconds.max(0) as u64) * 1000),
        width: None,
        height: if height == 0 { video.formats.iter().filter_map(|f| f.video_resolution.height).max() } else { Some(height) },
        created_at: timestamp_millis(),
    };
    append_assets(&app, &project_id, &[asset.clone()], &[destination])?;
    let _ = app.emit("youtube-download-progress", DownloadProgress {
        project_id, percent: Some(100.0), speed: None, eta: None, status: "completed".into(),
    });
    Ok(asset)
}


#[cfg(test)]
mod youtube_url_tests {
    use super::normalize_youtube_url;
    #[test]
    fn parses_supported_youtube_links() {
        let id = "abcdefghijk";
        assert_eq!(normalize_youtube_url(&format!("https://youtube.com/watch?v={id}")).unwrap().0, id);
        assert_eq!(normalize_youtube_url(&format!("https://youtu.be/{id}")).unwrap().0, id);
        assert_eq!(normalize_youtube_url(&format!("https://youtube.com/shorts/{id}")).unwrap().0, id);
    }
    #[test]
    fn rejects_non_youtube_hosts() {
        assert!(normalize_youtube_url("https://example.com/watch?v=abcdefghijk").is_err());
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            list_projects,
            create_project,
            list_project_assets,
            import_media_files,
            inspect_youtube,
            download_youtube
        ])
        .run(tauri::generate_context!())
        .expect("error while running TikTok Media Creator");
}
