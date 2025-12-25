mod ssh;
mod sftp;
mod storage;
mod commands;
mod keychain;
mod port_forward;

// Plugin system modules
mod plugin_types;
mod plugin_runtime;
mod plugin_manager;
mod plugin_commands;
mod plugin_window;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(ssh::AppState::default())
        .manage(sftp::SftpState::default())
        .manage(port_forward::PortForwardState::default())
        .manage(plugin_commands::PluginState::default())
        .invoke_handler(tauri::generate_handler![
            ssh::connect, ssh::disconnect, ssh::write_pty, ssh::resize_pty, ssh::start_monitoring, ssh::ssh_exec_command,
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
            plugin_commands::load_plugin_bundle,
            // Plugin window
            plugin_window::open_plugin_window
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

