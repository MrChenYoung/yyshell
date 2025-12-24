// Plugin window management commands

use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

/// Server info for auto-connect feature
/// NOTE: password is NOT included for security - backend fetches from keychain
#[derive(serde::Deserialize)]
pub struct AutoConnectServer {
    pub id: String,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    // password intentionally NOT passed - fetched from keychain by connect command
    pub auth_type: Option<String>,
    pub private_key_path: Option<String>,
}

/// Open a plugin window
#[tauri::command]
pub async fn open_plugin_window(
    app: AppHandle,
    plugin_id: String,
    title: String,
    theme: Option<String>,
    auto_connect_server: Option<AutoConnectServer>,
) -> Result<(), String> {
    // If auto_connect_server is provided, create a unique window for this server
    // Otherwise, reuse existing window
    let window_label = if auto_connect_server.is_some() {
        format!("plugin-{}-{}", plugin_id, std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis())
    } else {
        format!("plugin-{}", plugin_id)
    };
    
    // Check if window already exists (only for non-auto-connect case)
    if auto_connect_server.is_none() {
        if let Some(window) = app.get_webview_window(&window_label) {
            // Focus the existing window
            window.set_focus().map_err(|e| e.to_string())?;
            return Ok(());
        }
    }
    
    // Create the plugin window URL with plugin_id and theme as query parameters
    let theme_str = theme.unwrap_or_else(|| "dark".to_string());
    let mut url = format!("/plugin-window.html?plugin={}&theme={}", plugin_id, theme_str);
    
    // Add auto_connect_server as Base64-encoded JSON query parameter if provided
    if let Some(server) = auto_connect_server {
        // NOTE: password is NOT included in URL for security
        let server_json = serde_json::json!({
            "id": server.id,
            "name": server.name,
            "host": server.host,
            "port": server.port,
            "username": server.username,
            // password NOT passed to plugin - fetched from keychain by connect
            "auth_type": server.auth_type,
            "private_key_path": server.private_key_path,
        });
        // Convert to JSON string and encode as Base64 (handles all special characters safely)
        let json_string = server_json.to_string();
        use base64::Engine;
        let encoded = base64::engine::general_purpose::STANDARD.encode(json_string.as_bytes());
        url = format!("{}&autoConnectServer={}", url, encoded);
    }
    
    // Create new window
    let _window = WebviewWindowBuilder::new(
        &app,
        &window_label,
        WebviewUrl::App(url.into()),
    )
    .title(title)
    .inner_size(1600.0, 900.0)
    .min_inner_size(900.0, 600.0)
    .resizable(true)
    .center()
    .build()
    .map_err(|e| format!("Failed to create plugin window: {}", e))?;
    
    Ok(())
}

