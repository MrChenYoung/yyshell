use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};
use crate::keychain;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum AuthType {
    Password,
    Key,
    Agent,
}

/// Port forwarding / SSH tunnel preset configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PortForward {
    pub id: String,
    #[serde(default)]
    pub name: Option<String>,           // Preset name, e.g. "MySQL数据库"
    #[serde(default)]
    pub category: Option<String>,       // Category: 数据库, Web服务, 开发工具
    pub local_port: u16,
    pub remote_host: String,
    pub remote_port: u16,
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub auto_start: bool,               // Auto-start when connecting
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerConfig {
    pub id: String,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth_type: AuthType,
    #[serde(default)]  // Password loaded from keychain, not saved to JSON
    pub password: Option<String>,
    pub private_key_path: Option<String>,
    pub tags: Vec<String>,
    pub group: Option<String>,
    #[serde(default)]  // Port forwards configuration
    pub port_forwards: Option<Vec<PortForward>>,
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
    
    // Load passwords from system keychain (ONLY source of passwords)
    let servers = storage.servers.into_iter().map(|mut s| {
        s.password = keychain::get_password(&s.id);
        s
    }).collect();
    
    Ok(servers)
}

#[tauri::command]
pub fn save_servers(app: AppHandle, servers: Vec<ServerConfig>) -> Result<(), String> {
    let path = get_storage_path(&app)?;
    
    // Save passwords to keychain
    for server in &servers {
        if let Some(pwd) = &server.password {
            if !pwd.is_empty() {
                keychain::save_password(&server.id, pwd)?;
            }
        }
    }
    
    // Clear passwords before saving to file (passwords are stored in keychain, NOT in JSON)
    let servers_for_file: Vec<ServerConfig> = servers.into_iter().map(|mut s| {
        s.password = None;  // Never save password to JSON file
        s
    }).collect();
    
    let storage = ServerStorage { servers: servers_for_file };
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
    
    // Save password to keychain
    if let Some(pwd) = &server.password {
        if !pwd.is_empty() {
            keychain::save_password(&server.id, pwd)?;
        }
    }
    
    servers.push(server);
    save_servers(app, servers.clone())?;
    
    Ok(servers)
}

#[tauri::command]
pub fn update_server(app: AppHandle, server: ServerConfig) -> Result<Vec<ServerConfig>, String> {
    let mut servers = load_servers(app.clone())?;
    
    if let Some(idx) = servers.iter().position(|s| s.id == server.id) {
        // Update password in keychain
        if let Some(pwd) = &server.password {
            if !pwd.is_empty() {
                keychain::save_password(&server.id, pwd)?;
            }
        }
        
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
    
    // Delete password from keychain
    let _ = keychain::delete_password(&id);
    
    save_servers(app, servers.clone())?;
    Ok(servers)
}

#[tauri::command]
pub async fn test_connection(
    host: String,
    port: u16,
    username: String,
    auth_type: AuthType,
    password: Option<String>,
    private_key_path: Option<String>,
) -> Result<String, String> {
    use std::sync::Arc;
    use std::time::Duration;
    use russh::*;
    
    // Simple client handler for testing
    struct TestClient;
    
    #[async_trait::async_trait]
    impl client::Handler for TestClient {
        type Error = russh::Error;
        
        async fn check_server_key(
            &mut self,
            _server_public_key: &russh_keys::PublicKey
        ) -> Result<bool, Self::Error> {
            Ok(true)
        }
    }
    
    // Build config
    let config = Arc::new(client::Config {
        inactivity_timeout: Some(Duration::from_secs(30)),
        ..Default::default()
    });
    
    // Connect with timeout
    let addr = format!("{}:{}", host, port);
    let mut handle = tokio::time::timeout(
        Duration::from_secs(10),
        client::connect(config, addr.clone(), TestClient)
    )
    .await
    .map_err(|_| "连接超时".to_string())?
    .map_err(|e| format!("连接失败: {}", e))?;
    
    // Authenticate
    let authenticated = match auth_type {
        AuthType::Password => {
            let pwd = password.ok_or("密码未提供")?;
            handle.authenticate_password(&username, &pwd)
                .await
                .map_err(|e| format!("密码认证失败: {}", e))?
        }
        AuthType::Agent => {
            return Err("SSH Agent认证在russh中尚未实现".into());
        }
        AuthType::Key => {
            let key_path = private_key_path.ok_or("私钥路径未提供")?;
            let key = russh_keys::load_secret_key(&key_path, password.as_deref())
                .map_err(|e| format!("读取私钥失败: {}", e))?;
            handle.authenticate_publickey(&username, Arc::new(key))
                .await
                .map_err(|e| format!("密钥认证失败: {}", e))?
        }
    };
    
    if authenticated {
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
    #[serde(default = "default_idle_timeout")]
    pub idle_timeout_minutes: u32, // 0 = never disconnect, otherwise minutes
}

fn default_idle_timeout() -> u32 {
    30 // Default 30 minutes
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            fonts: FontSettings::default(),
            theme: "dark".to_string(),
            idle_timeout_minutes: 30, // 30 minutes default
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

// ============ Tabs Storage ============

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QuickConnectInfo {
    pub host: String,
    pub username: String,
    // Password is intentionally NOT persisted for security
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SavedTab {
    pub id: String,
    #[serde(rename = "serverId")]
    pub server_id: Option<String>,
    pub title: String,
    #[serde(rename = "type")]
    pub tab_type: String, // "terminal" | "sftp" | "welcome"
    #[serde(rename = "quickConnectInfo")]
    pub quick_connect_info: Option<QuickConnectInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct TabStorage {
    pub tabs: Vec<SavedTab>,
    #[serde(rename = "activeTabId")]
    pub active_tab_id: Option<String>,
}

fn get_tabs_path(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    
    fs::create_dir_all(&app_data_dir).map_err(|e| e.to_string())?;
    
    Ok(app_data_dir.join("tabs.json"))
}

#[tauri::command]
pub fn load_tabs(app: AppHandle) -> Result<TabStorage, String> {
    let path = get_tabs_path(&app)?;
    
    if !path.exists() {
        return Ok(TabStorage::default());
    }
    
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let tabs: TabStorage = serde_json::from_str(&content).unwrap_or_default();
    
    Ok(tabs)
}

#[tauri::command]
pub fn save_tabs(app: AppHandle, tabs: TabStorage) -> Result<(), String> {
    let path = get_tabs_path(&app)?;
    
    let content = serde_json::to_string_pretty(&tabs).map_err(|e| e.to_string())?;
    
    fs::write(&path, content).map_err(|e| e.to_string())?;
    
    Ok(())
}

