use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum AuthType {
    Password,
    Key,
    Agent,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerConfig {
    pub id: String,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth_type: AuthType,
    pub password: Option<String>,      // Encrypted in production
    pub private_key_path: Option<String>,
    pub tags: Vec<String>,
    pub group: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ServerStorage {
    pub servers: Vec<ServerConfig>,
}

fn get_storage_path(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    
    // Create directory if it doesn't exist
    fs::create_dir_all(&app_data_dir).map_err(|e| e.to_string())?;
    
    Ok(app_data_dir.join("servers.json"))
}

#[tauri::command]
pub fn load_servers(app: AppHandle) -> Result<Vec<ServerConfig>, String> {
    let path = get_storage_path(&app)?;
    
    if !path.exists() {
        return Ok(Vec::new());
    }
    
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let storage: ServerStorage = serde_json::from_str(&content).map_err(|e| e.to_string())?;
    
    Ok(storage.servers)
}

#[tauri::command]
pub fn save_servers(app: AppHandle, servers: Vec<ServerConfig>) -> Result<(), String> {
    let path = get_storage_path(&app)?;
    
    let storage = ServerStorage { servers };
    let content = serde_json::to_string_pretty(&storage).map_err(|e| e.to_string())?;
    
    fs::write(&path, content).map_err(|e| e.to_string())?;
    
    Ok(())
}

#[tauri::command]
pub fn add_server(app: AppHandle, server: ServerConfig) -> Result<Vec<ServerConfig>, String> {
    let mut servers = load_servers(app.clone())?;
    
    // Check for duplicate ID
    if servers.iter().any(|s| s.id == server.id) {
        return Err("Server with this ID already exists".into());
    }
    
    servers.push(server);
    save_servers(app, servers.clone())?;
    
    Ok(servers)
}

#[tauri::command]
pub fn update_server(app: AppHandle, server: ServerConfig) -> Result<Vec<ServerConfig>, String> {
    let mut servers = load_servers(app.clone())?;
    
    if let Some(idx) = servers.iter().position(|s| s.id == server.id) {
        servers[idx] = server;
        save_servers(app, servers.clone())?;
        Ok(servers)
    } else {
        Err("Server not found".into())
    }
}

#[tauri::command]
pub fn delete_server(app: AppHandle, id: String) -> Result<Vec<ServerConfig>, String> {
    let mut servers = load_servers(app.clone())?;
    
    let original_len = servers.len();
    servers.retain(|s| s.id != id);
    
    if servers.len() == original_len {
        return Err("Server not found".into());
    }
    
    save_servers(app, servers.clone())?;
    Ok(servers)
}

#[tauri::command]
pub fn test_connection(
    host: String,
    port: u16,
    username: String,
    auth_type: AuthType,
    password: Option<String>,
) -> Result<String, String> {
    use std::net::TcpStream;
    use std::time::Duration;
    use ssh2::Session;
    
    // Try to connect with timeout
    let addr = format!("{}:{}", host, port);
    let tcp = TcpStream::connect_timeout(
        &addr.parse().map_err(|e: std::net::AddrParseError| e.to_string())?,
        Duration::from_secs(10),
    ).map_err(|e| format!("连接失败: {}", e))?;
    
    let mut sess = Session::new().map_err(|e| e.to_string())?;
    sess.set_tcp_stream(tcp);
    sess.handshake().map_err(|e| format!("SSH握手失败: {}", e))?;
    
    match auth_type {
        AuthType::Password => {
            let pwd = password.ok_or("密码未提供")?;
            sess.userauth_password(&username, &pwd)
                .map_err(|e| format!("密码认证失败: {}", e))?;
        }
        AuthType::Agent => {
            sess.userauth_agent(&username)
                .map_err(|e| format!("Agent认证失败: {}", e))?;
        }
        AuthType::Key => {
            // For now, use agent as fallback
            sess.userauth_agent(&username)
                .map_err(|e| format!("密钥认证失败: {}", e))?;
        }
    }
    
    if sess.authenticated() {
        Ok("连接成功".into())
    } else {
        Err("认证失败".into())
    }
}

// ============ Settings Storage ============

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FontSettings {
    pub terminal: u32,
    pub sidebar: u32,
    pub monitor: u32,
    pub file_manager: u32,
}

impl Default for FontSettings {
    fn default() -> Self {
        Self {
            terminal: 14,
            sidebar: 12,
            monitor: 11,
            file_manager: 12,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppSettings {
    pub fonts: FontSettings,
    pub theme: String, // "light", "dark", "system"
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            fonts: FontSettings::default(),
            theme: "dark".to_string(),
        }
    }
}

fn get_settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    
    fs::create_dir_all(&app_data_dir).map_err(|e| e.to_string())?;
    
    Ok(app_data_dir.join("settings.json"))
}

#[tauri::command]
pub fn load_settings(app: AppHandle) -> Result<AppSettings, String> {
    let path = get_settings_path(&app)?;
    
    if !path.exists() {
        return Ok(AppSettings::default());
    }
    
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let settings: AppSettings = serde_json::from_str(&content).unwrap_or_default();
    
    Ok(settings)
}

#[tauri::command]
pub fn save_settings(app: AppHandle, settings: AppSettings) -> Result<(), String> {
    let path = get_settings_path(&app)?;
    
    let content = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    
    fs::write(&path, content).map_err(|e| e.to_string())?;
    
    Ok(())
}

// ============ Groups Storage ============

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GroupSettings {
    pub groups: Vec<String>,
    pub expanded_groups: Vec<String>,
}

impl Default for GroupSettings {
    fn default() -> Self {
        Self {
            groups: vec!["默认".to_string()],
            expanded_groups: vec!["默认".to_string()],
        }
    }
}

fn get_groups_path(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    
    fs::create_dir_all(&app_data_dir).map_err(|e| e.to_string())?;
    
    Ok(app_data_dir.join("groups.json"))
}

#[tauri::command]
pub fn load_groups(app: AppHandle) -> Result<GroupSettings, String> {
    let path = get_groups_path(&app)?;
    
    if !path.exists() {
        return Ok(GroupSettings::default());
    }
    
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let groups: GroupSettings = serde_json::from_str(&content).unwrap_or_default();
    
    Ok(groups)
}

#[tauri::command]
pub fn save_groups(app: AppHandle, groups: GroupSettings) -> Result<(), String> {
    let path = get_groups_path(&app)?;
    
    let content = serde_json::to_string_pretty(&groups).map_err(|e| e.to_string())?;
    
    fs::write(&path, content).map_err(|e| e.to_string())?;
    
    Ok(())
}

