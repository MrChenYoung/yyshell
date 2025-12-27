// Plugin-related Tauri commands

use crate::plugin_manager::PluginManager;
use crate::plugin_types::*;
use std::path::Path;
use std::sync::Arc;
use tauri::State;

/// Plugin manager state
pub struct PluginState {
    manager: Arc<PluginManager>,
}

impl Default for PluginState {
    fn default() -> Self {
        Self {
            manager: Arc::new(PluginManager::new().expect("Failed to create plugin manager")),
        }
    }
}

/// List all installed plugins
#[tauri::command]
pub fn list_plugins(state: State<'_, PluginState>) -> Result<Vec<PluginInfo>, String> {
    state.manager.list_plugins().map_err(|e| e.to_string())
}

/// Install plugin from local zip file
#[tauri::command]
pub fn install_plugin_local(
    state: State<'_, PluginState>,
    path: &str,
) -> Result<PluginInfo, String> {
    let path = Path::new(path);
    state.manager.install_from_local(path).map_err(|e| e.to_string())
}

/// Install plugin from GitHub repository
#[tauri::command]
pub async fn install_plugin_github(
    state: State<'_, PluginState>,
    repo_url: String,
) -> Result<PluginInfo, String> {
    state.manager.install_from_github(&repo_url).await.map_err(|e| e.to_string())
}

/// Uninstall a plugin
#[tauri::command]
pub fn uninstall_plugin(
    state: State<'_, PluginState>,
    plugin_id: &str,
) -> Result<(), String> {
    state.manager.uninstall(plugin_id).map_err(|e| e.to_string())
}

/// Enable or disable a plugin
#[tauri::command]
pub fn set_plugin_enabled(
    state: State<'_, PluginState>,
    plugin_id: &str,
    enabled: bool,
) -> Result<(), String> {
    state.manager.set_enabled(plugin_id, enabled).map_err(|e| e.to_string())
}

/// Check for plugin updates
#[tauri::command]
pub async fn check_plugin_updates(
    state: State<'_, PluginState>,
) -> Result<Vec<PluginUpdate>, String> {
    Ok(state.manager.check_updates().await)
}

/// Call a plugin function
#[tauri::command]
pub fn call_plugin_method(
    state: State<'_, PluginState>,
    plugin_id: &str,
    method: &str,
    args: Vec<i32>,
) -> Result<Vec<i32>, String> {
    let runtime = state.manager.get_runtime();
    let runtime = runtime.lock().unwrap();
    
    // Convert i32 args to wasmtime Val
    let wasm_args: Vec<wasmtime::Val> = args.iter().map(|&v| wasmtime::Val::I32(v)).collect();
    
    let results = runtime.call_plugin_function(plugin_id, method, &wasm_args)
        .map_err(|e| e.to_string())?;
    
    // Convert results back to i32
    let i32_results: Vec<i32> = results.iter()
        .filter_map(|v| match v {
            wasmtime::Val::I32(i) => Some(*i),
            _ => None,
        })
        .collect();
    
    Ok(i32_results)
}

/// Get plugin contributions (panels, commands, etc.)
#[tauri::command]
pub fn get_plugin_contributions(state: State<'_, PluginState>) -> Result<AllContributions, String> {
    let plugins = state.manager.list_plugins().map_err(|e| e.to_string())?;
    
    let mut all = AllContributions {
        panels: Vec::new(),
        commands: Vec::new(),
    };
    
    for plugin in plugins {
        if plugin.enabled {
            for panel in plugin.manifest.contributes.panels {
                all.panels.push(PanelWithPlugin {
                    plugin_id: plugin.manifest.id.clone(),
                    panel,
                });
            }
            for command in plugin.manifest.contributes.commands {
                all.commands.push(CommandWithPlugin {
                    plugin_id: plugin.manifest.id.clone(),
                    command,
                });
            }
        }
    }
    
    Ok(all)
}

/// All contributions from enabled plugins
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct AllContributions {
    pub panels: Vec<PanelWithPlugin>,
    pub commands: Vec<CommandWithPlugin>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct PanelWithPlugin {
    pub plugin_id: String,
    pub panel: PanelContribution,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct CommandWithPlugin {
    pub plugin_id: String,
    pub command: CommandContribution,
}

/// Fetch marketplace registry with live version info from GitHub
#[tauri::command]
pub async fn fetch_marketplace() -> Result<MarketplaceRegistry, String> {
    // Registry URL - can be changed to a remote URL later
    let registry_url = "https://raw.githubusercontent.com/MrChenYoung/yyshell/main/plugins/registry.json";
    
    let client = reqwest::Client::builder()
        .user_agent("YYShell/1.0")
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;
    
    let response = client
        .get(registry_url)
        .send()
        .await
        .map_err(|e| format!("Failed to fetch registry: {}", e))?;
    
    if !response.status().is_success() {
        // Return empty registry if fetch fails  
        return Ok(MarketplaceRegistry {
            version: 1,
            plugins: Vec::new(),
        });
    }
    
    let mut registry: MarketplaceRegistry = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse registry: {}", e))?;
    
    // Fetch latest version from GitHub API for each plugin
    for plugin in &mut registry.plugins {
        if let Some((owner, repo)) = parse_github_repo_url(&plugin.repository) {
            let api_url = format!("https://api.github.com/repos/{}/{}/releases/latest", owner, repo);
            
            if let Ok(resp) = client.get(&api_url).send().await {
                if resp.status().is_success() {
                    if let Ok(release) = resp.json::<serde_json::Value>().await {
                        if let Some(tag) = release["tag_name"].as_str() {
                            // Remove 'v' prefix if present (e.g., "v1.2.0" -> "1.2.0")
                            let version = tag.trim_start_matches('v').to_string();
                            plugin.version = version;
                        }
                    }
                }
            }
        }
    }
    
    Ok(registry)
}

/// Parse GitHub repository URL to extract owner and repo name
fn parse_github_repo_url(url: &str) -> Option<(String, String)> {
    // Handle formats like:
    // - https://github.com/owner/repo
    // - https://github.com/owner/repo.git
    // - github.com/owner/repo
    let url = url.trim_end_matches('/').trim_end_matches(".git");
    let parts: Vec<&str> = url.split('/').collect();
    
    if parts.len() >= 2 {
        let repo = parts[parts.len() - 1].to_string();
        let owner = parts[parts.len() - 2].to_string();
        if !owner.is_empty() && !repo.is_empty() {
            return Some((owner, repo));
        }
    }
    None
}

/// Install plugin from marketplace
#[tauri::command]
pub async fn install_from_marketplace(
    state: State<'_, PluginState>,
    download_url: String,
) -> Result<PluginInfo, String> {
    // Download the plugin zip to a temp location
    let client = reqwest::Client::builder()
        .user_agent("YYShell/1.0")
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;
    
    let response = client
        .get(&download_url)
        .send()
        .await
        .map_err(|e| format!("Failed to download plugin: {}", e))?;
    
    if !response.status().is_success() {
        return Err(format!("Download failed with status: {}", response.status()));
    }
    
    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("Failed to read response: {}", e))?;
    
    // Save to temp file
    let temp_dir = std::env::temp_dir();
    let temp_file = temp_dir.join(format!("yyshell_plugin_{}.zip", uuid::Uuid::new_v4()));
    std::fs::write(&temp_file, &bytes)
        .map_err(|e| format!("Failed to write temp file: {}", e))?;
    
    // Install from local file
    let result = state.manager.install_from_local(&temp_file);
    
    // Clean up temp file
    let _ = std::fs::remove_file(&temp_file);
    
    result.map_err(|e| e.to_string())
}

/// Load plugin UI bundle content
/// Reads the bundled JS file from the plugin's installation directory
#[tauri::command]
pub fn load_plugin_bundle(
    state: State<'_, PluginState>,
    plugin_id: String,
) -> Result<String, String> {
    // Get plugin info to find its path
    let plugins = state.manager.list_plugins().map_err(|e| e.to_string())?;
    
    let plugin = plugins
        .iter()
        .find(|p| p.manifest.id == plugin_id)
        .ok_or_else(|| format!("Plugin '{}' not found", plugin_id))?;
    
    if !plugin.enabled {
        return Err(format!("Plugin '{}' is not enabled", plugin_id));
    }
    
    let plugin_path = std::path::Path::new(&plugin.path);
    
    // Try to find the bundle file
    // First check manifest.entrypoints.frontend, then fall back to dist/plugin.js
    let bundle_path = if let Some(ref frontend) = plugin.manifest.entrypoints.frontend {
        plugin_path.join(frontend)
    } else {
        plugin_path.join("dist").join("plugin.js")
    };
    
    if !bundle_path.exists() {
        return Err(format!(
            "Plugin bundle not found at: {}. Make sure the plugin is built.",
            bundle_path.display()
        ));
    }
    
    std::fs::read_to_string(&bundle_path)
        .map_err(|e| format!("Failed to read plugin bundle: {}", e))
}

/// Get plugin icon as base64 encoded image
/// Returns the icon data as a data URI (e.g., "data:image/png;base64,...")
#[tauri::command]
pub fn get_plugin_icon(
    state: State<'_, PluginState>,
    plugin_id: String,
) -> Result<Option<String>, String> {
    // Get plugin info to find its path and icon
    let plugins = state.manager.list_plugins().map_err(|e| e.to_string())?;
    
    let plugin = plugins
        .iter()
        .find(|p| p.manifest.id == plugin_id)
        .ok_or_else(|| format!("Plugin '{}' not found", plugin_id))?;
    
    // Check if plugin has an icon defined
    let icon_rel_path = match &plugin.manifest.icon {
        Some(path) => path.clone(),
        None => return Ok(None),
    };
    
    // Clean up the path (remove ./ prefix if present)
    let icon_rel_path = icon_rel_path.trim_start_matches("./").to_string();
    
    let plugin_path = std::path::Path::new(&plugin.path);
    let icon_path = plugin_path.join(&icon_rel_path);
    
    if !icon_path.exists() {
        return Ok(None);
    }
    
    // Read the icon file
    let icon_data = std::fs::read(&icon_path)
        .map_err(|e| format!("Failed to read icon: {}", e))?;
    
    // Determine MIME type from extension
    let mime_type = match icon_path.extension().and_then(|e| e.to_str()) {
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("svg") => "image/svg+xml",
        Some("webp") => "image/webp",
        Some("gif") => "image/gif",
        Some("ico") => "image/x-icon",
        _ => "image/png", // default
    };
    
    // Encode as base64 data URI
    use base64::Engine;
    let encoded = base64::engine::general_purpose::STANDARD.encode(&icon_data);
    let data_uri = format!("data:{};base64,{}", mime_type, encoded);
    
    Ok(Some(data_uri))
}
