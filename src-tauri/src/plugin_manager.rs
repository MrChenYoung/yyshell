// Plugin manager - handles installation, uninstallation, and updates

use crate::plugin_runtime::PluginRuntime;
use crate::plugin_types::*;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use zip::ZipArchive;

/// Plugin manager handles plugin lifecycle
pub struct PluginManager {
    runtime: Arc<Mutex<PluginRuntime>>,
    registry: Mutex<PluginRegistry>,
    plugins_dir: PathBuf,
    registry_path: PathBuf,
}

impl PluginManager {
    pub fn new() -> Result<Self, PluginError> {
        let plugins_dir = dirs::data_dir()
            .ok_or_else(|| PluginError::new("NO_DATA_DIR", "Could not find data directory"))?
            .join("com.yyshell.app")
            .join("plugins");
        
        // Create plugins directory if it doesn't exist
        fs::create_dir_all(&plugins_dir)
            .map_err(|e| PluginError::new("IO_ERROR", &format!("Failed to create plugins dir: {}", e)))?;
        
        let registry_path = plugins_dir.join("registry.json");
        
        // Load registry or create empty one
        let registry = if registry_path.exists() {
            let content = fs::read_to_string(&registry_path)
                .map_err(|e| PluginError::new("IO_ERROR", &format!("Failed to read registry: {}", e)))?;
            serde_json::from_str(&content)
                .map_err(|e| PluginError::invalid_manifest(&format!("Invalid registry: {}", e)))?
        } else {
            PluginRegistry::default()
        };
        
        let runtime = PluginRuntime::new()?;
        
        let manager = Self {
            runtime: Arc::new(Mutex::new(runtime)),
            registry: Mutex::new(registry),
            plugins_dir,
            registry_path,
        };
        
        // Load all enabled plugins
        manager.load_enabled_plugins()?;
        
        Ok(manager)
    }

    /// Load all enabled plugins from registry
    fn load_enabled_plugins(&self) -> Result<(), PluginError> {
        let registry = self.registry.lock().unwrap();
        let enabled_plugins: Vec<_> = registry.plugins
            .iter()
            .filter(|(_, entry)| entry.enabled)
            .map(|(id, _)| id.clone())
            .collect();
        drop(registry);
        
        for plugin_id in enabled_plugins {
            if let Err(e) = self.load_plugin_by_id(&plugin_id) {
                eprintln!("Failed to load plugin {}: {}", plugin_id, e);
            }
        }
        
        Ok(())
    }

    /// Load a specific plugin by ID
    fn load_plugin_by_id(&self, plugin_id: &str) -> Result<(), PluginError> {
        let plugin_dir = self.plugins_dir.join(plugin_id);
        let manifest_path = plugin_dir.join("manifest.json");
        
        if !manifest_path.exists() {
            return Err(PluginError::manifest_not_found());
        }
        
        let manifest_content = fs::read_to_string(&manifest_path)
            .map_err(|e| PluginError::new("IO_ERROR", &format!("Failed to read manifest: {}", e)))?;
        
        let manifest: PluginManifest = serde_json::from_str(&manifest_content)
            .map_err(|e| PluginError::invalid_manifest(&format!("Invalid manifest: {}", e)))?;
        
        // Load WASM if available
        if let Some(ref wasm_entry) = manifest.entrypoints.wasm {
            let wasm_path = plugin_dir.join(wasm_entry);
            if wasm_path.exists() {
                let mut runtime = self.runtime.lock().unwrap();
                runtime.load_plugin(manifest, &wasm_path)?;
            }
        }
        
        Ok(())
    }

    /// Save registry to disk
    fn save_registry(&self) -> Result<(), PluginError> {
        let registry = self.registry.lock().unwrap();
        let content = serde_json::to_string_pretty(&*registry)
            .map_err(|e| PluginError::new("SERIALIZE_ERROR", &format!("Failed to serialize registry: {}", e)))?;
        
        fs::write(&self.registry_path, content)
            .map_err(|e| PluginError::new("IO_ERROR", &format!("Failed to write registry: {}", e)))?;
        
        Ok(())
    }

    /// Install plugin from local zip file
    pub fn install_from_local(&self, zip_path: &Path) -> Result<PluginInfo, PluginError> {
        // Create temp directory for extraction
        let temp_dir = self.plugins_dir.join(".temp");
        if temp_dir.exists() {
            fs::remove_dir_all(&temp_dir)
                .map_err(|e| PluginError::new("IO_ERROR", &format!("Failed to clean temp dir: {}", e)))?;
        }
        fs::create_dir_all(&temp_dir)
            .map_err(|e| PluginError::new("IO_ERROR", &format!("Failed to create temp dir: {}", e)))?;
        
        // Extract zip
        let file = fs::File::open(zip_path)
            .map_err(|e| PluginError::new("IO_ERROR", &format!("Failed to open zip: {}", e)))?;
        
        let mut archive = ZipArchive::new(file)
            .map_err(|e| PluginError::new("ZIP_ERROR", &format!("Invalid zip file: {}", e)))?;
        
        archive.extract(&temp_dir)
            .map_err(|e| PluginError::new("ZIP_ERROR", &format!("Failed to extract: {}", e)))?;
        
        // Find manifest.json (might be in root or a subdirectory)
        let manifest_path = self.find_manifest(&temp_dir)?;
        let plugin_root = manifest_path.parent().unwrap().to_path_buf();
        
        // Parse manifest
        let manifest_content = fs::read_to_string(&manifest_path)
            .map_err(|e| PluginError::new("IO_ERROR", &format!("Failed to read manifest: {}", e)))?;
        
        let manifest: PluginManifest = serde_json::from_str(&manifest_content)
            .map_err(|e| PluginError::invalid_manifest(&format!("Invalid manifest: {}", e)))?;
        
        let plugin_id = manifest.id.clone();
        
        // Note: Allow reinstalling for updates - just proceed to overwrite
        
        // Move to final location
        let final_dir = self.plugins_dir.join(&plugin_id);
        if final_dir.exists() {
            fs::remove_dir_all(&final_dir)
                .map_err(|e| PluginError::new("IO_ERROR", &format!("Failed to remove old plugin: {}", e)))?;
        }
        
        // Copy plugin files
        self.copy_dir_recursive(&plugin_root, &final_dir)?;
        
        // Clean up temp
        let _ = fs::remove_dir_all(&temp_dir);
        
        // Add to registry
        let entry = PluginRegistryEntry {
            id: plugin_id.clone(),
            enabled: true,
            installed_at: chrono::Utc::now().to_rfc3339(),
            source: PluginSource::Local { path: zip_path.to_string_lossy().to_string() },
        };
        
        {
            let mut registry = self.registry.lock().unwrap();
            registry.plugins.insert(plugin_id.clone(), entry);
        }
        self.save_registry()?;
        
        // Load the plugin
        self.load_plugin_by_id(&plugin_id)?;
        
        Ok(PluginInfo {
            manifest,
            enabled: true,
            path: final_dir.to_string_lossy().to_string(),
            update_available: None,
        })
    }

    /// Install plugin from GitHub repository
    pub async fn install_from_github(&self, repo_url: &str) -> Result<PluginInfo, PluginError> {
        // Parse GitHub URL: https://github.com/owner/repo
        let (owner, repo) = self.parse_github_url(repo_url)?;
        
        // Get latest release
        let api_url = format!("https://api.github.com/repos/{}/{}/releases/latest", owner, repo);
        
        let client = reqwest::Client::builder()
            .user_agent("YYShell-Plugin-Manager")
            .build()
            .map_err(|e| PluginError::download_failed(&format!("Failed to create client: {}", e)))?;
        
        let response = client.get(&api_url)
            .send()
            .await
            .map_err(|e| PluginError::download_failed(&format!("Failed to fetch release: {}", e)))?;
        
        if !response.status().is_success() {
            return Err(PluginError::download_failed(&format!(
                "GitHub API returned status: {}", response.status()
            )));
        }
        
        let release: serde_json::Value = response.json()
            .await
            .map_err(|e| PluginError::download_failed(&format!("Failed to parse release: {}", e)))?;
        
        // Find plugin.zip or first .zip asset
        let assets = release["assets"].as_array()
            .ok_or_else(|| PluginError::download_failed("No assets in release"))?;
        
        let download_url = assets.iter()
            .find_map(|asset| {
                let name = asset["name"].as_str()?;
                if name.ends_with(".zip") {
                    asset["browser_download_url"].as_str().map(String::from)
                } else {
                    None
                }
            })
            .ok_or_else(|| PluginError::download_failed("No .zip file in release assets"))?;
        
        // Download the zip
        let response = client.get(&download_url)
            .send()
            .await
            .map_err(|e| PluginError::download_failed(&format!("Failed to download: {}", e)))?;
        
        let bytes = response.bytes()
            .await
            .map_err(|e| PluginError::download_failed(&format!("Failed to read download: {}", e)))?;
        
        // Save to temp file
        let temp_zip = self.plugins_dir.join(".download.zip");
        fs::write(&temp_zip, &bytes)
            .map_err(|e| PluginError::new("IO_ERROR", &format!("Failed to save download: {}", e)))?;
        
        // Install from local
        let result = self.install_from_local(&temp_zip);
        
        // Clean up
        let _ = fs::remove_file(&temp_zip);
        
        // Update source in registry to GitHub
        if let Ok(ref info) = result {
            let mut registry = self.registry.lock().unwrap();
            if let Some(entry) = registry.plugins.get_mut(&info.manifest.id) {
                let version = release["tag_name"].as_str().unwrap_or("unknown").to_string();
                entry.source = PluginSource::GitHub { 
                    repo: format!("{}/{}", owner, repo),
                    version,
                };
            }
        }
        self.save_registry()?;
        
        result
    }

    /// Uninstall a plugin
    pub fn uninstall(&self, plugin_id: &str) -> Result<(), PluginError> {
        // Unload from runtime
        {
            let mut runtime = self.runtime.lock().unwrap();
            let _ = runtime.unload_plugin(plugin_id);
        }
        
        // Remove from registry
        {
            let mut registry = self.registry.lock().unwrap();
            registry.plugins.remove(plugin_id);
        }
        self.save_registry()?;
        
        // Delete plugin directory
        let plugin_dir = self.plugins_dir.join(plugin_id);
        if plugin_dir.exists() {
            fs::remove_dir_all(&plugin_dir)
                .map_err(|e| PluginError::new("IO_ERROR", &format!("Failed to delete plugin: {}", e)))?;
        }
        
        Ok(())
    }

    /// Enable or disable a plugin
    pub fn set_enabled(&self, plugin_id: &str, enabled: bool) -> Result<(), PluginError> {
        {
            let mut registry = self.registry.lock().unwrap();
            let entry = registry.plugins.get_mut(plugin_id)
                .ok_or_else(|| PluginError::plugin_not_found(plugin_id))?;
            entry.enabled = enabled;
        }
        self.save_registry()?;
        
        if enabled {
            self.load_plugin_by_id(plugin_id)?;
        } else {
            let mut runtime = self.runtime.lock().unwrap();
            let _ = runtime.unload_plugin(plugin_id);
        }
        
        Ok(())
    }

    /// List all installed plugins
    pub fn list_plugins(&self) -> Result<Vec<PluginInfo>, PluginError> {
        let registry = self.registry.lock().unwrap();
        let mut plugins = Vec::new();
        
        for (id, entry) in &registry.plugins {
            let plugin_dir = self.plugins_dir.join(id);
            let manifest_path = plugin_dir.join("manifest.json");
            
            if let Ok(content) = fs::read_to_string(&manifest_path) {
                if let Ok(manifest) = serde_json::from_str::<PluginManifest>(&content) {
                    plugins.push(PluginInfo {
                        manifest,
                        enabled: entry.enabled,
                        path: plugin_dir.to_string_lossy().to_string(),
                        update_available: None,
                    });
                }
            }
        }
        
        Ok(plugins)
    }

    /// Check for updates for all GitHub-installed plugins
    pub async fn check_updates(&self) -> Vec<PluginUpdate> {
        // Collect GitHub plugins info synchronously, then drop the mutex guard
        let github_plugins: Vec<_> = {
            let registry = self.registry.lock().unwrap();
            registry.plugins.iter()
                .filter_map(|(id, entry)| {
                    if let PluginSource::GitHub { ref repo, ref version } = entry.source {
                        Some((id.clone(), repo.clone(), version.clone()))
                    } else {
                        None
                    }
                })
                .collect()
        }; // MutexGuard dropped here before any await
        
        let mut updates = Vec::new();
        let client = reqwest::Client::builder()
            .user_agent("YYShell-Plugin-Manager")
            .build()
            .ok();
        
        let Some(client) = client else { return updates };
        
        for (id, repo, current_version) in github_plugins {
            let api_url = format!("https://api.github.com/repos/{}/releases/latest", repo);
            
            if let Ok(response) = client.get(&api_url).send().await {
                if let Ok(release) = response.json::<serde_json::Value>().await {
                    if let Some(new_version) = release["tag_name"].as_str() {
                        if new_version != current_version {
                            updates.push(PluginUpdate {
                                id,
                                current_version,
                                new_version: new_version.to_string(),
                                release_notes: release["body"].as_str().map(String::from),
                            });
                        }
                    }
                }
            }
        }
        
        updates
    }

    /// Get the runtime for plugin calls
    pub fn get_runtime(&self) -> Arc<Mutex<PluginRuntime>> {
        self.runtime.clone()
    }

    // Helper: Find manifest.json in directory
    fn find_manifest(&self, dir: &Path) -> Result<PathBuf, PluginError> {
        // Check root first
        let root_manifest = dir.join("manifest.json");
        if root_manifest.exists() {
            return Ok(root_manifest);
        }
        
        // Check first-level subdirectories
        if let Ok(entries) = fs::read_dir(dir) {
            for entry in entries.flatten() {
                if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                    let subdir_manifest = entry.path().join("manifest.json");
                    if subdir_manifest.exists() {
                        return Ok(subdir_manifest);
                    }
                }
            }
        }
        
        Err(PluginError::manifest_not_found())
    }

    // Helper: Parse GitHub URL
    fn parse_github_url(&self, url: &str) -> Result<(String, String), PluginError> {
        // Remove trailing / and .git suffix
        let url = url.trim_end_matches('/').trim_end_matches(".git");
        let parts: Vec<&str> = url.split('/').collect();
        
        // Handle formats like github.com/owner/repo or https://github.com/owner/repo
        if parts.len() >= 2 {
            let len = parts.len();
            return Ok((parts[len - 2].to_string(), parts[len - 1].to_string()));
        }
        
        Err(PluginError::new("INVALID_URL", "Invalid GitHub URL format"))
    }

    // Helper: Recursively copy directory
    fn copy_dir_recursive(&self, src: &Path, dst: &Path) -> Result<(), PluginError> {
        fs::create_dir_all(dst)
            .map_err(|e| PluginError::new("IO_ERROR", &format!("Failed to create dir: {}", e)))?;
        
        for entry in fs::read_dir(src)
            .map_err(|e| PluginError::new("IO_ERROR", &format!("Failed to read dir: {}", e)))? 
        {
            let entry = entry
                .map_err(|e| PluginError::new("IO_ERROR", &format!("Failed to read entry: {}", e)))?;
            let src_path = entry.path();
            let dst_path = dst.join(entry.file_name());
            
            if src_path.is_dir() {
                self.copy_dir_recursive(&src_path, &dst_path)?;
            } else {
                fs::copy(&src_path, &dst_path)
                    .map_err(|e| PluginError::new("IO_ERROR", &format!("Failed to copy file: {}", e)))?;
            }
        }
        
        Ok(())
    }
}

impl Default for PluginManager {
    fn default() -> Self {
        Self::new().expect("Failed to create plugin manager")
    }
}
