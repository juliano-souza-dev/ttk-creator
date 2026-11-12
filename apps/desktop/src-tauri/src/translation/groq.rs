use reqwest::{header, Client, StatusCode};
use serde::{Deserialize, Serialize};
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use super::settings::{resolve_api_endpoint, resolve_api_key, resolve_api_model};

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
pub async fn test_groq_connection(app: AppHandle) -> Result<String, String> {
    let key = resolve_api_key(&app)?;
    let model = resolve_api_model(&app)?;
    let endpoint = format!("{}/chat/completions", resolve_api_endpoint(&app)?.trim_end_matches('/'));
    let client = Client::builder().timeout(Duration::from_secs(30)).build().map_err(|e| e.to_string())?;
    let response = client.post(endpoint)
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
pub async fn translate_groq_chunk(app: AppHandle, target_language: String, cues: Vec<CueInput>) -> Result<Vec<CueTranslation>, String> {
    if cues.is_empty() { return Ok(Vec::new()); }
    if cues.len() > 60 { return Err("O lote excede o limite de 60 legendas.".into()); }
    let total_chars: usize = cues.iter().map(|c| c.text.len()).sum();
    if total_chars > 18000 { return Err("O lote excede o limite de 18.000 caracteres.".into()); }
    emit_translation_status(&app, "Conectando à Groq", "Solicitando autenticação e preparando o envio do lote...");
    let key = resolve_api_key(&app)?;
    let model = resolve_api_model(&app)?;
    let endpoint = format!("{}/chat/completions", resolve_api_endpoint(&app)?.trim_end_matches('/'));
    let payload = cues.iter().map(|cue| serde_json::json!({"id":cue.id,"text":cue.text,"contextBefore":cue.context_before,"contextAfter":cue.context_after})).collect::<Vec<_>>();
    let system = format!(
        "You are a professional audiovisual subtitle translator. Detect the source language automatically for each text and translate it into {}. Use contextBefore and contextAfter only to understand continuity, references and tone; translate only the text field. Preserve meaning, tone, register, idioms and continuity. Keep translations concise and natural for subtitles. Do not translate names unnecessarily. Return ONLY valid JSON in this exact shape: {{\"translations\":[{{\"id\":\"same id\",\"translation\":\"translated text\"}}]}}. Include every input id exactly once. Never add commentary.",
        target_language
    );
    let client = Client::builder().timeout(Duration::from_secs(90)).build().map_err(|e| e.to_string())?;
    let mut last_error = String::new();
    for attempt in 0..4 {
        emit_translation_status(&app, "Aguardando resposta da Groq", format!("Lote enviado. Tentativa {}/4. A API pode levar alguns segundos para responder.", attempt + 1).as_str());
        let response = client.post(&endpoint)
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
