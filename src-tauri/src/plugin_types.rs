// Plugin system type definitions

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Plugin manifest (manifest.json)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginManifest {
    /// Unique plugin identifier
    pub id: String,
    /// Human-readable name
    pub name: String,
    /// Semantic version
    pub version: String,
    /// Description
    pub description: String,
    /// Author name
    pub author: String,
    /// License (e.g., "MIT")
    #[serde(default)]
    pub license: String,
    /// Icon path relative to plugin root (e.g., "icon.png")
    #[serde(default)]
    pub icon: Option<String>,
    /// GitHub repository URL
    #[serde(default)]
    pub repository: Option<String>,
    /// Engine requirements
    #[serde(default)]
    pub engines: EngineRequirements,
    /// Entry points for plugin code
    #[serde(default)]
    pub entrypoints: PluginEntrypoints,
    /// UI contributions
    #[serde(default)]
    pub contributes: PluginContributions,
    /// Required permissions
    #[serde(default)]
    pub permissions: Vec<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct EngineRequirements {
    /// Minimum YYShell version required
    #[serde(default)]
    pub yyshell: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct PluginEntrypoints {
    /// Path to WASM file relative to plugin root
    #[serde(default)]
    pub wasm: Option<String>,
    /// Path to frontend entry file relative to plugin root
    #[serde(default)]
    pub frontend: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct PluginContributions {
    /// Panels contributed by this plugin
    #[serde(default)]
    pub panels: Vec<PanelContribution>,
    /// Commands contributed by this plugin
    #[serde(default)]
    pub commands: Vec<CommandContribution>,
    /// Settings contributed by this plugin
    #[serde(default)]
    pub settings: Vec<SettingContribution>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PanelContribution {
    /// Panel unique ID
    pub id: String,
    /// Panel title
    pub title: String,
    /// Icon name (lucide icon)
    #[serde(default)]
    pub icon: Option<String>,
    /// Panel location: "bottom", "sidebar", "tab"
    #[serde(default = "default_panel_location")]
    pub location: String,
}

fn default_panel_location() -> String {
    "bottom".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommandContribution {
    /// Command unique ID
    pub id: String,
    /// Command title
    pub title: String,
    /// Keyboard shortcut
    #[serde(default)]
    pub keybinding: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SettingContribution {
    /// Setting key
    pub key: String,
    /// Setting title
    pub title: String,
    /// Setting type: "string", "boolean", "number", "select"
    #[serde(rename = "type")]
    pub setting_type: String,
    /// Default value
    #[serde(default)]
    pub default: Option<serde_json::Value>,
    /// Options for "select" type
    #[serde(default)]
    pub options: Option<Vec<SelectOption>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SelectOption {
    pub value: String,
    pub label: String,
}

/// Plugin info returned to frontend
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginInfo {
    /// Plugin manifest
    #[serde(flatten)]
    pub manifest: PluginManifest,
    /// Whether the plugin is enabled
    pub enabled: bool,
    /// Plugin installation path
    pub path: String,
    /// Whether an update is available
    #[serde(default)]
    pub update_available: Option<String>,
}

/// Plugin update info
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginUpdate {
    /// Plugin ID
    pub id: String,
    /// Current version
    pub current_version: String,
    /// New version available
    pub new_version: String,
    /// Release notes
    #[serde(default)]
    pub release_notes: Option<String>,
}

/// Plugin registry entry (stored in plugins.json)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginRegistryEntry {
    pub id: String,
    pub enabled: bool,
    pub installed_at: String,
    pub source: PluginSource,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum PluginSource {
    #[serde(rename = "local")]
    Local { path: String },
    #[serde(rename = "github")]
    GitHub { repo: String, version: String },
}

/// Plugin registry (plugins.json)
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct PluginRegistry {
    pub plugins: HashMap<String, PluginRegistryEntry>,
}

/// Error types for plugin operations
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginError {
    pub code: String,
    pub message: String,
}

impl PluginError {
    pub fn new(code: &str, message: &str) -> Self {
        Self {
            code: code.to_string(),
            message: message.to_string(),
        }
    }

    pub fn manifest_not_found() -> Self {
        Self::new("MANIFEST_NOT_FOUND", "manifest.json not found in plugin package")
    }

    pub fn invalid_manifest(msg: &str) -> Self {
        Self::new("INVALID_MANIFEST", msg)
    }

    pub fn plugin_not_found(id: &str) -> Self {
        Self::new("PLUGIN_NOT_FOUND", &format!("Plugin '{}' not found", id))
    }

    pub fn already_installed(id: &str) -> Self {
        Self::new("ALREADY_INSTALLED", &format!("Plugin '{}' is already installed", id))
    }

    pub fn download_failed(msg: &str) -> Self {
        Self::new("DOWNLOAD_FAILED", msg)
    }

    pub fn wasm_load_failed(msg: &str) -> Self {
        Self::new("WASM_LOAD_FAILED", msg)
    }
}

impl std::fmt::Display for PluginError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "[{}] {}", self.code, self.message)
    }
}

impl std::error::Error for PluginError {}

// ============ Marketplace Types ============

/// Remote marketplace registry (fetched from server)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MarketplaceRegistry {
    /// Registry version
    pub version: i32,
    /// Available plugins
    pub plugins: Vec<MarketplacePlugin>,
}

/// Plugin entry in marketplace
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MarketplacePlugin {
    /// Unique plugin ID
    pub id: String,
    /// Plugin name
    pub name: String,
    /// Description
    pub description: String,
    /// Author
    pub author: String,
    /// Latest version
    pub version: String,
    /// Icon URL or icon name
    #[serde(default)]
    pub icon: Option<String>,
    /// Tags (e.g., "official", "tools", "monitoring")
    #[serde(default)]
    pub tags: Vec<String>,
    /// GitHub repository URL
    pub repository: String,
    /// Direct download URL for latest version
    pub download_url: String,
    /// Screenshot URLs
    #[serde(default)]
    pub screenshots: Vec<String>,
    /// Changelog/release notes
    #[serde(default)]
    pub changelog: Option<String>,
    /// Download count
    #[serde(default)]
    pub downloads: i64,
}
