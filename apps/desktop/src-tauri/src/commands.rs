use tauri::{AppHandle, Emitter, State};
use crate::{
    transcription::{TranscriptResult},
    domain::models::{DownloadProgress, MediaAsset, ProjectSummary, YoutubeInspection},
    infrastructure::youtube_downloader::YoutubeDownloader,
    state::AppState,
};

#[tauri::command]
pub async fn transcribe_media(
    app: AppHandle,
    state: State<'_, AppState>,
    project_id: String,
    asset_id: String,
    mode: String,
    language: Option<String>,
    local_model: Option<String>,
) -> Result<TranscriptResult, String> {
    let media = state.media.clone();
    let storage = state.media_storage.clone();
    tauri::async_runtime::spawn_blocking(move || crate::transcription::transcribe(
        app, media, storage, project_id, asset_id, mode, language,
        local_model.unwrap_or_else(|| "small".into()),
    )).await.map_err(|e| format!("A transcrição foi interrompida: {e}"))?
}

#[tauri::command]
pub fn check_local_asr() -> Result<bool, String> { crate::transcription::check_local_asr() }

#[tauri::command]
pub async fn install_local_asr() -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(crate::transcription::install_local_asr)
        .await.map_err(|e| format!("A instalação foi interrompida: {e}"))?
}


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
    #[serde(default)]
    transition_type: String,
    #[serde(default)]
    transition_ms: u64,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExportCaptionWord {
    text: String,
    start_ms: u64,
    end_ms: u64,
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
    #[serde(default)]
    font_family: String,
    #[serde(default)]
    font_weight: u32,
    #[serde(default)]
    text_align: String,
    #[serde(default)]
    preset: String,
    #[serde(default)]
    duration_ms: u64,
    #[serde(default)]
    typewriter_duration_ms: u64,
    #[serde(default)]
    is_caption: bool,
    #[serde(default)]
    caption_words: Vec<ExportCaptionWord>,
    #[serde(default)]
    caption_accent: String,
    #[serde(default)]
    caption_background_color: String,
    #[serde(default)]
    caption_background_opacity: f64,
    #[serde(default)]
    caption_width: f64,
    #[serde(default)]
    caption_padding_em: f64,
    #[serde(default)]
    caption_border_radius_em: f64,
    #[serde(default)]
    lucide_icon_png: Option<String>,
    #[serde(default)]
    lucide_icon_anchor: String,
    #[serde(default)]
    lucide_icon_size: u32,
    #[serde(default)]
    lucide_icon_offset_x: f64,
    #[serde(default)]
    lucide_icon_offset_y: f64,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportImageOverlay {
    asset_id:String, start_ms:u64, end_ms:u64, x:f64, y:f64, width:u32, height:u32,
    #[serde(default = "default_overlay_animation")]
    entrance_animation: String,
    #[serde(default = "default_overlay_animation_duration")]
    entrance_duration_ms: u64,
}

fn default_overlay_animation() -> String { "none".into() }
fn default_overlay_animation_duration() -> u64 { 600 }

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportSoundEffect {
    sound_id: String,
    timeline_start_ms: u64,
    volume: f64,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportRequest {
    project_id: String,
    destination: String,
    clips: Vec<ExportClip>,
    motion: Vec<ExportMotion>,
    #[serde(default)]
    image_overlays: Vec<ExportImageOverlay>,
    #[serde(default)]
    sound_effects: Vec<ExportSoundEffect>,
}

fn resolve_ffmpeg_executable() -> Result<(std::path::PathBuf, String), String> {
    use std::{collections::HashSet, path::PathBuf};

    let executable_name = if cfg!(windows) { "ffmpeg.exe" } else { "ffmpeg" };
    let mut candidates: Vec<PathBuf> = Vec::new();

    // Primeiro, respeita o PATH recebido pelo processo do FrameLab.
    if let Some(path_value) = std::env::var_os("PATH") {
        candidates.extend(std::env::split_paths(&path_value).map(|directory| directory.join(executable_name)));
    }

    // O WinGet disponibiliza aliases nesta pasta. Ela pode não estar no PATH
    // herdado quando o aplicativo é iniciado pelo menu Iniciar/atalho.
    if cfg!(windows) {
        if let Some(local_app_data) = std::env::var_os("LOCALAPPDATA") {
            candidates.push(PathBuf::from(local_app_data)
                .join("Microsoft").join("WinGet").join("Links").join(executable_name));
        }
        if let Some(user_profile) = std::env::var_os("USERPROFILE") {
            candidates.push(PathBuf::from(user_profile)
                .join("AppData").join("Local").join("Microsoft")
                .join("WinGet").join("Links").join(executable_name));
        }
    }

    let mut checked = HashSet::new();
    let mut failures: Vec<String> = Vec::new();

    for candidate in candidates {
        if !checked.insert(candidate.clone()) || !candidate.is_file() {
            continue;
        }

        match crate::process::hidden_command(&candidate).arg("-version").output() {
            Ok(output) if output.status.success() => {
                let version = String::from_utf8_lossy(&output.stdout)
                    .lines().next().unwrap_or("FFmpeg disponível").to_string();
                return Ok((candidate, version));
            }
            Ok(output) => {
                failures.push(format!("{} (código de saída: {})",
                    candidate.display(), output.status));
            }
            Err(error) => {
                failures.push(format!("{} ({error})", candidate.display()));
            }
        }
    }

    let details = if failures.is_empty() {
        "Nenhum ffmpeg.exe válido foi encontrado nos diretórios do PATH ou no alias conhecido do WinGet.".to_string()
    } else {
        format!("Executáveis encontrados, mas que não iniciaram corretamente: {}", failures.join("; "))
    };
    Err(format!(
        "Não foi possível localizar e iniciar o FFmpeg. Verifique a instalação ou o PATH do Windows. {details}"
    ))
}

fn media_has_audio_stream(ffmpeg_path: &std::path::Path, media_path: &std::path::Path) -> Result<bool, String> {
    let probe_name = if cfg!(windows) { "ffprobe.exe" } else { "ffprobe" };
    let sibling = ffmpeg_path.parent().map(|directory| directory.join(probe_name));
    let mut candidates = Vec::new();
    if let Some(path) = sibling { candidates.push(path); }
    if let Some(path_value) = std::env::var_os("PATH") {
        candidates.extend(std::env::split_paths(&path_value).map(|directory| directory.join(probe_name)));
    }
    let probe = candidates.into_iter().find(|candidate| candidate.is_file())
        .ok_or_else(|| "Não foi possível localizar o ffprobe ao lado do FFmpeg. Instale a distribuição completa do FFmpeg para incluir o áudio original dos vídeos.".to_string())?;
    let output = crate::process::hidden_command(probe)
        .args(["-v", "error", "-select_streams", "a:0", "-show_entries", "stream=index", "-of", "csv=p=0"])
        .arg(media_path)
        .output()
        .map_err(|error| format!("Não foi possível analisar o áudio do vídeo: {error}"))?;
    if !output.status.success() {
        return Err(format!("O ffprobe não conseguiu analisar {}: {}", media_path.display(), String::from_utf8_lossy(&output.stderr).trim()));
    }
    Ok(!String::from_utf8_lossy(&output.stdout).trim().is_empty())
}

fn ensure_ffmpeg_capabilities(
    ffmpeg_path: &std::path::Path,
    required_filters: &[&str],
) -> Result<(), String> {
    let output = crate::process::hidden_command(ffmpeg_path)
        .args(["-hide_banner", "-filters"])
        .output()
        .map_err(|error| format!("Não foi possível consultar os filtros do FFmpeg: {error}"))?;
    if !output.status.success() {
        let details = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Não foi possível listar os filtros do FFmpeg: {}", details.trim()));
    }

    let listing = format!(
        "{}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    let missing: Vec<&str> = required_filters.iter().copied().filter(|required| {
        !listing.lines().any(|line| {
            let fields: Vec<&str> = line.split_whitespace().collect();
            fields.get(1).copied() == Some(*required)
        })
    }).collect();

    if !missing.is_empty() {
        let missing_list = missing.join(", ");
        let hint = if missing.contains(&"drawtext") {
            " O filtro drawtext exige uma compilação do FFmpeg com suporte a FreeType."
        } else {
            ""
        };
        return Err(format!(
            "A instalação do FFmpeg encontrada não oferece os filtros necessários: {missing_list}.{hint}"
        ));
    }

    let encoders = crate::process::hidden_command(ffmpeg_path)
        .args(["-hide_banner", "-encoders"])
        .output()
        .map_err(|error| format!("Não foi possível consultar os encoders do FFmpeg: {error}"))?;
    let encoder_listing = format!(
        "{}\n{}",
        String::from_utf8_lossy(&encoders.stdout),
        String::from_utf8_lossy(&encoders.stderr)
    );
    let has_h264 = encoder_listing.lines().any(|line| {
        let fields: Vec<&str> = line.split_whitespace().collect();
        fields.get(1).copied() == Some("libx264")
    });
    if !has_h264 {
        return Err(
            "A instalação do FFmpeg não inclui o encoder libx264, necessário para exportar MP4.".into()
        );
    }

    Ok(())
}

#[tauri::command]
pub async fn check_ffmpeg() -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let (_, version) = resolve_ffmpeg_executable()?;
        Ok(version)
    }).await.map_err(|error| format!("A verificação do FFmpeg foi interrompida: {error}"))?
}

fn estimate_text_width(value: &str, font_size: u32) -> f64 {
    value.chars().map(|character| {
        let factor = match character {
            'i' | 'l' | 'I' | '!' | '.' | ',' | ':' | ';' | '\'' | '|' => 0.28,
            'f' | 't' | 'r' | '(' | ')' | '[' | ']' => 0.36,
            'm' | 'w' | 'M' | 'W' | '@' | '%' => 0.88,
            ' ' => 0.30,
            c if c.is_ascii_uppercase() => 0.66,
            c if c.is_ascii_digit() => 0.56,
            _ => 0.54,
        };
        factor * font_size.max(1) as f64
    }).sum()
}

fn wrap_text_for_export(value: &str, font_size: u32) -> String {
    wrap_text_for_export_width(value, font_size, 972.0)
}

fn wrap_text_for_export_width(value: &str, font_size: u32, max_width: f64) -> String {
    // Estimate glyph widths rather than relying on a character count, which clips
    // wide words and wastes space on narrow glyphs.
    let normalized = value.replace("\r\n", "\n").replace('\r', "\n");
    normalized.split('\n').map(|line| {
        let mut lines = Vec::new();
        let mut current = String::new();
        for word in line.split_whitespace() {
            let candidate = if current.is_empty() { word.to_string() } else { format!("{current} {word}") };
            if current.is_empty() || estimate_text_width(&candidate, font_size) <= max_width {
                current = candidate;
            } else {
                lines.push(std::mem::take(&mut current));
                if estimate_text_width(word, font_size) <= max_width {
                    current.push_str(word);
                } else {
                    let mut chunk = String::new();
                    for character in word.chars() {
                        let candidate = format!("{chunk}{character}");
                        if !chunk.is_empty() && estimate_text_width(&candidate, font_size) > max_width {
                            lines.push(std::mem::take(&mut chunk));
                        }
                        chunk.push(character);
                    }
                    current = chunk;
                }
            }
        }
        if !current.is_empty() { lines.push(current); }
        if lines.is_empty() { String::new() } else { lines.join("\n") }
    }).collect::<Vec<_>>().join("\n")
}


fn ass_color(color: &str, alpha: u8) -> String {
    let raw = color.trim().trim_start_matches('#');
    let rgb = u32::from_str_radix(raw, 16).unwrap_or(0xFFFFFF);
    let red = (rgb >> 16) & 0xFF;
    let green = (rgb >> 8) & 0xFF;
    let blue = rgb & 0xFF;
    format!("&H{alpha:02X}{blue:02X}{green:02X}{red:02X}&")
}

fn ass_timestamp(milliseconds: u64) -> String {
    let centiseconds = milliseconds / 10;
    let total_seconds = centiseconds / 100;
    let hours = total_seconds / 3600;
    let minutes = (total_seconds % 3600) / 60;
    let seconds = total_seconds % 60;
    format!("{hours}:{minutes:02}:{seconds:02}.{:02}", centiseconds % 100)
}

fn ass_escape_text(value: &str) -> String {
    value.replace('\\', "\\\\")
        .replace('{', "\\{")
        .replace('}', "\\}")
        .replace("\r\n", "\\N")
        .replace('\r', "\\N")
        .replace('\n', "\\N")
}

fn ass_caption_script(item: &ExportMotion) -> String {
    let width = (item.caption_width.clamp(60.0, 100.0) * 10.8).round();
    let margin = ((1080.0 - width) / 2.0).round() as u32;
    let font_size = item.font_size.clamp(18, 180);
    let text_margin = margin + (font_size as f64 * 0.55).round() as u32;
    let font_name = if item.font_family.trim().is_empty() { "Arial" } else { item.font_family.trim() };
    let bold = if item.font_weight >= 700 { -1 } else { 0 };
    let primary = ass_color(&item.color, 0);
    let secondary = ass_color(if item.caption_accent.is_empty() { "#65d6c0" } else { &item.caption_accent }, 0);
    let alignment = match item.text_align.as_str() { "left" => 4, "right" => 6, _ => 5 };
    let anchor_x = match item.text_align.as_str() { "left" => margin as f64, "right" => 1080.0 - margin as f64, _ => 540.0 };
    let anchor_y = (item.y.clamp(0.0, 100.0) / 100.0 * 1920.0).round();
    let style = format!(
        "Style: Caption,{font_name},{font_size},{primary},{secondary},&H00000000&,&H00000000&,{bold},0,0,0,100,100,0,0,1,0,0,{alignment},{text_margin},{text_margin},0,1"
    );
    let words = &item.caption_words;
    let source = if words.is_empty() {
        item.text.split('\n').next().unwrap_or(&item.text).to_string()
    } else {
        words.iter().map(|word| word.text.as_str()).collect::<Vec<_>>().join(" ")
    };
    let translation = item.text.split('\n').skip(1).collect::<Vec<_>>().join("\n");
    let mut intervals: Vec<(u64, u64, Option<usize>)> = Vec::new();
    let mut cursor = item.start_ms;
    if words.is_empty() {
        intervals.push((item.start_ms, item.end_ms, None));
    } else {
        let mut sorted: Vec<(usize, &ExportCaptionWord)> = words.iter().enumerate().collect();
        sorted.sort_by_key(|(_, word)| word.start_ms);
        for (word_index, word) in sorted {
            let start = word.start_ms.max(item.start_ms).max(cursor);
            let end = word.end_ms.min(item.end_ms);
            if start > cursor {
                intervals.push((cursor, start, None));
            }
            if end > start {
                intervals.push((start, end, Some(word_index)));
                cursor = end;
            }
        }
        if cursor < item.end_ms {
            intervals.push((cursor, item.end_ms, None));
        }
        if intervals.is_empty() && item.end_ms > item.start_ms {
            intervals.push((item.start_ms, item.end_ms, None));
        }
    }
    let mut script = String::from(
        "[Script Info]\nScriptType: v4.00+\nPlayResX: 1080\nPlayResY: 1920\nWrapStyle: 0\nScaledBorderAndShadow: yes\n\n[V4+ Styles]\nFormat: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding\n"
    );
    script.push_str(&style);
    script.push_str("\n\n[Events]\nFormat: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text\n");
    for (start_ms, end_ms, active_word) in intervals {
        if end_ms <= start_ms { continue; }
        let mut source_markup = String::new();
        if words.is_empty() {
            source_markup.push_str(&ass_escape_text(&source));
        } else {
            for (index, word) in words.iter().enumerate() {
                if index > 0 { source_markup.push(' '); }
                if Some(index) == active_word {
                    source_markup.push_str(&format!("{{\\1c{secondary}}}{}{{\\rCaption}}", ass_escape_text(&word.text)));
                } else {
                    source_markup.push_str(&ass_escape_text(&word.text));
                }
            }
        }
        let translation_markup = if translation.trim().is_empty() {
            String::new()
        } else {
            format!("\\N{{\\fs{}\\1c&H00D8D4DF&}}{}{{\\rCaption}}", (font_size as f64 * 0.72).round().max(12.0) as u32, ass_escape_text(&translation))
        };
        let text = format!("{{\\an{alignment}\\pos({anchor_x:.0},{anchor_y:.0})}}{source_markup}{translation_markup}");
        script.push_str(&format!(
            "Dialogue: 0,{},{},Caption,,0,0,0,,{}\n",
            ass_timestamp(start_ms), ass_timestamp(end_ms), text
        ));
    }
    script
}

fn ffmpeg_escape_filter_path(path: &std::path::Path) -> String {
    path.to_string_lossy().replace('\\', "/").replace(':', "\\:").replace('\'', "\\'")
}

fn caption_background_geometry(item: &ExportMotion) -> Option<(f64, f64, f64, f64, String)> {
    let opacity = item.caption_background_opacity.clamp(0.0, 1.0);
    if opacity <= 0.0 { return None; }
    let width = item.caption_width.clamp(60.0, 100.0) * 10.8;
    let x = (1080.0 - width) / 2.0;
    let font_size = item.font_size.clamp(18, 180);
    let max_text_width = (width - font_size as f64 * 1.1).max(font_size as f64);
    let source = if item.caption_words.is_empty() {
        item.text.split('\n').next().unwrap_or(&item.text)
    } else {
        // Reconstruct the spoken line from the word timings, matching the karaoke text.
        // The subtitle renderer uses the same word sequence.
        ""
    };
    let source_owned = if item.caption_words.is_empty() { source.to_string() } else {
        item.caption_words.iter().map(|word| word.text.as_str()).collect::<Vec<_>>().join(" ")
    };
    let source_lines = wrap_text_for_export_width(&source_owned, font_size, max_text_width).lines().count().max(1) as f64;
    let translation = item.text.split('\n').skip(1).collect::<Vec<_>>().join(" ");
    let translation_lines = if translation.trim().is_empty() { 0.0 } else {
        wrap_text_for_export_width(&translation, (font_size as f64 * 0.72).round() as u32, max_text_width).lines().count().max(1) as f64
    };
    let padding = item.caption_padding_em.clamp(0.0, 1.0) * font_size as f64;
    let height = (source_lines * font_size as f64 * 1.18 + translation_lines * font_size as f64 * 0.72 * 1.18 + padding * 2.0).max(font_size as f64);
    let anchor_y = item.y.clamp(0.0, 100.0) / 100.0 * 1920.0;
    let y = (anchor_y - height / 2.0).clamp(0.0, (1920.0 - height).max(0.0));
    let raw_color = item.caption_background_color.trim().trim_start_matches('#');
    let color = if raw_color.len() == 6 && u32::from_str_radix(raw_color, 16).is_ok() {
        format!("0x{raw_color}@{opacity:.3}")
    } else {
        format!("black@{opacity:.3}")
    };
    Some((x, y, width, height.min(1920.0), color))
}

fn ffmpeg_escape_expression(value: &str) -> String {
    // Filtergraph commas must be escaped even inside expression-valued options;
    // otherwise FFmpeg treats function arguments as new filters.
    value.replace(',', "\\,")
}

fn ffmpeg_escape_text(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace('\'', "'\\''")
        .replace(':', "\\:")
        .replace('%', "\\%")
        .replace(',', "\\,")
        .replace('[', "\\[")
        .replace(']', "\\]")
        // Keep real line-feed characters. drawtext renders them as separate
        // lines; converting them to the two-character sequence \\n loses layout.
        .replace('\r', "")
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ExportProgress {
    percent: f64,
}

#[tauri::command]
pub async fn export_timeline(
    app: AppHandle,
    request: ExportRequest,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let assets = state.media.list(&request.project_id)?;
    let storage = state.media_storage.clone();
    let sound_directory = state.sound_library_directory.clone();

    tauri::async_runtime::spawn_blocking(move || {
        use std::{io::{BufRead, BufReader, Read}, path::PathBuf, process::Stdio, thread};

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
        let mut sound_inputs: Vec<(usize, &ExportSoundEffect)> = Vec::new();
        let mut overlay_inputs: Vec<(usize, &ExportImageOverlay)> = Vec::new();
        let mut icon_temp_files: Vec<PathBuf> = Vec::new();
        let mut caption_temp_files: Vec<PathBuf> = Vec::new();
        let mut icon_inputs: Vec<(usize, usize, &ExportMotion)> = Vec::new();
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
        let (ffmpeg_path, _) = resolve_ffmpeg_executable()?;
        let mut video_audio_inputs: Vec<(usize, &ExportClip)> = Vec::new();
        for (input_index, clip) in &visual_inputs {
            if clip.kind != "video" || clip.muted.unwrap_or(false) {
                continue;
            }
            let asset = assets.iter().find(|asset| asset.id == clip.asset_id)
                .ok_or_else(|| format!("A mídia do clipe {} não está mais na biblioteca.", clip.id))?;
            let relative = PathBuf::from(&asset.relative_path);
            let media_dir = storage.project_media_directory(&request.project_id)?;
            let project_dir = media_dir.parent().ok_or("Diretório do projeto inválido.")?
                .canonicalize().map_err(|error| error.to_string())?;
            let media_path = project_dir.join(relative).canonicalize()
                .map_err(|error| format!("Arquivo de vídeo não encontrado: {error}"))?;
            if media_has_audio_stream(&ffmpeg_path, &media_path)? {
                video_audio_inputs.push((*input_index, *clip));
            }
        }
        let registered_sounds = read_sound_manifest(&sound_directory)?;
        for sound in &request.sound_effects {
            let registered = registered_sounds.iter().find(|item| item.id == sound.sound_id)
                .ok_or_else(|| format!("O efeito sonoro {} não está mais na biblioteca global.", sound.sound_id))?;
            let path = sound_directory.join(&registered.file_name).canonicalize()
                .map_err(|error| format!("Arquivo de efeito sonoro não encontrado: {error}"))?;
            let canonical_directory = sound_directory.canonicalize().map_err(|error| error.to_string())?;
            if !path.starts_with(&canonical_directory) || !path.is_file() {
                return Err("Caminho de efeito sonoro inválido.".into());
            }
            let input_index = visual_inputs.len() + audio_inputs.len() + sound_inputs.len();
            args.extend(["-i".into(), path.to_string_lossy().into_owned()]);
            sound_inputs.push((input_index, sound));
        }

        for overlay in &request.image_overlays {
            if overlay.end_ms <= overlay.start_ms { continue; }
            let asset=assets.iter().find(|asset|asset.id==overlay.asset_id).ok_or_else(||format!("Imagem sobreposta {} não encontrada na biblioteca.",overlay.asset_id))?;
            if asset.kind!="image" { return Err("A camada sobreposta precisa ser uma imagem.".into()); }
            let relative=PathBuf::from(&asset.relative_path);
            if relative.components().any(|part|!matches!(part,std::path::Component::Normal(_))){return Err("Caminho de imagem sobreposta inválido.".into());}
            let media_dir=storage.project_media_directory(&request.project_id)?;
            let project_dir=media_dir.parent().ok_or("Diretório do projeto inválido.")?.canonicalize().map_err(|error|error.to_string())?;
            let file_path=project_dir.join(relative).canonicalize().map_err(|error|format!("Imagem sobreposta não encontrada: {error}"))?;
            if !file_path.starts_with(&project_dir)||!file_path.is_file(){return Err("A imagem sobreposta não pertence a este projeto.".into());}
            let duration=(overlay.end_ms-overlay.start_ms) as f64/1000.0;
            args.extend(["-loop".into(),"1".into(),"-framerate".into(),"30".into(),"-t".into(),format!("{duration:.3}"),"-i".into(),file_path.to_string_lossy().into_owned()]);
            let input_index=visual_inputs.len()+audio_inputs.len()+sound_inputs.len()+overlay_inputs.len();
            overlay_inputs.push((input_index,overlay));
            total_ms=total_ms.max(overlay.end_ms);
        }

        for (motion_index, item) in request.motion.iter().enumerate() {
            let Some(data_url) = item.lucide_icon_png.as_deref() else { continue; };
            let encoded = data_url.strip_prefix("data:image/png;base64,")
                .ok_or("Imagem Lucide inválida: esperado PNG em base64.")?;
            use base64::Engine as _;
            let bytes = base64::engine::general_purpose::STANDARD.decode(encoded)
                .map_err(|_| "Não foi possível decodificar a imagem do ícone Lucide.")?;
            if bytes.len() > 2 * 1024 * 1024 || !bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
                return Err("Imagem Lucide inválida ou maior que 2 MB.".into());
            }
            let icon_path = std::env::temp_dir().join(format!("framelab-icon-{}.png", uuid::Uuid::new_v4()));
            std::fs::write(&icon_path, &bytes).map_err(|error| format!("Não foi possível preparar o ícone: {error}"))?;
            let input_index = visual_inputs.len() + audio_inputs.len() + sound_inputs.len() + overlay_inputs.len() + icon_inputs.len();
            let duration = item.end_ms.saturating_sub(item.start_ms).max(1) as f64 / 1000.0;
            args.extend(["-loop".into(), "1".into(), "-framerate".into(), "30".into(), "-t".into(), format!("{duration:.3}"), "-i".into(), icon_path.to_string_lossy().into_owned()]);
            icon_temp_files.push(icon_path);
            icon_inputs.push((input_index, motion_index, item));
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
            let transition_ms = clip.transition_ms.min(2000);
            let transition_filter = if transition_ms == 0 { String::new() } else {
                let color = match clip.transition_type.as_str() { "fade-white" | "flash" => "white", _ => "black" };
                let duration = transition_ms as f64 / 1000.0;
                format!("fade=t=in:st=0:d={duration:.3}:color={color},")
            };
            filter_parts.push(format!("[{input_index}:v]{transition_filter}scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=30,setsar=1,setpts=PTS-STARTPTS+{start:.3}/TB[{label}]"));
            let next = format!("base{}", position + 1);
            let end = (clip.timeline_start_ms + clip.source_end_ms - clip.source_start_ms) as f64 / 1000.0;
            let enable = ffmpeg_escape_expression(&format!("gte(t,{start:.6})*lt(t,{end:.6})"));
            filter_parts.push(format!("[{previous}][{label}]overlay=0:0:eof_action=pass:shortest=0:enable='{enable}'[{next}]"));
            previous = next;
        }

        for (position,(input_index,overlay)) in overlay_inputs.iter().enumerate() {
            let label=format!("image_overlay{position}");
            let start=overlay.start_ms as f64/1000.0;
            let end=overlay.end_ms as f64/1000.0;
            let width=overlay.width.clamp(1,1080);
            let height=overlay.height.clamp(1,1920);
            let source=format!("image_overlay_source{position}");
            let entrance_duration = (overlay.entrance_duration_ms.clamp(100, 3000) as f64 / 1000.0).min(end - start);
            let entrance_filter = match overlay.entrance_animation.as_str() {
                "fade" => format!(",fade=t=in:st=0:d={entrance_duration:.3}:alpha=1"),
                _ => String::new(),
            };
            filter_parts.push(format!("[{input_index}:v]scale={width}:{height}:force_original_aspect_ratio=decrease,pad={width}:{height}:(ow-iw)/2:(oh-ih)/2:color=0x00000000,format=rgba{entrance_filter},setpts=PTS-STARTPTS+{start:.6}/TB[{source}]"));
            let next=format!("image_overlay_mix{position}");
            let x=(overlay.x.clamp(0.0,100.0)/100.0)*1080.0-width as f64/2.0;
            let y=(overlay.y.clamp(0.0,100.0)/100.0)*1920.0-height as f64/2.0;
            let slide_progress = format!("min(1\\,max(0\\,(t-{start:.6})/{entrance_duration:.3}))");
            let animated_x = match overlay.entrance_animation.as_str() {
                "slide-left" => format!("{x:.2}-({slide_progress})*{width}"),
                "slide-right" => format!("{x:.2}+(1-({slide_progress}))*{width}"),
                _ => format!("{x:.2}"),
            };
            let animated_y = match overlay.entrance_animation.as_str() {
                "slide-up" => format!("{y:.2}+(1-({slide_progress}))*{height}"),
                "slide-down" => format!("{y:.2}-({slide_progress})*{height}"),
                _ => format!("{y:.2}"),
            };
            let enable = ffmpeg_escape_expression(&format!("gte(t,{start:.6})*lt(t,{end:.6})"));
            filter_parts.push(format!("[{previous}][{source}]overlay=x='{animated_x}':y='{animated_y}':format=auto:eof_action=pass:shortest=0:enable='{enable}'[{next}]"));
            previous=next;
        }

        for (index, item) in request.motion.iter().enumerate() {
            if item.is_caption {
                let start = item.start_ms as f64 / 1000.0;
                let end = item.end_ms as f64 / 1000.0;
                if end <= start { continue; }
                if let Some((x, y, width, height, color)) = caption_background_geometry(item) {
                    let background_label = format!("caption_background{index}");
                    filter_parts.push(format!(
                        "[{previous}]drawbox=x={x:.2}:y={y:.2}:w={width:.2}:h={height:.2}:color={color}:t=fill:enable='between(t\\,{start:.6}\\,{end:.6})'[{background_label}]"
                    ));
                    previous = background_label;
                }
                let subtitle_path = std::env::temp_dir().join(format!("framelab-caption-{}.ass", uuid::Uuid::new_v4()));
                std::fs::write(&subtitle_path, ass_caption_script(item).as_bytes())
                    .map_err(|error| format!("Não foi possível preparar a legenda karaoke: {error}"))?;
                caption_temp_files.push(subtitle_path.clone());
                let subtitle_label = format!("caption_ass{index}");
                filter_parts.push(format!(
                    "[{previous}]ass=filename='{}'[{subtitle_label}]",
                    ffmpeg_escape_filter_path(&subtitle_path)
                ));
                previous = subtitle_label;
                continue;
            }
            let color = if item.color.starts_with('#') && item.color.len() == 7 { format!("0x{}", &item.color[1..]) } else { "white".into() };
            let (font_name, bold_suffix) = match item.font_family.as_str() {
                "Georgia" => ("georgia", "bd"), "Impact" => ("impact", ""),
                "Trebuchet MS" => ("trebuc", "bd"), "Verdana" => ("verdana", "bd"),
                "Courier New" => ("cour", "bd"), _ => ("arial", "bd"),
            };
            let font_suffix = if item.font_weight >= 700 { bold_suffix } else { "" };
            let font_file = format!("C\\:/Windows/Fonts/{font_name}{font_suffix}.ttf");
            // Use the same normalized 0-100% anchor as the editor preview.
            // The preview frame clips overflow, so do not silently shift text inward.
            let anchor_x = (item.x.clamp(0.0, 100.0) / 100.0) * 1080.0;
            let anchor_y = (item.y.clamp(0.0, 100.0) / 100.0) * 1920.0;
            let base_x = match item.text_align.as_str() {
                "left" => format!("{anchor_x}"),
                "right" => format!("{anchor_x}-text_w"),
                _ => format!("{anchor_x}-text_w/2"),
            };
            let start = item.start_ms as f64 / 1000.0;
            let end = item.end_ms as f64 / 1000.0;
            let duration_ms = if item.duration_ms > 0 { item.duration_ms.min(item.end_ms.saturating_sub(item.start_ms)) } else { item.end_ms.saturating_sub(item.start_ms) };
            let duration = (duration_ms.max(1) as f64) / 1000.0;
            let writing_duration = (if item.typewriter_duration_ms > 0 { item.typewriter_duration_ms.min(duration_ms) } else { 1500.min(duration_ms.max(100)) }.max(100) as f64) / 1000.0;
            // Use only long-supported drawtext options. `boxw` and `text_align`
            // are unavailable in some bundled FFmpeg builds (notably older Windows
            // builds), so center the text with the x expression and let drawtext
            // size its background box to the wrapped text.
            let caption_box = if item.is_caption {
                format!(":box=1:boxcolor=black@0.76:boxborderw={}", (item.font_size.clamp(18, 180) / 3).max(6))
            } else {
                String::new()
            };
            // Keep caption text centered inside the 90% safe width (x=54..1026).
            let caption_x = if item.is_caption { "54+(972-text_w)/2".to_string() } else { base_x.clone() };

            // Karaoke captions are exported as a stable full-text base plus timed
            // accent overlays for each transcribed word. The word timestamps are
            // timeline-relative and therefore stay aligned with the editor preview.
            if item.is_caption && !item.caption_words.is_empty() {
                let wrapped = wrap_text_for_export(&item.text, item.font_size);
                let base_label = format!("caption_base{index}");
                filter_parts.push(format!(
                    "[{previous}]drawtext=fontfile='{font_file}':text='{}':fontcolor={color}{caption_box}:fontsize={}:x='{caption_x}':y='{anchor_y}-text_h/2':enable='between(t\\,{start:.6}\\,{end:.6})'[{base_label}]",
                    ffmpeg_escape_text(&wrapped),
                    item.font_size.clamp(18, 180)
                ));
                let mut lines: Vec<Vec<&ExportCaptionWord>> = Vec::new();
                let mut current_line: Vec<&ExportCaptionWord> = Vec::new();
                let mut current_width = 0.0_f64;
                for word in &item.caption_words {
                    let word_width = estimate_text_width(&word.text, item.font_size);
                    let next_width = if current_line.is_empty() { word_width } else { current_width + estimate_text_width(" ", item.font_size) + word_width };
                    if !current_line.is_empty() && next_width > 972.0 {
                        lines.push(std::mem::take(&mut current_line));
                        current_width = 0.0;
                    }
                    if !current_line.is_empty() {
                        current_width += estimate_text_width(" ", item.font_size);
                    }
                    current_width += word_width;
                    current_line.push(word);
                }
                if !current_line.is_empty() { lines.push(current_line); }
                let mut current_label = base_label;
                for (line_index, line) in lines.iter().enumerate() {
                    let line_width: f64 = line.iter().map(|word| estimate_text_width(&word.text, item.font_size)).sum::<f64>()
                        + estimate_text_width(" ", item.font_size) * line.len().saturating_sub(1) as f64;
                    let line_left = match item.text_align.as_str() {
                        "left" => 54.0,
                        "right" => 1026.0 - line_width,
                        _ => 540.0 - line_width / 2.0,
                    };
                    let mut word_x = line_left;
                    for (word_index, word) in line.iter().enumerate() {
                        let next_label = format!("karaoke{index}_{line_index}_{word_index}");
                        let word_start = (word.start_ms.max(item.start_ms) as f64 / 1000.0).max(start);
                        let word_end = (word.end_ms.min(item.end_ms) as f64 / 1000.0).min(end);
                        if word_end > word_start {
                            let word_text = ffmpeg_escape_text(&word.text);
                            let word_y = format!("{anchor_y}-text_h/2+{}", line_index as f64 * item.font_size.clamp(18, 180) as f64 * 1.2);
                            filter_parts.push(format!(
                                "[{current_label}]drawtext=fontfile='{font_file}':text='{word_text}':fontcolor={}:fontsize={}:x='{word_x:.3}':y='{word_y}':enable='between(t\\,{word_start:.6}\\,{word_end:.6})'[{next_label}]",
                                if item.caption_accent.is_empty() { "#65d6c0" } else { item.caption_accent.as_str() },
                                item.font_size.clamp(18, 180)
                            ));
                            current_label = next_label;
                        }
                        word_x += estimate_text_width(&word.text, item.font_size) + estimate_text_width(" ", item.font_size);
                    }
                }
                previous = current_label;
                continue;
            }

            if item.preset == "typewriter" {
                // Render successive text prefixes in non-overlapping time slices. This
                // produces a true character-by-character reveal in the exported frames.
                let wrapped_text = wrap_text_for_export(&item.text, item.font_size);
                let characters: Vec<char> = wrapped_text.chars().collect();
                if characters.is_empty() { continue; }
                // A video is rendered at 30 fps. Creating one time slice per
                // character can make late slices shorter than a frame, so FFmpeg
                // may never evaluate the final prefixes. Reveal at most one prefix
                // per output frame, grouping characters when the text is longer.
                let frame_count = ((writing_duration * 30.0).floor() as usize).max(1);
                let steps = characters.len().min(frame_count).max(1);
                let mut current = previous.clone();
                for step in 0..steps {
                    let visible_count = ((step + 1) * characters.len() + steps - 1) / steps;
                    let prefix: String = characters[..visible_count].iter().collect();
                    let text = ffmpeg_escape_text(&prefix);
                    let step_start = start + writing_duration * (step as f64 / steps as f64);
                    let step_end = start + writing_duration * ((step + 1) as f64 / steps as f64);
                    let next = format!("typewriter{index}_{step}");
                    // The preview removes the element exactly at endMs. Keep
                    // the final prefix bounded by that same lifetime instead of
                    // leaving it on screen for the rest of the exported video.
                    let enable = if step + 1 == steps {
                        format!("gte(t,{step_start:.6})*lt(t,{end:.6})")
                    } else {
                        format!("gte(t,{step_start:.6})*lt(t,{step_end:.6})")
                    };
                    let enable = ffmpeg_escape_expression(&enable);
                    filter_parts.push(format!("[{current}]drawtext=fontfile='{font_file}':text='{text}':fontcolor={color}{caption_box}:fontsize={}:x='{caption_x}':y='{anchor_y}-text_h/2':enable='{enable}'[{next}]", item.font_size.clamp(18, 180)));
                    current = next;
                }
                previous = current;
                continue;
            }

            // Keep these curves in sync with motionPreviewState() in EditorWorkspace.tsx.
            let progress = format!("clip((t-{start:.6})/{duration:.6},0,1)");
            let eased = format!("(1-pow(1-{progress},3))");
            let (scale, x, alpha) = match item.preset.as_str() {
                "pop" => (format!("0.35+0.65*{eased}"), base_x.clone(), "1".to_string()),
                "slide" => ("1".to_string(), format!("({base_x})+text_w*(1-{eased})"), "1".to_string()),
                "zoom" => (format!("2.4-1.4*{eased}"), base_x.clone(), format!("min(1,{progress}*4)")),
                "impact" => (format!("if(lt({progress},0.65),3-2.12*({progress}/0.65),0.88+0.12*(({progress}-0.65)/0.35))"), base_x.clone(), format!("min(1,{progress}*4)")),
                _ => ("1".to_string(), base_x.clone(), "1".to_string()),
            };
            let next = format!("text{index}");
            let scale_expr = ffmpeg_escape_expression(&scale);
            let alpha_expr = ffmpeg_escape_expression(&alpha);
            let x = if item.is_caption { caption_x.clone() } else { x };
            let x_expr = ffmpeg_escape_expression(&x);
            filter_parts.push(format!("[{previous}]drawtext=fontfile='{font_file}':text='{}':fontcolor={color}{caption_box}:fontsize='max(1\\,{}*({scale_expr}))':alpha='{alpha_expr}':x='{x_expr}':y='{anchor_y}-text_h/2':enable='between(t\\,{start:.3}\\,{end:.3})'[{next}]", ffmpeg_escape_text(&wrap_text_for_export(&item.text, item.font_size)), item.font_size.clamp(18, 180)));
            previous = next;
        }
        for (icon_position, (input_index, motion_index, item)) in icon_inputs.iter().enumerate() {
            let anchor_x = (item.x.clamp(0.0, 100.0) / 100.0) * 1080.0;
            let anchor_y = (item.y.clamp(0.0, 100.0) / 100.0) * 1920.0;
            let icon_size = item.lucide_icon_size.clamp(24, 512).max(24) as f64;
            let duration_ms = item.end_ms.saturating_sub(item.start_ms).max(1);
            let duration = duration_ms as f64 / 1000.0;
            let progress = format!("clip(t/{duration:.6},0,1)");
            let eased = format!("(1-pow(1-{progress},3))");
            let (scale, fade_alpha) = match item.preset.as_str() {
                "pop" => (format!("0.35+0.65*{eased}"), false),
                "zoom" => (format!("2.4-1.4*{eased}"), true),
                "impact" => (format!("if(lt({progress},0.65),3-2.12*({progress}/0.65),0.88+0.12*(({progress}-0.65)/0.35))"), true),
                _ => ("1".to_string(), false),
            };
            let icon_stream = format!("icon_source{icon_position}_{motion_index}");
            let scale_expr = ffmpeg_escape_expression(&scale);
            let fade_filter = if fade_alpha {
                let start = item.start_ms as f64 / 1000.0;
                let fade_duration = (duration * 0.25).max(0.001);
                format!(",fade=t=in:st={start:.6}:d={fade_duration:.6}:alpha=1")
            } else {
                String::new()
            };
            filter_parts.push(format!("[{input_index}:v]scale=w='max(1\\,{icon_size}*({scale_expr}))':h='max(1\\,{icon_size}*({scale_expr}))':eval=frame,format=rgba{fade_filter}[{icon_stream}]"));
            let x = format!("{anchor_x}+({})+({icon_size}-overlay_w)/2", item.lucide_icon_offset_x);
            let y = format!("{anchor_y}+({})+({icon_size}-overlay_h)/2", item.lucide_icon_offset_y);
            let next = format!("icon{icon_position}_{motion_index}");
            let x_expr = ffmpeg_escape_expression(&x);
            let y_expr = ffmpeg_escape_expression(&y);
            let enable = ffmpeg_escape_expression(&format!("gte(t,{:.6})*lt(t,{:.6})", item.start_ms as f64 / 1000.0, item.end_ms as f64 / 1000.0));
            filter_parts.push(format!("[{previous}][{icon_stream}]overlay=x='{x_expr}':y='{y_expr}':format=auto:eof_action=pass:shortest=0:enable='{enable}'[{next}]"));
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
        for (index, (input_index, clip)) in video_audio_inputs.iter().enumerate() {
            let label = format!("videoaudio{index}");
            let delay = clip.timeline_start_ms;
            let volume = clip.volume.clamp(0.0, 100.0) / 100.0;
            filter_parts.push(format!("[{input_index}:a]asetpts=PTS-STARTPTS,volume={volume:.3},adelay={delay}|{delay}[{label}]"));
            audio_labels.push(format!("[{label}]"));
        }
        for (index, (input_index, sound)) in sound_inputs.iter().enumerate() {
            let label = format!("sfx{index}");
            let delay = sound.timeline_start_ms;
            let volume = sound.volume.clamp(0.0, 100.0) / 100.0;
            filter_parts.push(format!("[{input_index}:a]asetpts=PTS-STARTPTS,volume={volume:.3},adelay={delay}|{delay}[{label}]"));
            audio_labels.push(format!("[{label}]"));
        }
        if !audio_labels.is_empty() {
            filter_parts.push(format!("{}amix=inputs={}:duration=longest:dropout_transition=0:normalize=0,alimiter=limit=0.95,atrim=duration={:.3}[aout]", audio_labels.join(""), audio_labels.len(), total_ms as f64 / 1000.0));
        }

        // Valide os recursos reais do binário antes de iniciar a exportação.
        // Builds do FFmpeg podem existir sem filtros opcionais, como drawtext.
        let (ffmpeg_path, ffmpeg_version) = resolve_ffmpeg_executable()?;
        let mut required_filters = vec![
            "color", "scale", "crop", "fps", "setsar", "setpts", "overlay", "format", "fade",
        ];
        if request.motion.iter().any(|item| !item.is_caption) {
            required_filters.push("drawtext");
        }
        if request.motion.iter().any(|item| item.is_caption) {
            required_filters.extend(["ass", "drawbox"]);
        }
        if !icon_inputs.is_empty() {
            required_filters.push("colorchannelmixer");
        }
        if !audio_labels.is_empty() {
            required_filters.extend(["asetpts", "volume", "adelay", "amix", "alimiter", "atrim"]);
        }
        if let Err(error) = ensure_ffmpeg_capabilities(&ffmpeg_path, &required_filters) {
            for path in &icon_temp_files { let _ = std::fs::remove_file(path); }
            for path in &caption_temp_files { let _ = std::fs::remove_file(path); }
            return Err(error);
        }

        // O grafo pode ficar muito grande (principalmente com typewriter,
        // que cria uma etapa drawtext por caractere). No Windows, passar todo
        // esse conteúdo como argumento pode ultrapassar o limite do CreateProcess.
        // Grave-o em arquivo e use a sintaxe compatível com a versão do FFmpeg.
        let filter_script_path = std::env::temp_dir()
            .join(format!("framelab-filter-{}.txt", uuid::Uuid::new_v4()));
        let filter_script = filter_parts.join(";\n");
        if let Err(error) = std::fs::write(&filter_script_path, filter_script.as_bytes()) {
            for path in &icon_temp_files { let _ = std::fs::remove_file(path); }
            for path in &caption_temp_files { let _ = std::fs::remove_file(path); }
            return Err(format!("Não foi possível preparar os filtros de exportação: {error}"));
        }

        // FFmpeg 8.0 removed the deprecated -filter_complex_script option.
        // Newer versions load option values from files with the /option syntax.
        let ffmpeg_major = ffmpeg_version
            .split("version ")
            .nth(1)
            .and_then(|value| value.split('.').next())
            .and_then(|value| value.trim_start_matches('n').parse::<u32>().ok())
            .unwrap_or(0);
        // Nightly builds may report a git hash instead of a semantic FFmpeg
        // version. libavcodec 63 is the ABI shipped with FFmpeg 8.
        let libavcodec_major = ffmpeg_version
            .split("libavcodec")
            .nth(1)
            .and_then(|value| value.trim().split('.').next())
            .and_then(|value| value.parse::<u32>().ok())
            .unwrap_or(0);
        let filter_file_option = if ffmpeg_major >= 8 || libavcodec_major >= 63 {
            "-/filter_complex"
        } else {
            "-filter_complex_script"
        };

        args.extend([
            filter_file_option.into(),
            filter_script_path.to_string_lossy().into_owned(),
            "-map".into(),
            "[vout]".into(),
        ]);
        if !audio_labels.is_empty() {
            args.extend(["-map".into(), "[aout]".into(), "-c:a".into(), "aac".into(), "-b:a".into(), "192k".into()]);
        } else {
            args.push("-an".into());
        }
        args.extend(["-t".into(), format!("{:.3}", total_ms as f64 / 1000.0), "-c:v".into(), "libx264".into(), "-preset".into(), "medium".into(), "-crf".into(), "20".into(), "-pix_fmt".into(), "yuv420p".into(), "-movflags".into(), "+faststart".into(), "-progress".into(), "pipe:1".into(), "-nostats".into(), destination.to_string_lossy().into_owned()]);

        let output_result = crate::process::hidden_command(&ffmpeg_path)
            .args(&args)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn();
        let mut child = match output_result {
            Ok(child) => child,
            Err(error) => {
                let _ = std::fs::remove_file(&filter_script_path);
                for path in &icon_temp_files { let _ = std::fs::remove_file(path); }
                for path in &caption_temp_files { let _ = std::fs::remove_file(path); }
                return Err(format!(
                    "Não foi possível iniciar o FFmpeg em {}: {error}",
                    ffmpeg_path.display()
                ));
            }
        };
        // stderr é drenado em paralelo para evitar bloqueio do processo caso o FFmpeg
        // produza muitas mensagens de diagnóstico durante a renderização.
        let stderr_pipe = child.stderr.take();
        let stderr_reader = thread::spawn(move || {
            let mut details = String::new();
            if let Some(mut pipe) = stderr_pipe {
                let _ = pipe.read_to_string(&mut details);
            }
            details
        });
        if let Some(stdout) = child.stdout.take() {
            let reader = BufReader::new(stdout);
            for line in reader.lines().flatten() {
                if let Some(value) = line.strip_prefix("out_time_us=") {
                    if let Ok(elapsed_us) = value.parse::<u64>() {
                        let total_us = total_ms.saturating_mul(1000).max(1);
                        let percent = ((elapsed_us as f64 / total_us as f64) * 100.0).clamp(0.0, 99.0);
                        let _ = app.emit("export-progress", ExportProgress { percent });
                    }
                }
            }
        }
        // O FFmpeg lê o grafo de filtros depois de iniciar. Só podemos remover
        // o arquivo temporário quando o processo terminar, nunca logo após spawn().
        let status_result = child.wait();
        let _ = std::fs::remove_file(&filter_script_path);
        for path in &icon_temp_files { let _ = std::fs::remove_file(path); }
        for path in &caption_temp_files { let _ = std::fs::remove_file(path); }
        let status = status_result
            .map_err(|error| format!("Não foi possível aguardar o FFmpeg: {error}"))?;
        let stderr = stderr_reader.join().unwrap_or_else(|_| "Não foi possível ler o diagnóstico do FFmpeg.".into());
        if !status.success() {
            let stderr = stderr.as_str();
            // Preserve o contexto do erro. A última linha isolada ("Filter not
            // found", por exemplo) esconde a causa útil ("No such filter: drawtext").
            let detail = stderr.lines().rev().take(12).collect::<Vec<_>>()
                .into_iter().rev().collect::<Vec<_>>().join("\n");
            let detail = if detail.trim().is_empty() {
                "O FFmpeg encerrou com erro, mas não forneceu detalhes.".to_string()
            } else {
                detail
            };
            return Err(format!("Falha ao exportar o vídeo:\n{detail}"));
        }
        let _ = app.emit("export-progress", ExportProgress { percent: 100.0 });
        Ok(destination.to_string_lossy().into_owned())
    }).await.map_err(|error| format!("A exportação foi interrompida: {error}"))?
}


#[derive(serde::Serialize, serde::Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GlobalSound {
    pub id: String,
    pub name: String,
    pub file_name: String,
}

fn sound_manifest_path(directory: &std::path::Path) -> std::path::PathBuf {
    directory.join("library.json")
}

fn read_sound_manifest(directory: &std::path::Path) -> Result<Vec<GlobalSound>, String> {
    let path = sound_manifest_path(directory);
    if !path.exists() { return Ok(Vec::new()); }
    let raw = std::fs::read_to_string(path).map_err(|error| error.to_string())?;
    serde_json::from_str(&raw).map_err(|error| format!("Biblioteca de sons inválida: {error}"))
}

fn write_sound_manifest(directory: &std::path::Path, sounds: &[GlobalSound]) -> Result<(), String> {
    let path = sound_manifest_path(directory);
    let temporary = directory.join("library.json.tmp");
    let json = serde_json::to_vec_pretty(sounds).map_err(|error| error.to_string())?;
    std::fs::write(&temporary, json).map_err(|error| error.to_string())?;
    if path.exists() { std::fs::remove_file(&path).map_err(|error| error.to_string())?; }
    std::fs::rename(temporary, path).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn list_global_sounds(state: State<'_, AppState>) -> Result<Vec<GlobalSound>, String> {
    let mut sounds = read_sound_manifest(&state.sound_library_directory)?;
    sounds.retain(|sound| state.sound_library_directory.join(&sound.file_name).is_file());
    Ok(sounds)
}

#[tauri::command]
pub fn import_global_sound(state: State<'_, AppState>, source_path: String, name: String) -> Result<GlobalSound, String> {
    use std::path::{Path, Component};
    let source = Path::new(&source_path);
    if !source.is_file() { return Err("O arquivo de áudio selecionado não existe.".into()); }
    if source.components().any(|part| matches!(part, Component::ParentDir)) { return Err("Caminho de áudio inválido.".into()); }
    let extension = source.extension().and_then(|value| value.to_str()).unwrap_or("").to_ascii_lowercase();
    if !["mp3", "wav", "ogg", "m4a", "aac", "flac"].contains(&extension.as_str()) {
        return Err("Formato não suportado. Use MP3, WAV, OGG, M4A, AAC ou FLAC.".into());
    }
    let clean_name = name.trim();
    if clean_name.is_empty() { return Err("Informe um nome para o efeito sonoro.".into()); }
    let mut sounds = read_sound_manifest(&state.sound_library_directory)?;
    let id = uuid::Uuid::new_v4().to_string();
    let file_name = format!("{id}.{extension}");
    let destination = state.sound_library_directory.join(&file_name);
    std::fs::copy(source, &destination).map_err(|error| format!("Não foi possível copiar o áudio: {error}"))?;
    let sound = GlobalSound { id, name: clean_name.to_string(), file_name };
    sounds.push(sound.clone());
    if let Err(error) = write_sound_manifest(&state.sound_library_directory, &sounds) {
        let _ = std::fs::remove_file(destination);
        return Err(error);
    }
    Ok(sound)
}

#[tauri::command]
pub fn get_global_sound_path(state: State<'_, AppState>, sound_id: String) -> Result<String, String> {
    let sounds = read_sound_manifest(&state.sound_library_directory)?;
    let sound = sounds.iter().find(|item| item.id == sound_id).ok_or("Efeito sonoro não encontrado.")?;
    let path = state.sound_library_directory.join(&sound.file_name).canonicalize().map_err(|error| error.to_string())?;
    if !path.starts_with(&state.sound_library_directory.canonicalize().map_err(|error| error.to_string())?) || !path.is_file() {
        return Err("Caminho do efeito sonoro inválido.".into());
    }
    Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn delete_global_sound(state: State<'_, AppState>, sound_id: String) -> Result<(), String> {
    let mut sounds = read_sound_manifest(&state.sound_library_directory)?;
    let index = sounds.iter().position(|item| item.id == sound_id).ok_or("Efeito sonoro não encontrado.")?;
    let sound = sounds.remove(index);
    let path = state.sound_library_directory.join(&sound.file_name);
    if path.exists() { std::fs::remove_file(path).map_err(|error| error.to_string())?; }
    write_sound_manifest(&state.sound_library_directory, &sounds)
}
