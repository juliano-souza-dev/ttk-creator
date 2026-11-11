use std::{fs, path::{Path, PathBuf}, process::Stdio, time::{SystemTime, UNIX_EPOCH}};
use serde::{Deserialize, Serialize};
use crate::{domain::models::YoutubeInspection, infrastructure::youtube_downloader::YoutubeDownloader};

const TTL_MS: u64 = 7 * 24 * 60 * 60 * 1000;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all="camelCase")]
pub struct YoutubeCacheEntry {
    pub video_id: String,
    pub title: String,
    pub duration_ms: Option<u64>,
    pub file_path: String,
    pub last_attempt_at: u64,
    pub expires_at: u64,
}

#[derive(Clone)]
pub struct YoutubeCache { root: PathBuf }

impl YoutubeCache {
    pub fn new(root: PathBuf) -> Self { Self { root } }

    pub fn cleanup_expired(&self) -> Result<(), String> {
        fs::create_dir_all(&self.root).map_err(|e| e.to_string())?;
        let now = now_ms();
        for item in fs::read_dir(&self.root).map_err(|e| e.to_string())? {
            let item = item.map_err(|e| e.to_string())?;
            if !item.file_type().map_err(|e| e.to_string())?.is_dir() { continue; }
            let manifest = item.path().join("manifest.json");
            let expired = fs::read_to_string(&manifest).ok()
                .and_then(|raw| serde_json::from_str::<YoutubeCacheEntry>(&raw).ok())
                .map(|entry| entry.expires_at <= now).unwrap_or(false);
            if expired { let _ = fs::remove_dir_all(item.path()); }
        }
        Ok(())
    }

    pub fn prepare(&self, url: &str, max_height: u32) -> Result<YoutubeCacheEntry, String> {
        self.cleanup_expired()?;
        let info = YoutubeDownloader::inspect(url)?;
        let directory = self.root.join(&info.video_id);
        fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
        let manifest = directory.join("manifest.json");
        let video = directory.join("original.mp4");
        let now = now_ms();
        if video.is_file() && fs::metadata(&video).map(|m| m.len() > 0).unwrap_or(false) {
            let entry = entry_from(&info, &video, now);
            write_manifest(&manifest, &entry)?;
            return Ok(entry);
        }

        // Refresh the lease before starting the download: a failed attempt also
        // grants a fresh seven-day retention window.
        let pending = entry_from(&info, &video, now);
        write_manifest(&manifest, &pending)?;
        let (program, prefix) = ytdlp_command()?;
        let selector = if max_height == 0 { "bv*+ba/b".to_string() }
            else { format!("bv*[height<={max_height}]+ba/b[height<={max_height}]") };
        let output_template = directory.join("download.%(ext)s");
        let output = crate::process::hidden_command(program)
            .args(prefix)
            .args(["--no-warnings","--no-playlist","--format",&selector,"--merge-output-format","mp4","--remux-video","mp4","--output"])
            .arg(output_template.to_string_lossy().to_string())
            .arg(&info.url)
            .stdout(Stdio::piped()).stderr(Stdio::piped()).output()
            .map_err(|e| format!("Não foi possível iniciar o yt-dlp: {e}"))?;
        if !output.status.success() {
            return Err(format!("Falha no download do YouTube: {}", String::from_utf8_lossy(&output.stderr).trim()));
        }
        let downloaded = fs::read_dir(&directory).map_err(|e| e.to_string())?
            .filter_map(Result::ok).map(|e| e.path())
            .find(|p| p.extension().and_then(|x| x.to_str()).map(|x| x.eq_ignore_ascii_case("mp4")).unwrap_or(false) && p != &video)
            .ok_or("O download terminou, mas o MP4 não foi encontrado.")?;
        if video.exists() { fs::remove_file(&video).map_err(|e| e.to_string())?; }
        fs::rename(downloaded, &video).map_err(|e| e.to_string())?;
        let entry = entry_from(&info, &video, now);
        write_manifest(&manifest, &entry)?;
        Ok(entry)
    }

    pub fn validate_entry(&self, video_id: &str) -> Result<YoutubeCacheEntry, String> {
        if video_id.len()!=11 || !video_id.chars().all(|c| c.is_ascii_alphanumeric() || c=='_' || c=='-') {
            return Err("Identificador de vídeo inválido.".into());
        }
        let dir = self.root.join(video_id).canonicalize().map_err(|_| "O vídeo não está mais no cache. Baixe-o novamente.".to_string())?;
        let root = self.root.canonicalize().map_err(|e| e.to_string())?;
        if !dir.starts_with(&root) { return Err("Caminho de cache inválido.".into()); }
        let raw = fs::read_to_string(dir.join("manifest.json")).map_err(|_| "Dados do cache não encontrados.".to_string())?;
        let entry: YoutubeCacheEntry = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
        if entry.expires_at <= now_ms() { return Err("O cache deste vídeo expirou. Baixe-o novamente.".into()); }
        let file = PathBuf::from(&entry.file_path).canonicalize().map_err(|_| "O arquivo original não está mais no cache.".to_string())?;
        if !file.starts_with(&dir) || !file.is_file() { return Err("Arquivo de cache inválido.".into()); }
        Ok(entry)
    }
}

fn entry_from(info: &YoutubeInspection, path: &Path, now: u64) -> YoutubeCacheEntry {
    YoutubeCacheEntry { video_id: info.video_id.clone(), title: info.title.clone(),
        duration_ms: info.duration_ms, file_path: path.to_string_lossy().into_owned(),
        last_attempt_at: now, expires_at: now.saturating_add(TTL_MS) }
}
fn write_manifest(path: &Path, entry: &YoutubeCacheEntry) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(entry).map_err(|e| e.to_string())?;
    fs::write(path, bytes).map_err(|e| e.to_string())
}
fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as u64
}
fn ytdlp_command() -> Result<(String, Vec<String>), String> {
    for (program, prefix) in [("yt-dlp", vec![]),("yt-dlp.exe",vec![]),("py",vec!["-m","yt_dlp"]),("python",vec!["-m","yt_dlp"]),("python3",vec!["-m","yt_dlp"])] {
        if crate::process::hidden_command(program).args(&prefix).arg("--version").stdout(Stdio::null()).stderr(Stdio::null()).status().map(|s|s.success()).unwrap_or(false) {
            return Ok((program.into(), prefix.into_iter().map(str::to_string).collect()));
        }
    }
    Err("yt-dlp não foi encontrado. Instale com: py -m pip install --upgrade yt-dlp".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cache_ttl_is_seven_days() {
        assert_eq!(TTL_MS, 604_800_000);
        let now=1000;
        let entry=YoutubeCacheEntry { video_id:"abcdefghijk".into(), title:"x".into(), duration_ms:None,
            file_path:"x".into(), last_attempt_at:now, expires_at:now+TTL_MS };
        assert_eq!(entry.expires_at-entry.last_attempt_at, 7*24*60*60*1000);
    }
}
