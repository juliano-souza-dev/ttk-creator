use reqwest::blocking::{multipart, Client};
use serde::{Deserialize, Serialize};
use std::{path::{Path, PathBuf}, time::Duration};
use tauri::{AppHandle, Emitter};
use crate::{application::services::MediaService, infrastructure::media_storage::MediaStorage};

const GROQ_URL: &str = "https://api.groq.com/openai/v1/audio/transcriptions";
const GROQ_MODEL: &str = "whisper-large-v3-turbo";
const CHUNK_SECONDS: u64 = 58;
const OVERLAP_SECONDS: u64 = 2;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptWord {
    pub text: String,
    pub start_ms: u64,
    pub end_ms: u64,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptCue {
    pub id: String,
    pub text: String,
    pub start_ms: u64,
    pub end_ms: u64,
    pub words: Vec<TranscriptWord>,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptResult {
    pub engine: String,
    pub model: String,
    pub language: Option<String>,
    pub duration_ms: u64,
    pub cues: Vec<TranscriptCue>,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TranscriptProgress {
    project_id: String,
    stage: String,
    percent: f32,
    completed_chunks: usize,
    total_chunks: usize,
    message: String,
}
#[derive(Deserialize)]
struct GroqResponse {
    text: Option<String>,
    language: Option<String>,
    segments: Option<Vec<GroqSegment>>,
}
#[derive(Deserialize)]
struct GroqSegment {
    start: f64,
    end: f64,
    text: String,
    words: Option<Vec<GroqWord>>,
}
#[derive(Deserialize)]
struct GroqWord {
    start: Option<f64>,
    end: Option<f64>,
    word: String,
}

fn emit(app: &AppHandle, project_id: &str, stage: &str, percent: f32, done: usize, total: usize, message: &str) {
    let _ = app.emit("transcription-progress", TranscriptProgress {
        project_id: project_id.to_string(), stage: stage.to_string(),
        percent: percent.clamp(0.0, 100.0), completed_chunks: done, total_chunks: total,
        message: message.to_string(),
    });
}
fn ffmpeg() -> Result<PathBuf, String> {
    let name = if cfg!(windows) { "ffmpeg.exe" } else { "ffmpeg" };
    let mut candidates = Vec::new();
    if let Some(path) = std::env::var_os("PATH") {
        candidates.extend(std::env::split_paths(&path).map(|dir| dir.join(name)));
    }
    // O alias do WinGet pode não estar no PATH herdado pelo aplicativo desktop.
    if cfg!(windows) {
        if let Some(local) = std::env::var_os("LOCALAPPDATA") {
            candidates.push(PathBuf::from(local).join("Microsoft").join("WinGet").join("Links").join(name));
        }
        if let Some(profile) = std::env::var_os("USERPROFILE") {
            candidates.push(PathBuf::from(profile).join("AppData").join("Local").join("Microsoft").join("WinGet").join("Links").join(name));
        }
    }
    for candidate in candidates {
        if candidate.is_file() && crate::process::hidden_command(&candidate).arg("-version").output().map(|o| o.status.success()).unwrap_or(false) {
            return Ok(candidate);
        }
    }
    Err("FFmpeg não foi encontrado. Configure o FFmpeg antes de transcrever.".into())
}
fn ffprobe(ffmpeg_path: &Path) -> Result<PathBuf, String> {
    let name = if cfg!(windows) { "ffprobe.exe" } else { "ffprobe" };
    let sibling = ffmpeg_path.parent().map(|p| p.join(name));
    if let Some(path) = sibling { if path.is_file() { return Ok(path); } }
    if let Some(value) = std::env::var_os("PATH") {
        for dir in std::env::split_paths(&value) {
            let path = dir.join(name);
            if path.is_file() { return Ok(path); }
        }
    }
    Err("ffprobe não foi encontrado. Instale a distribuição completa do FFmpeg.".into())
}
fn duration_ms(probe: &Path, input: &Path) -> Result<u64, String> {
    let output = crate::process::hidden_command(probe).args(["-v","error","-show_entries","format=duration","-of","default=noprint_wrappers=1:nokey=1"])
        .arg(input).output().map_err(|e| format!("Falha ao consultar duração do áudio: {e}"))?;
    if !output.status.success() { return Err(String::from_utf8_lossy(&output.stderr).to_string()); }
    let seconds = String::from_utf8_lossy(&output.stdout).trim().parse::<f64>().map_err(|_| "Não foi possível identificar a duração do áudio.")?;
    Ok((seconds.max(0.0) * 1000.0).round() as u64)
}
fn safe_asset_path(media: &MediaService, storage: &MediaStorage, project_id: &str, asset_id: &str) -> Result<PathBuf, String> {
    use std::path::Component;
    let asset = media.list(project_id)?.into_iter().find(|a| a.id == asset_id)
        .ok_or("Mídia não encontrada neste projeto.")?;
    if asset.kind != "video" && asset.kind != "audio" { return Err("Selecione um vídeo ou arquivo de áudio para transcrever.".into()); }
    let relative = PathBuf::from(&asset.relative_path);
    if relative.components().any(|part| !matches!(part, Component::Normal(_))) { return Err("Caminho de mídia inválido.".into()); }
    let media_dir = storage.project_media_directory(project_id)?;
    let root = media_dir.parent().ok_or("Diretório do projeto inválido.")?.canonicalize().map_err(|e| e.to_string())?;
    let path = root.join(relative).canonicalize().map_err(|e| format!("Arquivo de mídia não encontrado: {e}"))?;
    if !path.starts_with(&root) || !path.is_file() { return Err("O arquivo não pertence a este projeto.".into()); }
    Ok(path)
}
fn extract_audio(ffmpeg_path: &Path, source: &Path, destination: &Path) -> Result<(), String> {
    let output = crate::process::hidden_command(ffmpeg_path).args(["-y","-hide_banner","-loglevel","error","-i"])
        .arg(source).args(["-vn","-ac","1","-ar","16000","-c:a","flac"]).arg(destination)
        .output().map_err(|e| format!("Não foi possível iniciar o FFmpeg: {e}"))?;
    if !output.status.success() { return Err(format!("Falha ao preparar o áudio: {}", String::from_utf8_lossy(&output.stderr).chars().take(600).collect::<String>())); }
    Ok(())
}
fn chunk_audio(ffmpeg_path: &Path, audio: &Path, directory: &Path, duration_ms: u64) -> Result<Vec<(PathBuf,u64)>, String> {
    let mut chunks = Vec::new();
    let step_ms = CHUNK_SECONDS * 1000;
    let mut start = 0u64;
    let mut index = 0usize;
    while start < duration_ms {
        let actual_start = if index == 0 { 0 } else { start.saturating_sub(OVERLAP_SECONDS * 1000) };
        let end = (start + step_ms).min(duration_ms);
        let path = directory.join(format!("chunk-{index:05}.flac"));
        let seconds = (end.saturating_sub(actual_start)) as f64 / 1000.0;
        let output = crate::process::hidden_command(ffmpeg_path).args(["-y","-hide_banner","-loglevel","error","-ss"])
            .arg(format!("{:.3}", actual_start as f64 / 1000.0)).arg("-i").arg(audio)
            .arg("-t").arg(format!("{seconds:.3}")).args(["-ac","1","-ar","16000","-c:a","flac"])
            .arg(&path).output().map_err(|e| format!("Falha ao dividir o áudio: {e}"))?;
        if !output.status.success() { return Err(format!("Falha ao criar bloco de áudio: {}", String::from_utf8_lossy(&output.stderr))); }
        chunks.push((path, actual_start));
        if end == duration_ms { break; }
        start = end;
        index += 1;
    }
    Ok(chunks)
}
fn groq_chunk(client: &Client, key: &str, path: &Path, language: Option<&str>) -> Result<GroqResponse, String> {
    let bytes = std::fs::read(path).map_err(|e| format!("Não foi possível ler bloco de áudio: {e}"))?;
    if bytes.len() > 25 * 1024 * 1024 { return Err("Um bloco ultrapassou o limite de 25 MB da API. Reduza a duração dos blocos.".into()); }
    let part = multipart::Part::bytes(bytes).file_name("audio.flac").mime_str("audio/flac").map_err(|e| e.to_string())?;
    let mut form = multipart::Form::new().text("model", GROQ_MODEL).text("response_format", "verbose_json")
        .text("temperature", "0").text("timestamp_granularities[]", "word")
        .text("timestamp_granularities[]", "segment").part("file", part);
    if let Some(lang) = language { if !lang.trim().is_empty() { form = form.text("language", lang.to_string()); } }
    let response = client.post(GROQ_URL).bearer_auth(key).multipart(form).send()
        .map_err(|e| format!("Falha de conexão com a Groq: {e}"))?;
    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().unwrap_or_default();
        return Err(format!("Groq HTTP {status}: {}", body.chars().take(500).collect::<String>()));
    }
    response.json::<GroqResponse>().map_err(|e| format!("Resposta de transcrição inválida: {e}"))
}
fn transcribe_cloud(app: &AppHandle, project_id: &str, audio: &Path, directory: &Path, duration: u64, language: Option<&str>) -> Result<TranscriptResult, String> {
    let chunks = chunk_audio(&ffmpeg()?, audio, directory, duration)?;
    let total = chunks.len();
    let client = Client::builder().timeout(Duration::from_secs(180)).build().map_err(|e| e.to_string())?;
    let key = crate::translation::resolve_api_key(app)?;
    let mut cues: Vec<TranscriptCue> = Vec::new();
    let mut detected_language = language.map(str::to_string);
    for (index, (path, offset)) in chunks.iter().enumerate() {
        emit(app, project_id, "cloud", (index as f32 / total.max(1) as f32) * 100.0, index, total, &format!("Transcrevendo bloco {} de {}", index + 1, total));
        let mut last = String::new();
        let mut response = None;
        for attempt in 0..4 {
            match groq_chunk(&client, &key, path, language) {
                Ok(value) => { response = Some(value); break; }
                Err(error) => {
                    last = error;
                    let retryable = last.contains("HTTP 429") || last.contains("HTTP 5") || last.contains("Falha de conexão");
                    if !retryable || attempt == 3 { break; }
                    std::thread::sleep(Duration::from_secs((2u64.pow(attempt)).min(12)));
                }
            }
        }
        let result = response.ok_or_else(|| last.clone())?;
        if detected_language.is_none() { detected_language = result.language.clone(); }
        for segment in result.segments.unwrap_or_default() {
            let start_ms = offset.saturating_add((segment.start.max(0.0) * 1000.0) as u64);
            let end_ms = offset.saturating_add((segment.end.max(segment.start) * 1000.0) as u64);
            let text = segment.text.trim().to_string();
            if text.is_empty() || end_ms <= start_ms { continue; }
            let words = segment.words.unwrap_or_default().into_iter().filter_map(|word| {
                let start = word.start?; let end = word.end?;
                Some(TranscriptWord { text: word.word, start_ms: offset.saturating_add((start.max(0.0)*1000.0) as u64), end_ms: offset.saturating_add((end.max(start)*1000.0) as u64) })
            }).collect();
            let duplicate = cues.iter().any(|cue| cue.text.eq_ignore_ascii_case(&text) && cue.start_ms.abs_diff(start_ms) < 1800);
            if !duplicate { cues.push(TranscriptCue { id: uuid::Uuid::new_v4().to_string(), text, start_ms, end_ms, words }); }
        }
        emit(app, project_id, "cloud", ((index + 1) as f32 / total.max(1) as f32) * 100.0, index + 1, total, &format!("Bloco {} de {} concluído", index + 1, total));
    }
    cues.sort_by_key(|cue| cue.start_ms);
    Ok(TranscriptResult { engine: "groq".into(), model: GROQ_MODEL.into(), language: detected_language, duration_ms: duration, cues })
}
fn run_python(args: &[&str]) -> Result<std::process::Output, String> {
    let first_error = match crate::process::hidden_command("python").args(args).output() {
        Ok(output) if output.status.success() => return Ok(output),
        Ok(output) => format!("python: {}", String::from_utf8_lossy(&output.stderr).chars().take(500).collect::<String>()),
        Err(error) => format!("python: {error}"),
    };
    let mut py_args = vec!["-3"];
    py_args.extend_from_slice(args);
    match crate::process::hidden_command("py").args(py_args).output() {
        Ok(output) if output.status.success() => Ok(output),
        Ok(output) => Err(format!("{first_error}; py -3: {}", String::from_utf8_lossy(&output.stderr).chars().take(700).collect::<String>())),
        Err(error) => Err(format!("{first_error}; py -3: {error}")),
    }
}

fn run_local_python(audio: &Path, model: &str, language: Option<&str>) -> Result<TranscriptResult, String> {
    const SCRIPT: &str = r#"import contextlib,json,sys
from faster_whisper import WhisperModel

def clean_unicode(value):
    return "".join(chr(0xFFFD) if 0xD800 <= ord(ch) <= 0xDFFF else ch for ch in value)

model_name, audio_path, language = sys.argv[1], sys.argv[2], sys.argv[3]
out=[]
with contextlib.redirect_stdout(sys.stderr):
    model = WhisperModel(model_name, device="auto", compute_type="auto")
    segments, info = model.transcribe(audio_path, language=(language or None), word_timestamps=True, vad_filter=True)
    for s in segments:
        words=[{"text":clean_unicode(w.word),"startMs":round(w.start*1000),"endMs":round(w.end*1000)} for w in (s.words or [])]
        out.append({"id":"","text":clean_unicode(s.text.strip()),"startMs":round(s.start*1000),"endMs":round(s.end*1000),"words":words})
payload=json.dumps({"language":clean_unicode(info.language or ""),"cues":out},ensure_ascii=True,separators=(",",":"))
sys.stdout.buffer.write(payload.encode("ascii"))
sys.stdout.buffer.flush()
"#;
    let lang = language.unwrap_or("");
    let audio_arg = audio.to_string_lossy().into_owned();
    let output = run_python(&["-c", SCRIPT, model, audio_arg.as_str(), lang])
        .map_err(|error| format!("Falha no Faster-Whisper local. Instale Python 3.10+ e o suporte local: {error}"))?;
    #[derive(Deserialize)] #[serde(rename_all="camelCase")]
    struct LocalOutput { language: Option<String>, cues: Vec<TranscriptCue> }
    let mut parsed: LocalOutput = serde_json::from_slice(&output.stdout).map_err(|e| format!("O mecanismo local retornou dados inválidos: {e}"))?;
    for cue in &mut parsed.cues { cue.id = uuid::Uuid::new_v4().to_string(); }
    Ok(TranscriptResult { engine:"faster-whisper".into(), model:model.into(), language:parsed.language, duration_ms:duration_ms(&ffprobe(&ffmpeg()?)?,audio)?, cues:parsed.cues })
}

pub fn check_local_asr() -> Result<bool, String> {
    match run_python(&["-c","import faster_whisper; print('ready')"]) {
        Ok(output) => Ok(String::from_utf8_lossy(&output.stdout).contains("ready")),
        Err(_) => Ok(false),
    }
}
pub fn install_local_asr() -> Result<String, String> {
    run_python(&["-m","pip","install","faster-whisper>=1.1,<2","av>=11,<19"])
        .map_err(|error| format!("Instalação do Faster-Whisper falhou: {error}"))?;
    Ok("Faster-Whisper instalado. O modelo será baixado automaticamente na primeira transcrição local.".into())
}

pub fn transcribe(app: AppHandle, media: MediaService, storage: MediaStorage, project_id: String, asset_id: String, mode: String, language: Option<String>, local_model: String) -> Result<TranscriptResult, String> {
    if !["auto", "cloud", "local"].contains(&mode.as_str()) { return Err("Modo de transcrição inválido.".into()); }
    if !["tiny", "base", "small", "medium", "large-v3"].contains(&local_model.as_str()) { return Err("Modelo local não reconhecido.".into()); }
    let source = safe_asset_path(&media, &storage, &project_id, &asset_id)?;
    let ffmpeg_path = ffmpeg()?;
    let temp = std::env::temp_dir().join(format!("framelab-asr-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&temp).map_err(|e| e.to_string())?;
    let result = (|| {
        let audio = temp.join("source.flac");
        emit(&app,&project_id,"preparing",0.0,0,0,"Extraindo áudio sem alterar o arquivo original");
        extract_audio(&ffmpeg_path,&source,&audio)?;
        let duration = duration_ms(&ffprobe(&ffmpeg_path)?,&audio)?;
        let selected = mode.as_str();
        let output = if selected == "local" {
            run_local_python(&audio,&local_model,language.as_deref())?
        } else if selected == "cloud" {
            transcribe_cloud(&app,&project_id,&audio,&temp,duration,language.as_deref())?
        } else {
            match transcribe_cloud(&app,&project_id,&audio,&temp,duration,language.as_deref()) {
                Ok(result) => result,
                Err(cloud_error) => {
                    emit(&app,&project_id,"fallback",0.0,0,0,&format!("Groq indisponível. Tentando processamento local. {cloud_error}"));
                    run_local_python(&audio,&local_model,language.as_deref()).map_err(|local_error| format!("A transcrição na nuvem falhou: {cloud_error}. O processamento local também não pôde ser concluído: {local_error}"))?
                }
            }
        };
        emit(&app,&project_id,"completed",100.0,1,1,"Transcrição concluída");
        Ok(output)
    })();
    let _ = std::fs::remove_dir_all(&temp);
    result
}
