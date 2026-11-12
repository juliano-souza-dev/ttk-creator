use keyring::Entry;
use serde::{Deserialize, Serialize};
use std::{path::PathBuf, sync::{Mutex, OnceLock}};
use tauri::{AppHandle, Manager};

const SERVICE: &str = "com.julianosouza.ttkcreator";
const USER: &str = "groq-api-key";
const DEFAULT_MODEL: &str = "llama-3.3-70b-versatile";
static SESSION_API_KEY: OnceLock<Mutex<Option<String>>> = OnceLock::new();
fn session_key() -> &'static Mutex<Option<String>> { SESSION_API_KEY.get_or_init(|| Mutex::new(None)) }

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
fn shared_manifest(app: &AppHandle) -> Result<Option<(PathBuf, serde_json::Value)>, String> {
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
    let mut seen = std::collections::HashSet::new();
    for candidate in candidates {
        let path = if candidate.is_dir() { candidate.join("shared.config.json") } else { candidate };
        if !seen.insert(path.clone()) || !path.is_file() { continue; }
        let raw = std::fs::read(&path).map_err(|error| format!("Não foi possível ler o vínculo Shared Runtime em {}: {error}", path.display()))?;
        let manifest: serde_json::Value = serde_json::from_slice(&raw)
            .map_err(|error| format!("Manifesto Shared Runtime inválido em {}: {error}", path.display()))?;
        if manifest.get("schemaVersion").and_then(|value| value.as_str()) != Some("1.0") {
            return Err("A versão do shared.config.json não é compatível. Atualize o vínculo pelo Shared Runtime Manager.".into());
        }
        if manifest.pointer("/shared/enabled").and_then(|value| value.as_bool()) != Some(true) {
            return Err("O Shared Runtime está desativado para esta aplicação.".into());
        }
        return Ok(Some((path, manifest)));
    }
    Ok(None)
}

fn shared_provider_entry(app: &AppHandle) -> Result<Option<Entry>, String> {
    let Some((manifest_path, mut manifest)) = shared_manifest(app)? else { return Ok(None); };
    let app_id = manifest.pointer("/application/id").and_then(|value| value.as_str()).map(str::to_owned)
        .ok_or("O manifesto Shared Runtime não identifica esta aplicação.")?;

    // The application owns its provider declarations. Register Groq here when an
    // existing Shared Runtime link predates this integration, preserving all
    // other application-owned declarations and leaving authorization untouched.
    let declaration_changed = {
        let shared = manifest.get_mut("shared").and_then(|value| value.as_object_mut())
            .ok_or("A seção 'shared' do manifesto Shared Runtime está inválida.")?;
        let providers = shared.entry("providers").or_insert_with(|| serde_json::Value::Array(Vec::new()));
        let providers = providers.as_array_mut()
            .ok_or("A declaração shared.providers precisa ser uma lista. O manifesto não foi alterado.")?;
        if providers.iter().any(|item| item.get("id").and_then(|value| value.as_str()) == Some("groq")) {
            false
        } else {
            providers.push(serde_json::json!({"id":"groq","required":false}));
            true
        }
    };
    if declaration_changed {
        let serialized = serde_json::to_vec_pretty(&manifest)
            .map_err(|error| format!("Não foi possível atualizar a declaração da Groq: {error}"))?;
        std::fs::write(&manifest_path, serialized)
            .map_err(|error| format!("Não foi possível registrar Groq em shared.providers no vínculo da aplicação: {error}"))?;
    }

    let registry_path = manifest.pointer("/shared/files/apiProviders").and_then(|value| value.as_str())
        .ok_or("O manifesto não aponta para o registro global de APIs (shared.files.apiProviders). Execute novamente o registro da aplicação no Shared Runtime Manager.")?;
    let registry: serde_json::Value = serde_json::from_slice(&std::fs::read(registry_path)
        .map_err(|error| format!("Não foi possível acessar o registro global de APIs: {error}"))?)
        .map_err(|error| format!("O registro global de APIs está inválido: {error}"))?;
    let provider = registry.pointer("/providers/groq")
        .ok_or("O provedor Groq não está configurado no Shared Runtime Manager.")?;
    let authorized = provider.get("authorized_apps").and_then(|value| value.as_array())
        .is_some_and(|apps| apps.iter().any(|item| item.as_str() == Some(app_id.as_str())));
    if !authorized {
        return Err(format!("A aplicação '{app_id}' ainda não está autorizada a usar a API Groq. Autorize-a no Shared Runtime Manager."));
    }
    #[cfg(windows)]
    {
        let entry = Entry::new("JulianoDev.SharedRuntime.Api", "api:groq")
            .map_err(|error| format!("Não foi possível acessar a credencial global da Groq: {error}"))?;
        Ok(Some(entry))
    }
    #[cfg(not(windows))]
    {
        Err("O armazenamento seguro de credenciais do Shared Runtime está disponível nesta integração apenas no Windows.".into())
    }
}

fn read_settings(app: &AppHandle) -> Result<GroqSettings, String> {
    let path = settings_path(app)?;
    let mut settings = if path.exists() {
        serde_json::from_slice::<GroqSettings>(&std::fs::read(path).map_err(|e| e.to_string())?).unwrap_or_default()
    } else { GroqSettings::default() };
    settings.configured = resolve_api_key(app).is_ok();
    Ok(settings)
}

pub(crate) fn resolve_api_key(app: &AppHandle) -> Result<String, String> {
    if let Some(entry) = shared_provider_entry(app)? {
        return entry.get_password()
            .map_err(|error| format!("A credencial Groq não foi encontrada no Shared Runtime. Cadastre-a uma única vez pelo Shared Runtime Manager. Detalhe: {error}"));
    }
    if let Ok(entry) = Entry::new(SERVICE, USER) {
        if let Ok(key) = entry.get_password() { return Ok(key); }
    }
    session_key().lock().ok().and_then(|key| key.clone())
        .ok_or_else(|| "A chave Groq não foi encontrada no Shared Runtime nem nas credenciais legadas desta sessão.".into())
}

#[tauri::command]
pub fn get_groq_settings(app: AppHandle) -> Result<GroqSettings, String> { read_settings(&app) }

#[tauri::command]
pub fn save_groq_settings(app: AppHandle, api_key: String, model: String, max_chunk_chars: usize, max_cues_per_chunk: usize, delay_ms: u64, target_language: String) -> Result<GroqSettings, String> {
    if !api_key.trim().is_empty() && (api_key.trim().len() < 20 || !api_key.trim().starts_with("gsk_")) {
        return Err("Informe uma chave Groq válida (ela normalmente começa com gsk_).".into());
    }
    if api_key.trim().is_empty() && resolve_api_key(&app).is_err() {
        return Err("A chave Groq não está disponível no Shared Runtime. Cadastre-a no Gerenciador Global de APIs.".into());
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
        if let Some(entry) = shared_provider_entry(&app)? {
            entry.set_password(api_key.trim())
                .map_err(|error| format!("Não foi possível atualizar a credencial global da Groq: {error}"))?;
        } else {
            let normalized_key = api_key.trim().to_string();
            Entry::new(SERVICE, USER).map_err(|e| format!("Não foi possível acessar o Gerenciador de Credenciais do Windows: {e}"))?
                .set_password(&normalized_key).map_err(|e| format!("Não foi possível salvar a chave no Gerenciador de Credenciais do Windows: {e}"))?;
            if let Ok(mut cached) = session_key().lock() { *cached = Some(normalized_key); }
        }
    }
    let path = settings_path(&app)?;
    std::fs::write(path, serde_json::to_vec_pretty(&settings).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    Ok(settings)
}
