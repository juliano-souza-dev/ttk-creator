use keyring::Entry;
use reqwest::{header, Client, StatusCode};
use serde::{Deserialize, Serialize};
use std::{path::PathBuf, time::Duration};
use tauri::{AppHandle, Emitter, Manager};

const SERVICE: &str = "com.julianosouza.ttkcreator";
const USER: &str = "groq-api-key";
const DEFAULT_MODEL: &str = "llama-3.3-70b-versatile";

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GroqSettings {
    pub configured: bool,
    pub model: String,
    pub max_chunk_chars: usize,
    pub max_cues_per_chunk: usize,
    pub delay_ms: u64,
    pub target_language: String,
}
impl Default for GroqSettings {
    fn default() -> Self {
        Self { configured: false, model: DEFAULT_MODEL.into(), max_chunk_chars: 7000, max_cues_per_chunk: 25, delay_ms: 1800, target_language: "Português brasileiro".into() }
    }
}
fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("groq-settings.json"))
}
fn read_settings(app: &AppHandle) -> Result<GroqSettings, String> {
    let path = settings_path(app)?;
    let mut settings = if path.exists() {
        serde_json::from_slice::<GroqSettings>(&std::fs::read(path).map_err(|e| e.to_string())?).unwrap_or_default()
    } else { GroqSettings::default() };
    settings.configured = Entry::new(SERVICE, USER).ok().and_then(|entry| entry.get_password().ok()).is_some();
    Ok(settings)
}
fn api_key() -> Result<String, String> {
    Entry::new(SERVICE, USER).map_err(|e| format!("Armazenamento seguro indisponível: {e}"))?
        .get_password().map_err(|_| "Configure sua chave Groq antes de continuar.".into())
}
#[tauri::command]
pub fn get_groq_settings(app: AppHandle) -> Result<GroqSettings, String> { read_settings(&app) }

#[tauri::command]
pub fn save_groq_settings(app: AppHandle, api_key: String, model: String, max_chunk_chars: usize, max_cues_per_chunk: usize, delay_ms: u64, target_language: String) -> Result<GroqSettings, String> {
    if !api_key.trim().is_empty() && (api_key.trim().len() < 20 || !api_key.trim().starts_with("gsk_")) {
        return Err("Informe uma chave Groq válida (ela normalmente começa com gsk_).".into());
    }
    if api_key.trim().is_empty() && Entry::new(SERVICE, USER).ok().and_then(|entry| entry.get_password().ok()).is_none() {
        return Err("Informe sua chave Groq para configurar a primeira conexão.".into());
    }
    let model = model.trim();
    if model.is_empty() || model.len() > 120 { return Err("Informe um identificador de modelo válido.".into()); }
    let settings = GroqSettings {
        configured: true, model: model.into(),
        max_chunk_chars: max_chunk_chars.clamp(1000, 18000),
        max_cues_per_chunk: max_cues_per_chunk.clamp(1, 60),
        delay_ms: delay_ms.clamp(0, 15000),
        target_language: if target_language.trim().is_empty() { "Português brasileiro".into() } else { target_language.trim().chars().take(80).collect() },
    };
    if !api_key.trim().is_empty() {
        Entry::new(SERVICE, USER).map_err(|e| e.to_string())?.set_password(api_key.trim()).map_err(|e| format!("Não foi possível salvar a chave no armazenamento seguro do sistema: {e}"))?;
    }
    let path = settings_path(&app)?;
    std::fs::write(path, serde_json::to_vec_pretty(&settings).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    Ok(settings)
}

#[derive(Deserialize)]
struct ChatCompletion { choices: Vec<Choice> }
#[derive(Deserialize)]
struct Choice { message: Message }
#[derive(Deserialize)]
struct Message { content: String }
#[derive(Deserialize)]
struct TranslationPayload { translations: Vec<TranslationItem> }
#[derive(Deserialize)]
struct TranslationItem { id: String, translation: String }
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CueInput { pub id: String, pub text: String, pub context_before: Option<String>, pub context_after: Option<String> }
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CueTranslation { pub id: String, pub translation: String }

#[tauri::command]
pub async fn test_groq_connection(app: AppHandle, model: String) -> Result<String, String> {
    let key = api_key()?;
    let client = Client::builder().timeout(Duration::from_secs(30)).build().map_err(|e| e.to_string())?;
    let response = client.post("https://api.groq.com/openai/v1/chat/completions")
        .bearer_auth(key).json(&serde_json::json!({
            "model": model, "messages":[{"role":"user","content":"Reply with exactly: connection_ok"}],
            "temperature":0, "max_tokens":16
        })).send().await.map_err(|e| format!("Falha de conexão com a Groq: {e}"))?;
    if !response.status().is_success() {
        let status=response.status(); let body=response.text().await.unwrap_or_default();
        return Err(format!("Groq respondeu HTTP {status}: {}", body.chars().take(500).collect::<String>()));
    }
    let _: ChatCompletion = response.json().await.map_err(|e| format!("Resposta inesperada da Groq: {e}"))?;
    let _ = app;
    Ok("Conexão com a Groq validada.".into())
}

fn emit_translation_status(app: &AppHandle, stage: &str, message: &str) {
    let _ = app.emit("groq-translation-status", serde_json::json!({ "stage": stage, "message": message }));
}

#[tauri::command]
pub async fn translate_groq_chunk(app: AppHandle, model: String, target_language: String, cues: Vec<CueInput>) -> Result<Vec<CueTranslation>, String> {
    if cues.is_empty() { return Ok(Vec::new()); }
    if cues.len() > 60 { return Err("O lote excede o limite de 60 legendas.".into()); }
    let total_chars: usize = cues.iter().map(|c| c.text.len()).sum();
    if total_chars > 18000 { return Err("O lote excede o limite de 18.000 caracteres.".into()); }
    emit_translation_status(&app, "Conectando à Groq", "Solicitando autenticação e preparando o envio do lote...");
    let key = api_key()?;
    let payload = cues.iter().map(|cue| serde_json::json!({"id":cue.id,"text":cue.text,"contextBefore":cue.context_before,"contextAfter":cue.context_after})).collect::<Vec<_>>();
    let system = format!(
        "You are a professional audiovisual subtitle translator. Translate each item into {}. Use contextBefore and contextAfter only to understand continuity, references and tone; translate only the text field. Preserve meaning, tone, register, idioms and continuity. Keep translations concise and natural for subtitles. Do not translate names unnecessarily. Return ONLY valid JSON in this exact shape: {{\"translations\":[{{\"id\":\"same id\",\"translation\":\"translated text\"}}]}}. Include every input id exactly once. Never add commentary.",
        target_language
    );
    let client = Client::builder().timeout(Duration::from_secs(90)).build().map_err(|e| e.to_string())?;
    let mut last_error = String::new();
    for attempt in 0..4 {
        emit_translation_status(&app, "Aguardando resposta da Groq", format!("Lote enviado. Tentativa {}/4. A API pode levar alguns segundos para responder.", attempt + 1).as_str());
        let response = client.post("https://api.groq.com/openai/v1/chat/completions")
            .bearer_auth(&key).json(&serde_json::json!({
                "model":&model,"messages":[{"role":"system","content":&system},{"role":"user","content":serde_json::to_string(&payload).map_err(|e|e.to_string())?}],
                "temperature":0.2,"max_tokens":6000,"response_format":{"type":"json_object"}
            })).send().await;
        match response {
            Ok(response) if response.status().is_success() => {
                emit_translation_status(&app, "Resposta recebida", "A Groq respondeu. Validando o conteúdo e as traduções...");
                let completion: ChatCompletion = response.json().await.map_err(|e| format!("Não foi possível interpretar a resposta da Groq: {e}"))?;
                let content = completion.choices.first().ok_or("A Groq retornou uma resposta vazia.")?.message.content.trim().to_string();
                let parsed: TranslationPayload = serde_json::from_str(&content).map_err(|e| format!("A Groq retornou JSON inválido: {e}. Tente novamente este lote."))?;
                let expected: std::collections::HashSet<&str> = cues.iter().map(|c|c.id.as_str()).collect();
                let mut seen = std::collections::HashSet::new();
                let mut output = Vec::new();
                for item in parsed.translations {
                    if expected.contains(item.id.as_str()) && seen.insert(item.id.clone()) && !item.translation.trim().is_empty() {
                        output.push(CueTranslation { id:item.id, translation:item.translation.trim().to_string() });
                    }
                }
                if output.len() != cues.len() { return Err(format!("A Groq traduziu {} de {} legendas. O lote não foi aplicado para evitar associações incompletas. Reprocesse este lote.",output.len(),cues.len())); }
                output.sort_by_key(|item| cues.iter().position(|cue|cue.id==item.id).unwrap_or(usize::MAX));
                return Ok(output);
            }
            Ok(response) => {
                let status=response.status();
                let retry=response.headers().get(header::RETRY_AFTER).and_then(|v|v.to_str().ok()).and_then(|v|v.parse::<u64>().ok()).unwrap_or(2u64.pow(attempt as u32));
                let body=response.text().await.unwrap_or_default();
                last_error=format!("Groq HTTP {status}: {}",body.chars().take(500).collect::<String>());
                if status != StatusCode::TOO_MANY_REQUESTS && !status.is_server_error() { return Err(last_error); }
                if attempt < 3 {
                    emit_translation_status(&app, "Nova tentativa automática", format!("A Groq respondeu HTTP {status}. Nova tentativa em até {retry}s ({}/4).", attempt + 2).as_str());
                    tokio::time::sleep(Duration::from_secs(retry.clamp(1,30))).await;
                }
            }
            Err(error) => {
                last_error=format!("Falha de rede: {error}");
                if attempt < 3 {
                    let wait = 2u64.pow(attempt as u32);
                    emit_translation_status(&app, "Problema de conexão", format!("{last_error}. Tentando novamente em {wait}s ({}/4).", attempt + 2).as_str());
                    tokio::time::sleep(Duration::from_secs(wait)).await;
                }
            }
        }
    }
    Err(format!("Não foi possível concluir o lote após 4 tentativas. {last_error}"))
}
