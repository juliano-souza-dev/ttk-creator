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


#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportClip {
    id: String,
    asset_id: String,
    kind: String,
    source_start_ms: u64,
    source_end_ms: u64,
    timeline_start_ms: u64,
    volume: f64,
    muted: Option<bool>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportMotion {
    text: String,
    start_ms: u64,
    end_ms: u64,
    color: String,
    font_size: u32,
    x: f64,
    y: f64,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportRequest {
    project_id: String,
    destination: String,
    clips: Vec<ExportClip>,
    motion: Vec<ExportMotion>,
}

#[tauri::command]
pub async fn check_ffmpeg() -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let output = std::process::Command::new("ffmpeg")
            .arg("-version")
            .output()
            .map_err(|_| "FFmpeg não foi encontrado no PATH do Windows. Instale o FFmpeg e reinicie o FrameLab.".to_string())?;
        if !output.status.success() {
            return Err("O FFmpeg foi encontrado, mas não conseguiu iniciar.".into());
        }
        let version = String::from_utf8_lossy(&output.stdout);
        Ok(version.lines().next().unwrap_or("FFmpeg disponível").to_string())
    }).await.map_err(|error| format!("A verificação do FFmpeg foi interrompida: {error}"))?
}

fn ffmpeg_escape_text(value: &str) -> String {
        .replace("'", "\\\\'")
        .replace(':', "\\:")
        .replace('\\'', "\\\\'")
        .replace('%', "\\%")
        .replace(',', "\\,")
        .replace('[', "\\[")
        .replace(']', "\\]")
        .replace('\n', " ")
        .replace('\r', " ")
}

#[tauri::command]
pub async fn export_timeline(
    request: ExportRequest,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let assets = state.media.list(&request.project_id)?;
    let storage = state.media_storage.clone();

    tauri::async_runtime::spawn_blocking(move || {
        use std::{path::PathBuf, process::Command};

        if request.clips.is_empty() {
            return Err("Adicione pelo menos uma mídia à timeline antes de exportar.".to_string());
        }
        let destination = PathBuf::from(&request.destination);
        if destination.extension().and_then(|value| value.to_str()).map(|value| !value.eq_ignore_ascii_case("mp4")).unwrap_or(true) {
            return Err("O arquivo de destino precisa ter a extensão .mp4.".into());
        }
        let mut args: Vec<String> = vec!["-y".into(), "-hide_banner".into(), "-loglevel".into(), "error".into()];
        let mut filter_parts: Vec<String> = Vec::new();
        let mut visual_inputs: Vec<(usize, &ExportClip)> = Vec::new();
        let mut audio_inputs: Vec<(usize, &ExportClip)> = Vec::new();
        let mut total_ms = 0u64;

        for clip in &request.clips {
            if clip.source_end_ms <= clip.source_start_ms {
                continue;
            }
            let asset = assets.iter().find(|asset| asset.id == clip.asset_id)
                .ok_or_else(|| format!("A mídia do clipe {} não está mais na biblioteca.", clip.id))?;
            let relative = PathBuf::from(&asset.relative_path);
            if relative.components().any(|part| !matches!(part, std::path::Component::Normal(_))) {
                return Err("Caminho de mídia inválido durante a exportação.".into());
            }
            let media_dir = storage.project_media_directory(&request.project_id)?;
            let project_dir = media_dir.parent().ok_or("Diretório do projeto inválido.")?
                .canonicalize().map_err(|error| error.to_string())?;
            let file_path = project_dir.join(relative).canonicalize().map_err(|error| format!("Arquivo de mídia não encontrado: {error}"))?;
            if !file_path.starts_with(&project_dir) || !file_path.is_file() {
                return Err("Um arquivo da timeline não pertence a este projeto.".into());
            }
            let duration_ms = clip.source_end_ms - clip.source_start_ms;
            total_ms = total_ms.max(clip.timeline_start_ms + duration_ms);
            if clip.kind == "image" {
                args.extend(["-loop".into(), "1".into(), "-framerate".into(), "30".into(), "-t".into(), format!("{:.3}", duration_ms as f64 / 1000.0), "-i".into(), file_path.to_string_lossy().into_owned()]);
            } else {
                args.extend(["-ss".into(), format!("{:.3}", clip.source_start_ms as f64 / 1000.0), "-t".into(), format!("{:.3}", duration_ms as f64 / 1000.0), "-i".into(), file_path.to_string_lossy().into_owned()]);
            }
            let input_index = visual_inputs.len() + audio_inputs.len();
            if clip.kind == "audio" {
                audio_inputs.push((input_index, clip));
            } else {
                visual_inputs.push((input_index, clip));
            }
        }

        if visual_inputs.is_empty() {
            return Err("A timeline precisa conter pelo menos um vídeo ou uma imagem.".into());
        }
        for item in &request.motion {
            total_ms = total_ms.max(item.end_ms);
        }
        if total_ms == 0 {
            return Err("A duração da timeline é inválida.".into());
        }

        filter_parts.push(format!("color=c=black:s=1080x1920:r=30:d={:.3}[base0]", total_ms as f64 / 1000.0));
        let mut previous = "base0".to_string();
        for (position, (input_index, clip)) in visual_inputs.iter().enumerate() {
            let label = format!("visual{position}");
            let start = clip.timeline_start_ms as f64 / 1000.0;
            filter_parts.push(format!("[{input_index}:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=30,setsar=1,setpts=PTS-STARTPTS+{start:.3}/TB[{label}]"));
            let next = format!("base{}", position + 1);
            let end = (clip.timeline_start_ms + clip.source_end_ms - clip.source_start_ms) as f64 / 1000.0;
            filter_parts.push(format!("[{previous}][{label}]overlay=0:0:eof_action=pass:shortest=0:enable='between(t,{start:.3},{end:.3})'[{next}]"));
            previous = next;
        }

        for (index, item) in request.motion.iter().enumerate() {
            let text = ffmpeg_escape_text(&item.text);
            let color = if item.color.starts_with('#') && item.color.len() == 7 { format!("0x{}", &item.color[1..]) } else { "white".into() };
            let x = (item.x.clamp(0.0, 100.0) / 100.0) * 1080.0;
            let y = (item.y.clamp(0.0, 100.0) / 100.0) * 1920.0;
            let next = format!("text{index}");
            filter_parts.push(format!("[{previous}]drawtext=fontfile='C\\:/Windows/Fonts/arial.ttf':text='{text}':fontcolor={color}:fontsize={}:x='{}-text_w/2':y='{}-text_h/2':enable='between(t,{:.3},{:.3})'[{next}]", item.font_size.clamp(18, 140), x, y, item.start_ms as f64 / 1000.0, item.end_ms as f64 / 1000.0));
            previous = next;
        }
        filter_parts.push(format!("[{previous}]format=yuv420p[vout]"));

        let mut audio_labels = Vec::new();
        for (index, (input_index, clip)) in audio_inputs.iter().enumerate() {
            let label = format!("audio{index}");
            let delay = clip.timeline_start_ms;
            let volume = if clip.muted.unwrap_or(false) { 0.0 } else { clip.volume.clamp(0.0, 100.0) / 100.0 };
            filter_parts.push(format!("[{input_index}:a]asetpts=PTS-STARTPTS,volume={volume:.3},adelay={delay}|{delay}[{label}]"));
            audio_labels.push(format!("[{label}]"));
        }
        if !audio_labels.is_empty() {
            filter_parts.push(format!("{}amix=inputs={}:duration=longest:dropout_transition=0,atrim=duration={:.3}[aout]", audio_labels.join(""), audio_labels.len(), total_ms as f64 / 1000.0));
        }

        args.extend(["-filter_complex".into(), filter_parts.join(";"), "-map".into(), "[vout]".into()]);
        if !audio_labels.is_empty() {
            args.extend(["-map".into(), "[aout]".into(), "-c:a".into(), "aac".into(), "-b:a".into(), "192k".into()]);
        } else {
            args.push("-an".into());
        }
        args.extend(["-t".into(), format!("{:.3}", total_ms as f64 / 1000.0), "-c:v".into(), "libx264".into(), "-preset".into(), "medium".into(), "-crf".into(), "20".into(), "-pix_fmt".into(), "yuv420p".into(), "-movflags".into(), "+faststart".into(), destination.to_string_lossy().into_owned()]);

        let output = Command::new("ffmpeg").args(&args).output()
            .map_err(|_| "FFmpeg não foi encontrado no PATH. Instale-o e reinicie o FrameLab.".to_string())?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            let detail = stderr.lines().last().unwrap_or("Erro desconhecido do FFmpeg");
            return Err(format!("Falha ao exportar o vídeo: {detail}"));
        }
        Ok(destination.to_string_lossy().into_owned())
    }).await.map_err(|error| format!("A exportação foi interrompida: {error}"))?
}
