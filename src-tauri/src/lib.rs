mod ssh;
mod ssh_russh;  // New russh-based SSH implementation
mod sftp;
mod storage;
mod commands;
mod keychain;
mod port_forward;
mod logging;

// Plugin system modules
mod plugin_types;
mod plugin_runtime;
mod plugin_manager;
mod plugin_commands;
mod plugin_window;

use log::info;

/// Get log directory path
#[tauri::command]
fn get_log_directory() -> String {
    logging::get_log_dir().to_string_lossy().to_string()
}

/// List all log files
#[tauri::command]
fn list_log_files() -> Vec<String> {
    logging::list_log_files()
        .into_iter()
        .map(|p| p.to_string_lossy().to_string())
        .collect()
}

/// Read log file content
#[tauri::command]
fn read_log_file(path: String) -> Result<String, String> {
    let path = std::path::PathBuf::from(path);
    logging::read_log_file(&path).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Initialize logging system
    if let Err(e) = logging::init_logging() {
        eprintln!("Failed to initialize logging: {}", e);
    }
    
    // Cleanup old logs (keep last 7 days)
    logging::cleanup_old_logs(7);
    
    info!("Initializing Tauri application");
    
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(ssh::AppState::default())
        .manage(ssh_russh::RusshAppState::default())  // russh state
        .manage(sftp::SftpState::default())
        .manage(port_forward::PortForwardState::default())
        .manage(plugin_commands::PluginState::default())
        .invoke_handler(tauri::generate_handler![
            // ssh2 commands (only monitoring and exec are still needed)
            ssh::start_monitoring, ssh::ssh_exec_command,
            // russh commands (new implementation)
            ssh_russh::russh_connect, ssh_russh::russh_disconnect, ssh_russh::russh_write_pty, ssh_russh::russh_resize_pty,
            sftp::init_sftp, sftp::sftp_list_dir, sftp::sftp_mkdir, sftp::sftp_create_file,
            sftp::sftp_upload_file, sftp::sftp_copy_file, sftp::sftp_remove_file, sftp::sftp_cancel_upload,
            sftp::sftp_download_file, sftp::sftp_rename, sftp::sftp_rmdir, sftp::sftp_cancel_download, sftp::sftp_download_folder,
            sftp::sftp_read_file, sftp::sftp_write_file, sftp::sftp_read_file_base64, sftp::sftp_open_with_system,
            storage::load_servers, storage::save_servers, storage::add_server,
            storage::update_server, storage::delete_server, storage::test_connection,
            storage::load_settings, storage::save_settings,
            storage::load_groups, storage::save_groups,
            storage::load_tabs, storage::save_tabs,
            commands::load_command_history, commands::add_command_history, commands::clear_command_history,
            commands::load_quick_commands, commands::save_quick_commands,
            commands::add_quick_command, commands::update_quick_command, commands::delete_quick_command,
            commands::load_tunnel_presets, commands::save_tunnel_presets,
            commands::add_tunnel_preset, commands::update_tunnel_preset, commands::delete_tunnel_preset,
            commands::load_tunnel_category_order, commands::save_tunnel_category_order,
            commands::rename_tunnel_category, commands::delete_tunnel_category,
            // Script commands
            commands::load_scripts, commands::add_script, commands::update_script, commands::delete_script, commands::save_scripts_batch,
            port_forward::start_port_forward, port_forward::stop_port_forward, port_forward::list_port_forwards,
            // Plugin commands
            plugin_commands::list_plugins, plugin_commands::install_plugin_local,
            plugin_commands::install_plugin_github, plugin_commands::uninstall_plugin,
            plugin_commands::set_plugin_enabled, plugin_commands::check_plugin_updates,
            plugin_commands::call_plugin_method, plugin_commands::get_plugin_contributions,
            plugin_commands::fetch_marketplace, plugin_commands::install_from_marketplace,
            plugin_commands::load_plugin_bundle, plugin_commands::get_plugin_icon,
            // Plugin window
            plugin_window::open_plugin_window,
            // Logging commands
            get_log_directory, list_log_files, read_log_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}


