use std::collections::HashMap;
use std::net::TcpStream;
use std::sync::{Arc, Mutex};
use std::sync::atomic::{AtomicBool, Ordering};
use std::path::Path;
use ssh2::{Session, Sftp};
use tauri::{AppHandle, Emitter};

pub struct SftpConnection {
    pub _session: Session,
    pub sftp: Sftp,
}

// Make SftpConnection Send + Sync safe
unsafe impl Send for SftpConnection {}
unsafe impl Sync for SftpConnection {}

pub struct SftpState {
    pub connections: Mutex<HashMap<String, Arc<Mutex<SftpConnection>>>>,
    /// Cancel flags for each connection's upload operation
    pub upload_cancelled: Mutex<HashMap<String, Arc<AtomicBool>>>,
    /// Cancel flags for each connection's download operation
    pub download_cancelled: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

impl Default for SftpState {
    fn default() -> Self {
        Self {
            connections: Mutex::new(HashMap::new()),
            upload_cancelled: Mutex::new(HashMap::new()),
            download_cancelled: Mutex::new(HashMap::new()),
        }
    }
}

#[derive(serde::Serialize, Clone)]
pub struct FileEntry {
    pub name: String,
    pub is_dir: bool,
    pub size: u64,
    pub mtime: u64,
    pub perm: u32,  // File permissions (e.g., 0o755)
}

/// Upload progress event payload
#[derive(Clone, serde::Serialize)]
pub struct UploadProgressPayload {
    pub id: String,           // Connection ID
    pub file_name: String,    // File being uploaded
    pub uploaded: u64,        // Bytes uploaded so far
    pub total: u64,           // Total file size
    pub percent: f32,         // Progress percentage 0-100
}

/// Download progress event payload
#[derive(Clone, serde::Serialize)]
pub struct DownloadProgressPayload {
    pub id: String,           // Connection ID
    pub file_name: String,    // File being downloaded
    pub downloaded: u64,      // Bytes downloaded so far
    pub total: u64,           // Total file size
    pub percent: f32,         // Progress percentage 0-100
}

#[tauri::command]
pub async fn init_sftp(
    state: tauri::State<'_, super::ssh::AppState>,
    russh_state: tauri::State<'_, super::ssh_russh::RusshAppState>,
    sftp_state: tauri::State<'_, SftpState>,
    id: String,
) -> Result<(), String> {
    // 1. Get credentials - try russh state first, then fallback to ssh2 state
    log::info!("[SFTP:{}] Looking up credentials", id);
    let creds = {
        // First try russh credentials (new implementation)
        let russh_creds = russh_state.credentials.lock().unwrap();
        let russh_keys: Vec<_> = russh_creds.keys().collect();
        log::debug!("[SFTP:{}] Russh credential keys: {:?}", id, russh_keys);
        
        if let Some(c) = russh_creds.get(&id) {
            log::info!("[SFTP:{}] Found credentials in russh state", id);
            super::ssh::StoredCredentials {
                host: c.host.clone(),
                port: c.port,
                username: c.username.clone(),
                password: c.password.clone(),
                auth_type: c.auth_type.clone(),
                private_key_path: c.private_key_path.clone(),
            }
        } else {
            // Fallback to ssh2 credentials (legacy)
            log::debug!("[SFTP:{}] Not found in russh, trying ssh2", id);
            let ssh_creds = state.credentials.lock().unwrap();
            let ssh_keys: Vec<_> = ssh_creds.keys().collect();
            log::debug!("[SFTP:{}] ssh2 credential keys: {:?}", id, ssh_keys);
            
            match ssh_creds.get(&id) {
                Some(c) => {
                    log::info!("[SFTP:{}] Found credentials in ssh2 state", id);
                    c.clone()
                },
                None => {
                    log::error!("[SFTP:{}] No credentials found in either state", id);
                    return Err("No credentials found for this connection".into());
                }
            }
        }
    };

    // Run blocking SFTP connection in background thread
    let sftp_conn = tokio::task::spawn_blocking(move || -> Result<SftpConnection, String> {
        // Connect
        let tcp = TcpStream::connect(format!("{}:{}", creds.host, creds.port)).map_err(|e| e.to_string())?;
        let mut sess = Session::new().unwrap();
        sess.set_tcp_stream(tcp);
        sess.handshake().map_err(|e| e.to_string())?;

        // Auth based on type
        match creds.auth_type.as_str() {
            "Key" => {
                let key_path = creds.private_key_path.as_ref().ok_or("Private key path not provided")?;
                let path = std::path::Path::new(key_path);
                sess.userauth_pubkey_file(&creds.username, None, path, creds.password.as_deref())
                    .map_err(|e| format!("Key authentication failed: {}", e))?;
            },
            "Agent" => {
                sess.userauth_agent(&creds.username)
                    .map_err(|e| format!("SSH Agent authentication failed: {}", e))?;
            },
            _ => {
                let pwd = creds.password.as_ref().ok_or("Password not provided")?;
                sess.userauth_password(&creds.username, pwd)
                    .map_err(|e| format!("Password authentication failed: {}", e))?;
            }
        }
        
        if !sess.authenticated() {
            return Err("SFTP Auth failed".into());
        }

        // Init SFTP
        let sftp = sess.sftp().map_err(|e| e.to_string())?;

        Ok(SftpConnection { _session: sess, sftp })
    }).await.map_err(|e| e.to_string())??;
    
    sftp_state.connections.lock().unwrap().insert(id.clone(), Arc::new(Mutex::new(sftp_conn)));
    // Initialize cancel flags for this connection
    sftp_state.upload_cancelled.lock().unwrap().insert(id.clone(), Arc::new(AtomicBool::new(false)));
    sftp_state.download_cancelled.lock().unwrap().insert(id, Arc::new(AtomicBool::new(false)));
    
    Ok(())
}

#[tauri::command]
pub async fn sftp_list_dir(
    sftp_state: tauri::State<'_, SftpState>,
    id: String,
    path: String,
) -> Result<Vec<FileEntry>, String> {
    // Get connection Arc
    let conn_arc = {
        let connections = sftp_state.connections.lock().unwrap();
        match connections.get(&id) {
            Some(c) => c.clone(),
            None => return Err("SFTP not connected".into()),
        }
    };

    // Run blocking directory listing in background thread
    let entries = tokio::task::spawn_blocking(move || -> Result<Vec<FileEntry>, String> {
        let conn = conn_arc.lock().unwrap();
        let path = Path::new(&path);
        
        let mut entries = Vec::new();
        match conn.sftp.readdir(path) {
            Ok(list) => {
                for (path_buf, stat) in list {
                    let name = path_buf.file_name().unwrap_or_default().to_string_lossy().to_string();
                    if name == "." || name == ".." { continue; }
                    
                    entries.push(FileEntry {
                        name,
                        is_dir: stat.is_dir(),
                        size: stat.size.unwrap_or(0),
                        mtime: stat.mtime.unwrap_or(0),
                        perm: stat.perm.unwrap_or(0),
                    });
                }
            },
            Err(e) => return Err(e.to_string()),
        }
        
        // Sort: directories first, then files
        entries.sort_by(|a, b| {
            if a.is_dir == b.is_dir {
                a.name.cmp(&b.name)
            } else {
                b.is_dir.cmp(&a.is_dir)
            }
        });
        
        Ok(entries)
    }).await.map_err(|e| e.to_string())??;

    Ok(entries)
}

#[tauri::command]
pub async fn sftp_mkdir(
    sftp_state: tauri::State<'_, SftpState>,
    id: String,
    path: String,
) -> Result<(), String> {
    let conn_arc = {
        let connections = sftp_state.connections.lock().unwrap();
        match connections.get(&id) {
            Some(c) => c.clone(),
            None => return Err("SFTP not connected".into()),
        }
    };

    tokio::task::spawn_blocking(move || -> Result<(), String> {
        let conn = conn_arc.lock().unwrap();
        let path = Path::new(&path);
        conn.sftp.mkdir(path, 0o755).map_err(|e| e.to_string())
    }).await.map_err(|e| e.to_string())??;

    Ok(())
}

#[tauri::command]
pub async fn sftp_create_file(
    sftp_state: tauri::State<'_, SftpState>,
    id: String,
    path: String,
) -> Result<(), String> {
    let conn_arc = {
        let connections = sftp_state.connections.lock().unwrap();
        match connections.get(&id) {
            Some(c) => c.clone(),
            None => return Err("SFTP not connected".into()),
        }
    };

    tokio::task::spawn_blocking(move || -> Result<(), String> {
        let conn = conn_arc.lock().unwrap();
        let path = Path::new(&path);
        // Create empty file with standard permissions
        conn.sftp.create(path).map_err(|e| e.to_string())?;
        Ok(())
    }).await.map_err(|e| e.to_string())??;

    Ok(())
}

/// Cancel ongoing upload for a connection
#[tauri::command]
pub async fn sftp_cancel_upload(
    sftp_state: tauri::State<'_, SftpState>,
    id: String,
) -> Result<(), String> {
    let cancelled = sftp_state.upload_cancelled.lock().unwrap();
    if let Some(flag) = cancelled.get(&id) {
        flag.store(true, Ordering::SeqCst);
    }
    Ok(())
}

/// Upload file with progress reporting
/// Emits "sftp-upload-progress" events with UploadProgressPayload
/// Can be cancelled via sftp_cancel_upload command
#[tauri::command]
pub async fn sftp_upload_file(
    app: AppHandle,
    sftp_state: tauri::State<'_, SftpState>,
    id: String,
    local_path: String,
    remote_path: String,
) -> Result<(), String> {
    let conn_arc = {
        let connections = sftp_state.connections.lock().unwrap();
        match connections.get(&id) {
            Some(c) => c.clone(),
            None => return Err("SFTP not connected".into()),
        }
    };

    // Get cancel flag for this connection
    let cancel_flag = {
        let cancelled = sftp_state.upload_cancelled.lock().unwrap();
        cancelled.get(&id).cloned()
    };
    
    // Reset cancel flag before starting
    if let Some(ref flag) = cancel_flag {
        flag.store(false, Ordering::SeqCst);
    }

    // Read local file content first
    let file_content = std::fs::read(&local_path).map_err(|e| format!("Failed to read local file: {}", e))?;
    let total_size = file_content.len() as u64;
    
    // Extract file name for progress reporting
    let file_name = Path::new(&local_path)
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();

    // Clone values for the blocking task
    let id_clone = id.clone();
    let file_name_clone = file_name.clone();
    let remote_path_clone = remote_path.clone();

    let result = tokio::task::spawn_blocking(move || -> Result<(), String> {
        use std::io::Write;
        let conn = conn_arc.lock().unwrap();
        let path = Path::new(&remote_path_clone);
        let mut remote_file = conn.sftp.create(path).map_err(|e| e.to_string())?;
        
        // Chunk size: 64KB for progress updates
        const CHUNK_SIZE: usize = 64 * 1024;
        let mut uploaded: u64 = 0;
        
        for chunk in file_content.chunks(CHUNK_SIZE) {
            // Check if upload was cancelled
            if let Some(ref flag) = cancel_flag {
                if flag.load(Ordering::SeqCst) {
                    // Delete partial file on cancel
                    drop(remote_file);
                    let _ = conn.sftp.unlink(path);
                    return Err("Upload cancelled".into());
                }
            }
            
            remote_file.write_all(chunk).map_err(|e| e.to_string())?;
            uploaded += chunk.len() as u64;
            
            // Calculate progress percentage
            let percent = if total_size > 0 {
                (uploaded as f32 / total_size as f32) * 100.0
            } else {
                100.0
            };
            
            // Emit progress event
            let payload = UploadProgressPayload {
                id: id_clone.clone(),
                file_name: file_name_clone.clone(),
                uploaded,
                total: total_size,
                percent,
            };
            
            let _ = app.emit("sftp-upload-progress", payload);
        }
        
        Ok(())
    }).await.map_err(|e| e.to_string())?;

    result
}

#[tauri::command]
pub async fn sftp_copy_file(
    sftp_state: tauri::State<'_, SftpState>,
    id: String,
    source_path: String,
    dest_path: String,
) -> Result<(), String> {
    let conn_arc = {
        let connections = sftp_state.connections.lock().unwrap();
        match connections.get(&id) {
            Some(c) => c.clone(),
            None => return Err("SFTP not connected".into()),
        }
    };

    tokio::task::spawn_blocking(move || -> Result<(), String> {
        use std::io::{Read, Write};
        let conn = conn_arc.lock().unwrap();
        
        // Read source file
        let source = Path::new(&source_path);
        let mut src_file = conn.sftp.open(source).map_err(|e| e.to_string())?;
        let mut content = Vec::new();
        src_file.read_to_end(&mut content).map_err(|e| e.to_string())?;
        
        // Write to destination
        let dest = Path::new(&dest_path);
        let mut dest_file = conn.sftp.create(dest).map_err(|e| e.to_string())?;
        dest_file.write_all(&content).map_err(|e| e.to_string())?;
        
        Ok(())
    }).await.map_err(|e| e.to_string())??;

    Ok(())
}

#[tauri::command]
pub async fn sftp_remove_file(
    sftp_state: tauri::State<'_, SftpState>,
    id: String,
    path: String,
) -> Result<(), String> {
    let conn_arc = {
        let connections = sftp_state.connections.lock().unwrap();
        match connections.get(&id) {
            Some(c) => c.clone(),
            None => return Err("SFTP not connected".into()),
        }
    };

    tokio::task::spawn_blocking(move || -> Result<(), String> {
        let conn = conn_arc.lock().unwrap();
        let path = Path::new(&path);
        conn.sftp.unlink(path).map_err(|e| e.to_string())
    }).await.map_err(|e| e.to_string())??;

    Ok(())
}

/// Download file from remote to local path with progress
/// Emits "sftp-download-progress" events with DownloadProgressPayload
#[tauri::command]
pub async fn sftp_download_file(
    app: AppHandle,
    sftp_state: tauri::State<'_, SftpState>,
    id: String,
    remote_path: String,
    local_path: String,
) -> Result<(), String> {
    let conn_arc = {
        let connections = sftp_state.connections.lock().unwrap();
        match connections.get(&id) {
            Some(c) => c.clone(),
            None => return Err("SFTP not connected".into()),
        }
    };

    // Get cancel flag for this connection
    let cancel_flag = {
        let flags = sftp_state.download_cancelled.lock().unwrap();
        flags.get(&id).cloned()
    };

    // Reset cancel flag at start of download
    if let Some(ref flag) = cancel_flag {
        flag.store(false, Ordering::SeqCst);
    }

    // Extract file name for progress reporting
    let file_name = Path::new(&remote_path)
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();

    let id_clone = id.clone();
    let file_name_clone = file_name.clone();
    let local_path_clone = local_path.clone();

    let result = tokio::task::spawn_blocking(move || -> Result<(), String> {
        use std::io::{Read, Write};
        let conn = conn_arc.lock().unwrap();
        let path = Path::new(&remote_path);
        
        // Get file size first
        let stat = conn.sftp.stat(path).map_err(|e| e.to_string())?;
        let total_size = stat.size.unwrap_or(0);
        
        let mut file = conn.sftp.open(path).map_err(|e| e.to_string())?;
        
        // Create local file
        let mut local_file = std::fs::File::create(&local_path_clone)
            .map_err(|e| format!("Failed to create local file: {}", e))?;
        
        // Chunk size: 64KB for progress updates
        const CHUNK_SIZE: usize = 64 * 1024;
        let mut buffer = vec![0u8; CHUNK_SIZE];
        let mut downloaded: u64 = 0;
        
        loop {
            // Check for cancellation before reading
            if let Some(ref flag) = cancel_flag {
                if flag.load(Ordering::SeqCst) {
                    // Clean up partial file
                    drop(local_file);
                    let _ = std::fs::remove_file(&local_path_clone);
                    return Err("Download cancelled".into());
                }
            }

            let bytes_read = file.read(&mut buffer).map_err(|e| e.to_string())?;
            if bytes_read == 0 {
                break;
            }
            
            local_file.write_all(&buffer[..bytes_read]).map_err(|e| e.to_string())?;
            downloaded += bytes_read as u64;
            
            // Calculate progress percentage
            let percent = if total_size > 0 {
                (downloaded as f32 / total_size as f32) * 100.0
            } else {
                100.0
            };
            
            // Emit progress event
            let payload = DownloadProgressPayload {
                id: id_clone.clone(),
                file_name: file_name_clone.clone(),
                downloaded,
                total: total_size,
                percent,
            };
            
            let _ = app.emit("sftp-download-progress", payload);
        }
        
        Ok(())
    }).await.map_err(|e| e.to_string())?;

    result
}

/// Cancel an ongoing download
#[tauri::command]
pub fn sftp_cancel_download(
    sftp_state: tauri::State<'_, SftpState>,
    id: String,
) -> Result<(), String> {
    let flags = sftp_state.download_cancelled.lock().unwrap();
    if let Some(flag) = flags.get(&id) {
        flag.store(true, Ordering::SeqCst);
    }
    Ok(())
}

/// Download a folder recursively from remote to local
/// Emits "sftp-download-progress" events with current file progress
#[tauri::command]
pub async fn sftp_download_folder(
    app: AppHandle,
    sftp_state: tauri::State<'_, SftpState>,
    id: String,
    remote_path: String,
    local_path: String,
) -> Result<(), String> {
    let conn_arc = {
        let connections = sftp_state.connections.lock().unwrap();
        match connections.get(&id) {
            Some(c) => c.clone(),
            None => return Err("SFTP not connected".into()),
        }
    };

    // Get cancel flag
    let cancel_flag = {
        let flags = sftp_state.download_cancelled.lock().unwrap();
        flags.get(&id).cloned()
    };

    // Reset cancel flag
    if let Some(ref flag) = cancel_flag {
        flag.store(false, Ordering::SeqCst);
    }

    let id_clone = id.clone();

    let result = tokio::task::spawn_blocking(move || -> Result<(), String> {
        use std::io::{Read, Write};
        
        // Create local folder
        std::fs::create_dir_all(&local_path)
            .map_err(|e| format!("Failed to create local folder: {}", e))?;

        let conn = conn_arc.lock().unwrap();
        
        // Recursive function to download folder contents
        fn download_recursive(
            conn: &SftpConnection,
            sftp_path: &Path,
            local_base: &Path,
            app: &AppHandle,
            cancel_flag: &Option<Arc<AtomicBool>>,
            id: &str,
        ) -> Result<(), String> {
            // Check cancellation
            if let Some(ref flag) = cancel_flag {
                if flag.load(Ordering::SeqCst) {
                    return Err("Download cancelled".into());
                }
            }

            // List directory contents
            let entries = conn.sftp.readdir(sftp_path).map_err(|e| e.to_string())?;
            
            for (path, stat) in entries {
                // Check cancellation before each file
                if let Some(ref flag) = cancel_flag {
                    if flag.load(Ordering::SeqCst) {
                        return Err("Download cancelled".into());
                    }
                }

                let file_name = path.file_name().unwrap_or_default().to_string_lossy().to_string();
                let local_file_path = local_base.join(&file_name);
                
                if stat.is_dir() {
                    // Create local directory and recurse
                    std::fs::create_dir_all(&local_file_path)
                        .map_err(|e| format!("Failed to create dir: {}", e))?;
                    download_recursive(conn, &path, &local_file_path, app, cancel_flag, id)?;
                } else {
                    // Download file
                    let total_size = stat.size.unwrap_or(0);
                    let mut remote_file = conn.sftp.open(&path).map_err(|e| e.to_string())?;
                    let mut local_file = std::fs::File::create(&local_file_path)
                        .map_err(|e| format!("Failed to create file: {}", e))?;
                    
                    const CHUNK_SIZE: usize = 64 * 1024;
                    let mut buffer = vec![0u8; CHUNK_SIZE];
                    let mut downloaded: u64 = 0;
                    
                    loop {
                        // Check cancellation during file download
                        if let Some(ref flag) = cancel_flag {
                            if flag.load(Ordering::SeqCst) {
                                let _ = std::fs::remove_file(&local_file_path);
                                return Err("Download cancelled".into());
                            }
                        }

                        let bytes_read = remote_file.read(&mut buffer).map_err(|e| e.to_string())?;
                        if bytes_read == 0 {
                            break;
                        }
                        
                        local_file.write_all(&buffer[..bytes_read]).map_err(|e| e.to_string())?;
                        downloaded += bytes_read as u64;
                        
                        let percent = if total_size > 0 {
                            (downloaded as f32 / total_size as f32) * 100.0
                        } else {
                            100.0
                        };
                        
                        // Emit progress
                        let payload = DownloadProgressPayload {
                            id: id.to_string(),
                            file_name: file_name.clone(),
                            downloaded,
                            total: total_size,
                            percent,
                        };
                        let _ = app.emit("sftp-download-progress", payload);
                    }
                }
            }
            
            Ok(())
        }

        download_recursive(&conn, Path::new(&remote_path), Path::new(&local_path), &app, &cancel_flag, &id_clone)
    }).await.map_err(|e| e.to_string())?;

    result
}

/// Rename/move a file or directory
#[tauri::command]
pub async fn sftp_rename(
    sftp_state: tauri::State<'_, SftpState>,
    id: String,
    old_path: String,
    new_path: String,
) -> Result<(), String> {
    let conn_arc = {
        let connections = sftp_state.connections.lock().unwrap();
        match connections.get(&id) {
            Some(c) => c.clone(),
            None => return Err("SFTP not connected".into()),
        }
    };

    tokio::task::spawn_blocking(move || -> Result<(), String> {
        let conn = conn_arc.lock().unwrap();
        let old = Path::new(&old_path);
        let new = Path::new(&new_path);
        conn.sftp.rename(old, new, None).map_err(|e| e.to_string())
    }).await.map_err(|e| e.to_string())??;

    Ok(())
}

/// Remove a directory (must be empty)
#[tauri::command]
pub async fn sftp_rmdir(
    sftp_state: tauri::State<'_, SftpState>,
    id: String,
    path: String,
) -> Result<(), String> {
    let conn_arc = {
        let connections = sftp_state.connections.lock().unwrap();
        match connections.get(&id) {
            Some(c) => c.clone(),
            None => return Err("SFTP not connected".into()),
        }
    };

    tokio::task::spawn_blocking(move || -> Result<(), String> {
        let conn = conn_arc.lock().unwrap();
        let path = Path::new(&path);
        conn.sftp.rmdir(path).map_err(|e| e.to_string())
    }).await.map_err(|e| e.to_string())??;

    Ok(())
}

/// Read text file content from remote server
#[tauri::command]
pub async fn sftp_read_file(
    sftp_state: tauri::State<'_, SftpState>,
    id: String,
    path: String,
) -> Result<String, String> {
    let conn_arc = {
        let connections = sftp_state.connections.lock().unwrap();
        match connections.get(&id) {
            Some(c) => c.clone(),
            None => return Err("SFTP not connected".into()),
        }
    };

    tokio::task::spawn_blocking(move || -> Result<String, String> {
        use std::io::Read;
        let conn = conn_arc.lock().unwrap();
        let path = Path::new(&path);
        
        let mut file = conn.sftp.open(path).map_err(|e| e.to_string())?;
        let mut content = String::new();
        file.read_to_string(&mut content).map_err(|e| e.to_string())?;
        
        Ok(content)
    }).await.map_err(|e| e.to_string())?
}

/// Write text content to remote file
#[tauri::command]
pub async fn sftp_write_file(
    sftp_state: tauri::State<'_, SftpState>,
    id: String,
    path: String,
    content: String,
) -> Result<(), String> {
    let conn_arc = {
        let connections = sftp_state.connections.lock().unwrap();
        match connections.get(&id) {
            Some(c) => c.clone(),
            None => return Err("SFTP not connected".into()),
        }
    };

    tokio::task::spawn_blocking(move || -> Result<(), String> {
        use std::io::Write;
        let conn = conn_arc.lock().unwrap();
        let path = Path::new(&path);
        
        let mut file = conn.sftp.create(path).map_err(|e| e.to_string())?;
        file.write_all(content.as_bytes()).map_err(|e| e.to_string())?;
        
        Ok(())
    }).await.map_err(|e| e.to_string())?
}

/// Read file as base64 (for images and binary files)
#[tauri::command]
pub async fn sftp_read_file_base64(
    sftp_state: tauri::State<'_, SftpState>,
    id: String,
    path: String,
) -> Result<String, String> {
    let conn_arc = {
        let connections = sftp_state.connections.lock().unwrap();
        match connections.get(&id) {
            Some(c) => c.clone(),
            None => return Err("SFTP not connected".into()),
        }
    };

    tokio::task::spawn_blocking(move || -> Result<String, String> {
        use std::io::Read;
        use base64::{Engine as _, engine::general_purpose::STANDARD};
        
        let conn = conn_arc.lock().unwrap();
        let path = Path::new(&path);
        
        let mut file = conn.sftp.open(path).map_err(|e| e.to_string())?;
        let mut content = Vec::new();
        file.read_to_end(&mut content).map_err(|e| e.to_string())?;
        
        Ok(STANDARD.encode(&content))
    }).await.map_err(|e| e.to_string())?
}

/// Download file to temp directory and open with system default application
/// Emits "sftp-open-progress" events with download progress
/// Can be cancelled via sftp_cancel_download command
#[tauri::command]
pub async fn sftp_open_with_system(
    app: AppHandle,
    sftp_state: tauri::State<'_, SftpState>,
    id: String,
    path: String,
) -> Result<(), String> {
    let conn_arc = {
        let connections = sftp_state.connections.lock().unwrap();
        match connections.get(&id) {
            Some(c) => c.clone(),
            None => return Err("SFTP not connected".into()),
        }
    };

    // Get cancel flag for this connection (reuse download_cancelled)
    let cancel_flag = {
        let flags = sftp_state.download_cancelled.lock().unwrap();
        flags.get(&id).cloned()
    };

    // Reset cancel flag at start
    if let Some(ref flag) = cancel_flag {
        flag.store(false, Ordering::SeqCst);
    }

    // Get file name from path
    let file_name = Path::new(&path)
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();

    // Create temp file path
    let temp_dir = std::env::temp_dir();
    let temp_path = temp_dir.join(&file_name);
    let temp_path_str = temp_path.to_string_lossy().to_string();

    let id_clone = id.clone();
    let file_name_clone = file_name.clone();

    // Download file to temp with progress
    let result = tokio::task::spawn_blocking(move || -> Result<String, String> {
        use std::io::{Read, Write};
        let conn = conn_arc.lock().unwrap();
        let remote_path = Path::new(&path);
        
        // Get file size first
        let stat = conn.sftp.stat(remote_path).map_err(|e| e.to_string())?;
        let total_size = stat.size.unwrap_or(0);
        
        let mut remote_file = conn.sftp.open(remote_path).map_err(|e| e.to_string())?;
        
        // Create local temp file
        let mut local_file = std::fs::File::create(&temp_path)
            .map_err(|e| format!("Failed to create temp file: {}", e))?;
        
        // Chunk size: 64KB for progress updates
        const CHUNK_SIZE: usize = 64 * 1024;
        let mut buffer = vec![0u8; CHUNK_SIZE];
        let mut downloaded: u64 = 0;
        
        loop {
            // Check for cancellation
            if let Some(ref flag) = cancel_flag {
                if flag.load(Ordering::SeqCst) {
                    // Clean up partial file
                    drop(local_file);
                    let _ = std::fs::remove_file(&temp_path);
                    return Err("打开已取消".into());
                }
            }

            let bytes_read = remote_file.read(&mut buffer).map_err(|e| e.to_string())?;
            if bytes_read == 0 {
                break;
            }
            
            local_file.write_all(&buffer[..bytes_read]).map_err(|e| e.to_string())?;
            downloaded += bytes_read as u64;
            
            // Calculate progress
            let percent = if total_size > 0 {
                (downloaded as f32 / total_size as f32) * 100.0
            } else {
                100.0
            };
            
            // Emit progress event (reuse DownloadProgressPayload structure)
            let payload = DownloadProgressPayload {
                id: id_clone.clone(),
                file_name: file_name_clone.clone(),
                downloaded,
                total: total_size,
                percent,
            };
            let _ = app.emit("sftp-open-progress", payload);
        }
        
        Ok(temp_path_str)
    }).await.map_err(|e| e.to_string())?;

    result.map(|local_path| {
        // Open with system default application
        #[cfg(target_os = "macos")]
        {
            std::process::Command::new("open")
                .arg(&local_path)
                .spawn()
                .map_err(|e| format!("Failed to open file: {}", e))?;
        }
        #[cfg(target_os = "windows")]
        {
            std::process::Command::new("cmd")
                .args(["/c", "start", "", &local_path])
                .spawn()
                .map_err(|e| format!("Failed to open file: {}", e))?;
        }
        #[cfg(target_os = "linux")]
        {
            std::process::Command::new("xdg-open")
                .arg(&local_path)
                .spawn()
                .map_err(|e| format!("Failed to open file: {}", e))?;
        }
        Ok(())
    })?
}
