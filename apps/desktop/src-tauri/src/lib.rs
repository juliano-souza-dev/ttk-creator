use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf};
use tauri::{AppHandle, Manager};
use uuid::Uuid;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProjectSummary {
    id: String,
    name: String,
    created_at: String,
    updated_at: String,
    width: u32,
    height: u32,
}

fn projects_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let mut path = app.path().app_data_dir().map_err(|e| e.to_string())?;
    path.push("projects");
    fs::create_dir_all(&path).map_err(|e| e.to_string())?;
    Ok(path)
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
        let document: serde_json::Value =
            serde_json::from_str(&content).map_err(|e| e.to_string())?;
        let project: ProjectSummary = serde_json::from_value(
            document.get("project").cloned().ok_or("Project document has no project metadata")?
        ).map_err(|e| e.to_string())?;
        projects.push(project);
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

    let mut folder = projects_dir(&app)?;
    folder.push(&id);
    fs::create_dir_all(&folder).map_err(|e| e.to_string())?;

    let document = serde_json::json!({
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

fn timestamp_millis() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    millis.to_string()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![list_projects, create_project])
        .run(tauri::generate_context!())
        .expect("error while running TikTok Media Creator");
}
