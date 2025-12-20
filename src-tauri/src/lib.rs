// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

mod ssh;
mod sftp;
mod storage;
mod commands;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(ssh::AppState::default())
        .manage(sftp::SftpState::default())
        .invoke_handler(tauri::generate_handler![
            greet, 
            ssh::connect, ssh::disconnect, ssh::write_pty, ssh::resize_pty, ssh::start_monitoring, ssh::ssh_exec_command,
            sftp::init_sftp, sftp::sftp_list_dir, sftp::sftp_mkdir, sftp::sftp_create_file,
            sftp::sftp_upload_file, sftp::sftp_copy_file, sftp::sftp_remove_file, sftp::sftp_cancel_upload,
            sftp::sftp_download_file, sftp::sftp_rename, sftp::sftp_rmdir, sftp::sftp_cancel_download, sftp::sftp_download_folder,
            sftp::sftp_read_file, sftp::sftp_write_file, sftp::sftp_read_file_base64, sftp::sftp_open_with_system,
            storage::load_servers, storage::save_servers, storage::add_server,
            storage::update_server, storage::delete_server, storage::test_connection,
            storage::load_settings, storage::save_settings,
            storage::load_groups, storage::save_groups,
            commands::load_command_history, commands::add_command_history, commands::clear_command_history,
            commands::load_quick_commands, commands::save_quick_commands,
            commands::add_quick_command, commands::update_quick_command, commands::delete_quick_command
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

