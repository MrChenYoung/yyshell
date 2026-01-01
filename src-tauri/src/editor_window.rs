// Editor window management commands

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

/// Payload for open-file event
#[derive(Clone, Serialize)]
pub struct OpenFilePayload {
    pub connection_id: String,
    pub file_path: String,
    pub file_name: String,
}

/// Open a file editor in a new window or add tab to existing window
#[tauri::command]
pub async fn open_editor_window(
    app: AppHandle,
    connection_id: String,
    file_path: String,
    file_name: String,
    theme: Option<String>,
) -> Result<(), String> {
    let window_label = "editor-main";
    let theme_str = theme.unwrap_or_else(|| "dark".to_string());

    // Check if editor window already exists
    if let Some(window) = app.get_webview_window(window_label) {
        // Window exists - focus it and emit event to add new tab
        window.set_focus().map_err(|e| e.to_string())?;
        
        let payload = OpenFilePayload {
            connection_id,
            file_path,
            file_name,
        };
        
        window.emit("open-file", payload).map_err(|e| e.to_string())?;
    } else {
        // Window doesn't exist - create new window with initial file
        let encoded_path = urlencoding::encode(&file_path);
        let encoded_name = urlencoding::encode(&file_name);
        let url = format!(
            "/editor-window.html?connectionId={}&filePath={}&fileName={}&theme={}",
            connection_id, encoded_path, encoded_name, theme_str
        );

        let _window = WebviewWindowBuilder::new(&app, window_label, WebviewUrl::App(url.into()))
            .title("编辑器 - YYShell")
            .inner_size(1200.0, 800.0)
            .min_inner_size(800.0, 600.0)
            .resizable(true)
            .center()
            .build()
            .map_err(|e| format!("Failed to create editor window: {}", e))?;
    }

    Ok(())
}
